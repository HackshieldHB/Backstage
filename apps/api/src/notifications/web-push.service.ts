import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import webpush from 'web-push';
import { PrismaService } from '../prisma/prisma.service';

export interface PushMessage {
  title: string;
  body?: string;
  /** Path opened when the notification is clicked. */
  url?: string;
  /** Same tag = the newer notification replaces the older one on the device. */
  tag?: string;
}

/**
 * Delivers Web Push to a user's subscribed browsers (the PWA service worker
 * shows it even when no Backstages tab is open). Enabled only when
 * VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY are set; otherwise every send is a no-op.
 * Subscriptions the push service reports as gone (404/410) are deleted.
 */
@Injectable()
export class WebPushService implements OnModuleInit {
  private readonly logger = new Logger(WebPushService.name);
  private enabled = false;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    const publicKey = process.env.VAPID_PUBLIC_KEY;
    const privateKey = process.env.VAPID_PRIVATE_KEY;
    if (!publicKey || !privateKey) return;
    try {
      webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:admin@backstages.local', publicKey, privateKey);
      this.enabled = true;
      this.logger.log('Web Push delivery enabled');
    } catch (err) {
      this.logger.warn(`Web Push disabled — invalid VAPID configuration: ${String(err)}`);
    }
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  async sendToUser(userId: string, message: PushMessage): Promise<number> {
    if (!this.enabled) return 0;
    const subs = await this.prisma.pushSubscription.findMany({ where: { userId } });
    if (!subs.length) return 0;
    const body = JSON.stringify(message);
    let delivered = 0;
    await Promise.all(
      subs.map(async (s) => {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            body,
            { TTL: 60 * 60, urgency: 'high' },
          );
          delivered++;
        } catch (err) {
          const status = (err as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) {
            await this.prisma.pushSubscription.deleteMany({ where: { id: s.id } }).catch(() => undefined);
          } else {
            this.logger.warn(`Web Push to ${new URL(s.endpoint).host} failed: ${status ?? String(err)}`);
          }
        }
      }),
    );
    return delivered;
  }
}
