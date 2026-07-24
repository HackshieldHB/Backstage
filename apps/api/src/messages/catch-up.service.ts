import { Injectable } from '@nestjs/common';
import type { CatchUpItem, CatchUpResponse } from '@backstages/shared';
import { PrismaService } from '../prisma/prisma.service';
import { PolicyService } from '../authz/policy.service';

const PREVIEWS_PER_ITEM = 3;
const SNIPPET_MAX = 140;

/**
 * "Catch me up": a digest of everything the caller missed since they last read
 * each channel/DM. Built from the same lastReadMessageId markers that drive the
 * unread counts, but enriched with a few message previews and sorted so the
 * things that mention you float to the top.
 */
@Injectable()
export class CatchUpService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
  ) {}

  async catchUp(userId: string, workspaceId: string): Promise<CatchUpResponse> {
    await this.policy.requireWorkspaceMember(userId, workspaceId);

    const [channelMembers, conversationMembers] = await Promise.all([
      this.prisma.channelMember.findMany({
        where: { userId, channel: { workspaceId, isArchived: false } },
        include: {
          channel: { select: { id: true, name: true } },
          lastReadMessage: { select: { createdAt: true } },
        },
      }),
      this.prisma.conversationMember.findMany({
        where: { userId, conversation: { workspaceId } },
        include: {
          conversation: { select: { id: true, members: { include: { user: true } } } },
          lastReadMessage: { select: { createdAt: true } },
        },
      }),
    ]);

    const items: CatchUpItem[] = [];

    for (const m of channelMembers) {
      const after = m.lastReadMessage?.createdAt ?? null;
      const item = await this.channelItem(userId, m.channel.id, `#${m.channel.name}`, after);
      if (item) items.push(item);
    }

    for (const m of conversationMembers) {
      const after = m.lastReadMessage?.createdAt ?? null;
      const others = m.conversation.members
        .filter((cm) => cm.userId !== userId)
        .map((cm) => cm.user.displayName);
      const title = others.length ? others.join(', ') : 'You';
      const item = await this.conversationItem(userId, m.conversation.id, title, after);
      if (item) items.push(item);
    }

    // Mentions first, then busiest — what a returning user most needs to see.
    items.sort((a, b) => b.mentions - a.mentions || b.unread - a.unread);
    const totalUnread = items.reduce((sum, i) => sum + i.unread, 0);
    return { items, totalUnread };
  }

  private snippet(text: string): string {
    const t = text.replace(/\s+/g, ' ').trim();
    return t.length > SNIPPET_MAX ? `${t.slice(0, SNIPPET_MAX - 1)}…` : t;
  }

  private async channelItem(
    userId: string,
    channelId: string,
    title: string,
    after: Date | null,
  ): Promise<CatchUpItem | null> {
    // Mirrors UnreadService's channel window: main-view messages not authored
    // by me, after my last read.
    const where = {
      channelId,
      deletedAt: null,
      AND: [
        { OR: [{ parentId: null }, { showInChannel: true }] },
        { OR: [{ userId: null }, { NOT: { userId } }] },
      ],
      ...(after ? { createdAt: { gt: after } } : {}),
    };
    const [unread, mentions, recent] = await Promise.all([
      this.prisma.message.count({ where }),
      this.prisma.mention.count({
        where: {
          userId,
          message: { channelId, deletedAt: null, ...(after ? { createdAt: { gt: after } } : {}) },
        },
      }),
      this.prisma.message.findMany({
        where,
        include: { user: { select: { displayName: true } } },
        orderBy: { createdAt: 'desc' },
        take: PREVIEWS_PER_ITEM,
      }),
    ]);
    if (unread === 0) return null;
    return {
      channelId,
      conversationId: null,
      title,
      unread,
      mentions,
      previews: recent.reverse().map((r) => ({
        author: r.user?.displayName ?? (r.kind === 'INTEGRATION' ? 'Jira' : 'Backstages'),
        snippet: this.snippet(r.contentText),
        at: r.createdAt.toISOString(),
      })),
    };
  }

  private async conversationItem(
    userId: string,
    conversationId: string,
    title: string,
    after: Date | null,
  ): Promise<CatchUpItem | null> {
    const where = {
      conversationId,
      deletedAt: null,
      parentId: null,
      OR: [{ userId: null }, { NOT: { userId } }],
      ...(after ? { createdAt: { gt: after } } : {}),
    };
    const [unread, recent] = await Promise.all([
      this.prisma.message.count({ where }),
      this.prisma.message.findMany({
        where,
        include: { user: { select: { displayName: true } } },
        orderBy: { createdAt: 'desc' },
        take: PREVIEWS_PER_ITEM,
      }),
    ]);
    if (unread === 0) return null;
    return {
      channelId: null,
      conversationId,
      title,
      unread,
      // A DM to you is itself the "mention" — surface it with the same priority.
      mentions: unread,
      previews: recent.reverse().map((r) => ({
        author: r.user?.displayName ?? 'Backstages',
        snippet: this.snippet(r.contentText),
        at: r.createdAt.toISOString(),
      })),
    };
  }
}
