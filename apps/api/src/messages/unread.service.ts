import { Injectable } from '@nestjs/common';
import { SOCKET_EVENTS, UnreadUpdatedPayload } from '@backstages/shared';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';

/**
 * Unread tracking, wired end to end: lastReadMessageId is updated on read,
 * used to compute counts, and every change is pushed over unread:updated.
 */
@Injectable()
export class UnreadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
  ) {}

  async computeChannelUnread(channelId: string, userId: string): Promise<UnreadUpdatedPayload> {
    const membership = await this.prisma.channelMember.findUnique({
      where: { channelId_userId: { channelId, userId } },
      include: { lastReadMessage: { select: { createdAt: true } } },
    });
    const after = membership?.lastReadMessage?.createdAt;

    const visibleAfter = {
      channelId,
      deletedAt: null,
      AND: [
        { OR: [{ parentId: null }, { showInChannel: true }] },
        // "Not authored by me" must still match integration messages (author null).
        { OR: [{ userId: null }, { NOT: { userId } }] },
      ],
      ...(after ? { createdAt: { gt: after } } : {}),
    };
    const [unread, mentions] = await Promise.all([
      this.prisma.message.count({ where: visibleAfter }),
      this.prisma.mention.count({
        where: {
          userId,
          message: { channelId, deletedAt: null, ...(after ? { createdAt: { gt: after } } : {}) },
        },
      }),
    ]);
    return { channelId, conversationId: null, unread, mentions };
  }

  async computeConversationUnread(
    conversationId: string,
    userId: string,
  ): Promise<UnreadUpdatedPayload> {
    const membership = await this.prisma.conversationMember.findUnique({
      where: { conversationId_userId: { conversationId, userId } },
      include: { lastReadMessage: { select: { createdAt: true } } },
    });
    const after = membership?.lastReadMessage?.createdAt;

    const unread = await this.prisma.message.count({
      where: {
        conversationId,
        deletedAt: null,
        parentId: null,
        OR: [{ userId: null }, { NOT: { userId } }],
        ...(after ? { createdAt: { gt: after } } : {}),
      },
    });
    return { channelId: null, conversationId, unread, mentions: unread };
  }

  async pushChannelUnread(channelId: string, userId: string) {
    const payload = await this.computeChannelUnread(channelId, userId);
    this.realtime.emitToUser(userId, SOCKET_EVENTS.UNREAD_UPDATED, payload);
  }

  async pushConversationUnread(conversationId: string, userId: string) {
    const payload = await this.computeConversationUnread(conversationId, userId);
    this.realtime.emitToUser(userId, SOCKET_EVENTS.UNREAD_UPDATED, payload);
  }

  /** Initial sidebar state: unread counts for every container the user is in. */
  async workspaceUnreads(userId: string, workspaceId: string): Promise<UnreadUpdatedPayload[]> {
    const [channelMemberships, conversationMemberships] = await Promise.all([
      this.prisma.channelMember.findMany({
        where: { userId, channel: { workspaceId, isArchived: false } },
        select: { channelId: true },
      }),
      this.prisma.conversationMember.findMany({
        where: { userId, conversation: { workspaceId } },
        select: { conversationId: true },
      }),
    ]);
    return Promise.all([
      ...channelMemberships.map((m) => this.computeChannelUnread(m.channelId, userId)),
      ...conversationMemberships.map((m) => this.computeConversationUnread(m.conversationId, userId)),
    ]);
  }
}
