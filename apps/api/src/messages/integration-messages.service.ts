import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SOCKET_EVENTS, type MessageDto } from '@backstages/shared';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { UnreadService } from './unread.service';
import { messageInclude, toMessageDto } from './message-serializer';
import type { Container } from './messages.service';

/** Posts INTEGRATION-kind messages (Jira cards etc.) with full realtime fan-out. */
@Injectable()
export class IntegrationMessagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly unread: UnreadService,
  ) {}

  async post(
    container: Container,
    input: {
      workspaceId: string;
      contentText: string;
      contentJson: unknown;
      parentId?: string;
      unfurls?: unknown;
      /** Skip unread push for these members (e.g. dedup rule for DM'd users). */
      suppressUnreadFor?: string[];
    },
  ): Promise<MessageDto> {
    const message = await this.prisma.message.create({
      data: {
        workspaceId: input.workspaceId,
        channelId: container.channelId,
        conversationId: container.conversationId,
        userId: null,
        kind: 'INTEGRATION',
        contentJson: (input.contentJson ?? {}) as Prisma.InputJsonValue,
        contentText: input.contentText,
        parentId: input.parentId ?? null,
        ...(input.unfurls !== undefined
          ? { unfurls: input.unfurls as Prisma.InputJsonValue }
          : {}),
      },
      include: messageInclude,
    });
    const dto = toMessageDto(message);
    const containerIds = { channelId: dto.channelId, conversationId: dto.conversationId };

    this.realtime.emitToContainer(containerIds, SOCKET_EVENTS.MESSAGE_NEW, { message: dto });

    if (input.parentId) {
      const replyCount = await this.prisma.message.count({ where: { parentId: input.parentId } });
      this.realtime.emitToContainer(containerIds, SOCKET_EVENTS.THREAD_REPLY, {
        parentId: input.parentId,
        ...containerIds,
        replyCount,
        lastReplyAt: dto.createdAt,
      });
    }

    const suppress = new Set(input.suppressUnreadFor ?? []);
    if (container.channelId) {
      const members = await this.prisma.channelMember.findMany({
        where: { channelId: container.channelId },
        select: { userId: true },
      });
      // Dedup rule: a member who was DM'd for this same event gets their read
      // marker advanced (if they were caught up) so the card creates no badge.
      for (const userId of suppress) {
        const state = await this.unread.computeChannelUnread(container.channelId, userId);
        // The card itself is 1 unread if they were otherwise caught up.
        if (state.unread <= 1) {
          await this.prisma.channelMember.updateMany({
            where: { channelId: container.channelId, userId },
            data: { lastReadMessageId: dto.id },
          });
        }
      }
      await Promise.all(
        members.map((m) => this.unread.pushChannelUnread(container.channelId!, m.userId)),
      );
    } else if (container.conversationId) {
      const members = await this.prisma.conversationMember.findMany({
        where: { conversationId: container.conversationId },
        select: { userId: true },
      });
      await Promise.all(
        members.map((m) => this.unread.pushConversationUnread(container.conversationId!, m.userId)),
      );
    }

    return dto;
  }
}

/** Optional hook implemented by the Atlassian module: computes link unfurls. */
export const UNFURL_SERVICE = Symbol('UNFURL_SERVICE');

export interface UnfurlProvider {
  unfurl(workspaceId: string, contentText: string): Promise<unknown[] | null>;
}
