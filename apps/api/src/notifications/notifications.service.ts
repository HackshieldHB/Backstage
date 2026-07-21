import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { SOCKET_EVENTS } from '@backstages/shared';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { toUserDto } from '../auth/auth.service';

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
 */
@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
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
        ? this.prisma.channel.findUnique({ where: { id: input.channelId }, select: { name: true } })
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
    return notification;
  }
}
