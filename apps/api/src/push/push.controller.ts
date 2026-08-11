import { Body, Controller, Delete, Get, Post } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';

interface SubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/**
 * Stores browser Web Push subscriptions. Actual push delivery requires VAPID
 * keys + a sender (documented in docs/pwa-push.md); this endpoint captures the
 * subscription so the PWA install/notify flow works end-to-end on the client.
 */
@Controller('push')
export class PushController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('status')
  status() {
    return { vapidPublicKey: process.env.VAPID_PUBLIC_KEY ?? null };
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
  async unsubscribe(@Body() body: { endpoint: string }) {
    if (body?.endpoint) {
      await this.prisma.pushSubscription.deleteMany({ where: { endpoint: body.endpoint } });
    }
    return { ok: true };
  }
}
