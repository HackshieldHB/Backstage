import { Body, Controller, Delete, Get, Post } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';
import { WebPushService } from '../notifications/web-push.service';

interface SubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/**
 * Stores browser Web Push subscriptions. Delivery is done by WebPushService
 * (NotificationsService pushes when the user has no open tab) and needs
 * VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY; without them the public key is withheld
 * so browsers don't subscribe to pushes that would never come.
 */
@Controller('push')
export class PushController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly push: WebPushService,
  ) {}

  @Get('status')
  status() {
    return { vapidPublicKey: this.push.isEnabled ? (process.env.VAPID_PUBLIC_KEY ?? null) : null };
  }

  @Post('subscribe')
  async subscribe(@CurrentUser() user: AuthUser, @Body() body: SubscriptionInput) {
    if (!body?.endpoint || !body.keys?.p256dh || !body.keys?.auth) return { ok: false };
    await this.prisma.pushSubscription.upsert({
      where: { endpoint: body.endpoint },
      create: {
        userId: user.id,
        endpoint: body.endpoint,
        p256dh: body.keys.p256dh,
        auth: body.keys.auth,
      },
      update: { userId: user.id, p256dh: body.keys.p256dh, auth: body.keys.auth },
    });
    return { ok: true };
  }

  @Delete('subscribe')
  async unsubscribe(@CurrentUser() user: AuthUser, @Body() body: { endpoint: string }) {
    if (body?.endpoint) {
      // Scoped to the caller so nobody can drop another user's subscription.
      await this.prisma.pushSubscription.deleteMany({ where: { endpoint: body.endpoint, userId: user.id } });
    }
    return { ok: true };
  }
}
