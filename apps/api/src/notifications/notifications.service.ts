import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { SOCKET_EVENTS } from '@backstages/shared';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { toUserDto } from '../auth/auth.service';
import { WebPushService } from './web-push.service';
import { pushText } from './push-text';

type NotificationType = 'MENTION' | 'THREAD_REPLY' | 'REACTION' | 'DM' | 'CHANNEL_MESSAGE' | 'SYSTEM';

export interface NotifyInput {
  userId: string;
  type: NotificationType;
  actorId?: string | null;
  messageId?: string | null;
  channelId?: string | null;
  conversationId?: string | null;
  payload?: Prisma.InputJsonValue;
}

/**
 * Creates a persisted notification and pushes it live to the recipient's Activity
 * feed. Centralises the create + emit pattern so feature services (Jira, Confluence,
 * …) don't each re-implement the socket payload shape.
 *
 * When the recipient has no open Backstages tab, a Web Push copy is also sent (if
 * VAPID is configured) so things like meeting reminders still reach them. An open
 * tab shows its own toast/desktop alert instead, so they never get both.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly push: WebPushService,
  ) {}

  async notify(input: NotifyInput) {
    const notification = await this.prisma.notification.create({
      data: {
        userId: input.userId,
        type: input.type,
        actorId: input.actorId ?? null,
        messageId: input.messageId ?? null,
        channelId: input.channelId ?? null,
        conversationId: input.conversationId ?? null,
        payload: input.payload,
      },
    });
    const [actor, channel] = await Promise.all([
      input.actorId
        ? this.prisma.user.findUnique({ where: { id: input.actorId } })
        : Promise.resolve(null),
      input.channelId
        ? this.prisma.channel.findUnique({ where: { id: input.channelId }, select: { name: true, workspaceId: true } })
        : Promise.resolve(null),
    ]);
    this.realtime.emitToUser(input.userId, SOCKET_EVENTS.NOTIFICATION_NEW, {
      id: notification.id,
      type: notification.type,
      actor: actor ? toUserDto(actor) : null,
      messageId: notification.messageId,
      channelId: notification.channelId,
      channelName: channel?.name ?? null,
      conversationId: notification.conversationId,
      payload: notification.payload,
      createdAt: notification.createdAt.toISOString(),
    });

    if (this.push.isEnabled) {
      // Fire-and-forget: a slow push service must never delay the caller.
      void this.pushIfAway(input, notification.id, actor?.displayName ?? null, channel).catch((err) =>
        this.logger.warn(`Push for notification ${notification.id} failed: ${String(err)}`),
      );
    }
    return notification;
  }

  private async pushIfAway(
    input: NotifyInput,
    notificationId: string,
    actorName: string | null,
    channel: { name: string; workspaceId: string } | null,
  ): Promise<void> {
    if (await this.realtime.isUserConnected(input.userId)) return;
    // Out of office mutes alerts (same rule the web app applies to desktop pop-ups).
    const ooo = await this.prisma.workspaceMember.findFirst({
      where: { userId: input.userId, oooUntil: { gt: new Date() } },
      select: { id: true },
    });
    if (ooo) return;

    let url = '/app';
    if (channel && input.channelId) {
      url = `/app?ws=${channel.workspaceId}&c=${input.channelId}&t=ch`;
    } else if (input.conversationId) {
      const conv = await this.prisma.conversation.findUnique({
        where: { id: input.conversationId },
        select: { workspaceId: true },
      });
      if (conv) url = `/app?ws=${conv.workspaceId}&c=${input.conversationId}&t=dm`;
    }
    const text = pushText(
      input.type,
      input.payload as Record<string, unknown> | undefined,
      actorName,
      channel?.name ?? null,
    );
    await this.push.sendToUser(input.userId, { ...text, url, tag: notificationId });
  }
}
