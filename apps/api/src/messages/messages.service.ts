import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import {
  EditMessageInput,
  ListMessagesQuery,
  MessageDto,
  MessagePage,
  SOCKET_EVENTS,
  SendMessageInput,
  ToggleReactionInput,
} from '@backstages/shared';
import { MentionType, NotificationType, Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { PolicyService } from '../authz/policy.service';
import { RealtimeService } from '../realtime/realtime.service';
import { UnreadService } from './unread.service';
import { messageInclude, toMessageDto, groupReactions } from './message-serializer';
import { extractMentions } from './mentions';
import { toUserDto } from '../auth/auth.service';
import { AppRegistry } from '../integrations/app-registry';
import { WorkflowsService } from '../workflows/workflows.service';
import { ActivityService } from '../timesheet/activity.service';

export type Container =
  | { channelId: string; conversationId: null }
  | { channelId: null; conversationId: string };

export const channelContainer = (channelId: string): Container => ({ channelId, conversationId: null });
export const conversationContainer = (conversationId: string): Container => ({
  channelId: null,
  conversationId,
});

/** The container a persisted message lives in. */
export function containerOf(message: {
  channelId: string | null;
  conversationId: string | null;
}): Container {
  return message.channelId
    ? channelContainer(message.channelId)
    : conversationContainer(message.conversationId!);
}

@Injectable()
export class MessagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
    private readonly realtime: RealtimeService,
    private readonly unread: UnreadService,
    private readonly apps: AppRegistry,
    @Inject(forwardRef(() => WorkflowsService))
    private readonly workflows: WorkflowsService,
    private readonly activity: ActivityService,
  ) {}

  // ---------- access helpers ----------

  private async requireContainerAccess(userId: string, container: Container) {
    if (container.channelId !== null) {
      const { channel } = await this.policy.requireChannelMember(userId, container.channelId);
      return { workspaceId: channel.workspaceId, archived: channel.isArchived };
    }
    const { conversation } = await this.policy.requireConversationMember(
      userId,
      container.conversationId,
    );
    return { workspaceId: conversation.workspaceId, archived: false };
  }

  private async containerMemberIds(container: Container): Promise<string[]> {
    if (container.channelId !== null) {
      const rows = await this.prisma.channelMember.findMany({
        where: { channelId: container.channelId },
        select: { userId: true },
      });
      return rows.map((r) => r.userId);
    }
    const rows = await this.prisma.conversationMember.findMany({
      where: { conversationId: container.conversationId },
      select: { userId: true },
    });
    return rows.map((r) => r.userId);
  }

  private containerWhere(container: Container) {
    return container.channelId !== null
      ? { channelId: container.channelId }
      : { conversationId: container.conversationId };
  }

  // ---------- send ----------

  async send(userId: string, container: Container, input: SendMessageInput): Promise<MessageDto> {
    const { workspaceId, archived } = await this.requireContainerAccess(userId, container);
    if (archived) throw new ForbiddenException('Channel is archived');

    // Idempotency: retries with the same clientMsgId return the original message.
    const existing = await this.prisma.message.findUnique({
      where: { userId_clientMsgId: { userId, clientMsgId: input.clientMsgId } },
      include: messageInclude,
    });
    if (existing) return toMessageDto(existing);

    // Thread replies: parent must be a top-level message in the same container.
    if (input.parentId) {
      const parent = await this.prisma.message.findUnique({ where: { id: input.parentId } });
      if (
        !parent ||
        parent.deletedAt ||
        parent.parentId !== null ||
        (container.channelId ? parent.channelId !== container.channelId : parent.conversationId !== container.conversationId)
      ) {
        throw new BadRequestException('Invalid thread parent');
      }
    }

    const memberIds = await this.containerMemberIds(container);
    const mentions = extractMentions(input.contentJson);

    // @user-group mentions carry an id like "group:<id>" — expand them to their
    // members so everyone in the group gets notified (scoped to this workspace).
    const groupIds = mentions.userIds
      .filter((id) => id.startsWith('group:'))
      .map((id) => id.slice('group:'.length));
    const directUserIds = mentions.userIds.filter((id) => !id.startsWith('group:'));
    let groupMemberIds: string[] = [];
    if (groupIds.length > 0) {
      const rows = await this.prisma.userGroupMember.findMany({
        where: { groupId: { in: groupIds }, group: { workspaceId } },
        select: { userId: true },
      });
      groupMemberIds = rows.map((r) => r.userId);
    }

    // Resolve mention targets to container members only (never leak beyond access).
    const memberSet = new Set(memberIds);
    const mentionedUserIds = [...new Set([...directUserIds, ...groupMemberIds])];
    const explicitTargets = mentionedUserIds.filter((id) => memberSet.has(id) && id !== userId);
    const broadcastTargets =
      mentions.channel || mentions.here ? memberIds.filter((id) => id !== userId) : [];

    const message = await this.prisma.$transaction(async (tx) => {
      const created = await tx.message.create({
        data: {
          workspaceId,
          ...this.containerWhere(container),
          userId,
          contentJson: (input.contentJson ?? {}) as Prisma.InputJsonValue,
          contentText: input.contentText,
          parentId: input.parentId ?? null,
          showInChannel: input.parentId ? (input.alsoSendToChannel ?? false) : false,
          clientMsgId: input.clientMsgId,
        },
      });

      if (input.attachmentIds.length > 0) {
        // Only the uploader's own, still-unattached files can be linked.
        const updated = await tx.attachment.updateMany({
          where: { id: { in: input.attachmentIds }, uploaderId: userId, messageId: null },
          data: { messageId: created.id },
        });
        if (updated.count !== input.attachmentIds.length) {
          throw new BadRequestException('One or more attachments are invalid');
        }
      }

      const mentionRows = [
        ...explicitTargets.map((id) => ({ messageId: created.id, userId: id, type: MentionType.USER })),
        ...broadcastTargets
          .filter((id) => !explicitTargets.includes(id))
          .map((id) => ({
            messageId: created.id,
            userId: id,
            type: mentions.channel ? MentionType.CHANNEL : MentionType.HERE,
          })),
      ];
      if (mentionRows.length > 0) {
        await tx.mention.createMany({ data: mentionRows, skipDuplicates: true });
      }

      // Sending marks your own message read (top-level only).
      if (!input.parentId) {
        if (container.channelId !== null) {
          await tx.channelMember.update({
            where: { channelId_userId: { channelId: container.channelId, userId } },
            data: { lastReadMessageId: created.id },
          });
        } else {
          await tx.conversationMember.update({
            where: { conversationId_userId: { conversationId: container.conversationId, userId } },
            data: { lastReadMessageId: created.id },
          });
        }
      }

      return created;
    });

    // Notifications (mention > thread-reply > dm, one per user).
    const notified = new Set<string>();
    const mentionNotifyTargets = [...new Set([...explicitTargets, ...broadcastTargets])];
    for (const targetId of mentionNotifyTargets) notified.add(targetId);

    let threadTargets: string[] = [];
    if (input.parentId) {
      const parentAndAuthors = await this.prisma.message.findMany({
        where: { OR: [{ id: input.parentId }, { parentId: input.parentId }] },
        select: { userId: true },
      });
      threadTargets = [
        ...new Set(
          parentAndAuthors
            .map((m) => m.userId)
            .filter((id): id is string => !!id && id !== userId && !notified.has(id) && memberSet.has(id)),
        ),
      ];
      for (const t of threadTargets) notified.add(t);
    }

    const dmTargets =
      container.conversationId && !input.parentId
        ? memberIds.filter((id) => id !== userId && !notified.has(id))
        : [];

    const notificationRows = [
      ...mentionNotifyTargets.map((id) => ({ userId: id, type: NotificationType.MENTION })),
      ...threadTargets.map((id) => ({ userId: id, type: NotificationType.THREAD_REPLY })),
      ...dmTargets.map((id) => ({ userId: id, type: NotificationType.DM })),
    ].map((n) => ({
      ...n,
      actorId: userId,
      messageId: message.id,
      channelId: container.channelId ?? null,
      conversationId: container.conversationId ?? null,
    }));

    const createdNotifications =
      notificationRows.length > 0
        ? await this.prisma.$transaction(
            notificationRows.map((data) => this.prisma.notification.create({ data })),
          )
        : [];

    // ---------- broadcast ----------
    const full = await this.prisma.message.findUniqueOrThrow({
      where: { id: message.id },
      include: messageInclude,
    });
    const dto = toMessageDto(full);
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

    if (createdNotifications.length > 0) {
      const actor = full.user ? toUserDto(full.user) : null;
      for (const n of createdNotifications) {
        this.realtime.emitToUser(n.userId, SOCKET_EVENTS.NOTIFICATION_NEW, {
          id: n.id,
          type: n.type,
          actor,
          messageId: n.messageId,
          channelId: n.channelId,
          conversationId: n.conversationId,
          payload: n.payload ?? null,
          createdAt: n.createdAt.toISOString(),
        });
      }
    }

    // Fire-and-forget link unfurling (Jira/Confluence status cards) via any
    // registered integration app.
    void this.applyUnfurls(message.id, workspaceId, input.contentText, containerIds);

    // Fire-and-forget workflow rules ("when a message is posted in #X …").
    void this.workflows.onMessagePosted(dto);

    // Fire-and-forget timeline signal: authoring a real message is COLLABORATION.
    // Coalesced into a rolling window so a burst of messages is one block.
    void this.activity.touch({
      workspaceId,
      userId,
      kind: 'COLLABORATION',
      source: 'MESSAGE',
      windowSec: 10 * 60,
    });

    // Push fresh unread counts to every other member (and reset for the author).
    const pushTargets = memberIds;
    await Promise.all(
      pushTargets.map((memberId) =>
        container.channelId !== null
          ? this.unread.pushChannelUnread(container.channelId, memberId)
          : this.unread.pushConversationUnread(container.conversationId, memberId),
      ),
    );

    return dto;
  }

  private async applyUnfurls(
    messageId: string,
    workspaceId: string,
    contentText: string,
    containerIds: { channelId: string | null; conversationId: string | null },
  ) {
    try {
      const unfurls = await this.apps.unfurl(workspaceId, contentText);
      if (!unfurls || unfurls.length === 0) return;
      const updated = await this.prisma.message.update({
        where: { id: messageId },
        data: { unfurls: unfurls as Prisma.InputJsonValue },
        include: messageInclude,
      });
      this.realtime.emitToContainer(containerIds, SOCKET_EVENTS.MESSAGE_UPDATED, {
        message: toMessageDto(updated),
      });
    } catch {
      // Unfurling is best-effort; never fail or delay the send path.
    }
  }

  // ---------- read ----------

  async list(userId: string, container: Container, query: ListMessagesQuery): Promise<MessagePage> {
    await this.requireContainerAccess(userId, container);

    const rows = await this.prisma.message.findMany({
      where: {
        ...this.containerWhere(container),
        OR: [{ parentId: null }, { showInChannel: true }],
      },
      include: messageInclude,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });

    const nextCursor = rows.length === query.limit ? rows[rows.length - 1].id : null;
    return { messages: rows.reverse().map(toMessageDto), nextCursor };
  }

  async thread(userId: string, messageId: string) {
    const parent = await this.prisma.message.findUnique({
      where: { id: messageId },
      include: messageInclude,
    });
    if (!parent || parent.parentId !== null) throw new NotFoundException('Thread not found');
    await this.requireContainerAccess(userId, containerOf(parent));

    const replies = await this.prisma.message.findMany({
      where: { parentId: messageId },
      include: messageInclude,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return { parent: toMessageDto(parent), replies: replies.map(toMessageDto) };
  }

  /**
   * Threads the user is a participant in across a workspace — i.e. root messages
   * they started (that have replies) or replied to — newest activity first. This
   * backs the sidebar "Threads" view (Slack's all-threads inbox).
   */
  async myThreads(userId: string, workspaceId: string) {
    await this.policy.requireWorkspaceMember(userId, workspaceId);

    const [channelMembers, conversationMembers] = await Promise.all([
      this.prisma.channelMember.findMany({
        where: { userId, channel: { workspaceId } },
        select: { channelId: true, channel: { select: { name: true } } },
      }),
      this.prisma.conversationMember.findMany({
        where: { userId, conversation: { workspaceId } },
        select: {
          conversationId: true,
          conversation: {
            select: { members: { select: { user: { select: { id: true, displayName: true } } } } },
          },
        },
      }),
    ]);

    const channelIds = channelMembers.map((m) => m.channelId);
    const conversationIds = conversationMembers.map((m) => m.conversationId);
    if (channelIds.length === 0 && conversationIds.length === 0) return { threads: [] };

    // Restrict everything to containers the caller can actually read.
    const containerFilter = {
      OR: [
        ...(channelIds.length ? [{ channelId: { in: channelIds } }] : []),
        ...(conversationIds.length ? [{ conversationId: { in: conversationIds } }] : []),
      ],
    };

    // Root messages the caller has replied to.
    const repliedRows = await this.prisma.message.findMany({
      where: { userId, parentId: { not: null }, deletedAt: null, ...containerFilter },
      select: { parentId: true },
      distinct: ['parentId'],
    });
    const repliedParentIds = repliedRows
      .map((r) => r.parentId)
      .filter((id): id is string => id !== null);

    // Fetch the thread roots: authored by me OR replied to by me, with ≥1 reply.
    const roots = await this.prisma.message.findMany({
      where: {
        parentId: null,
        deletedAt: null,
        replies: { some: {} },
        AND: [containerFilter, { OR: [{ userId }, { id: { in: repliedParentIds } }] }],
      },
      include: messageInclude,
      take: 100,
    });

    const channelLabel = new Map(channelMembers.map((m) => [m.channelId, `#${m.channel.name}`]));
    const conversationLabel = new Map(
      conversationMembers.map((m) => {
        const others = m.conversation.members
          .filter((cm) => cm.user.id !== userId)
          .map((cm) => cm.user.displayName);
        return [m.conversationId, others.length ? others.join(', ') : 'You'] as const;
      }),
    );

    const threads = roots
      .map((r) => ({
        message: toMessageDto(r),
        containerLabel: r.channelId
          ? (channelLabel.get(r.channelId) ?? 'channel')
          : (conversationLabel.get(r.conversationId!) ?? 'Direct message'),
      }))
      // Newest activity (last reply, else the root's own time) first.
      .sort((a, b) =>
        (b.message.lastReplyAt ?? b.message.createdAt).localeCompare(
          a.message.lastReplyAt ?? a.message.createdAt,
        ),
      );

    return { threads };
  }

  /**
   * Per-member read positions for a container, so the client can render "seen
   * by" receipts. Returns each member's last-read timestamp (null if they have
   * never read). Derived from the same markers that drive unread counts — no
   * extra storage.
   */
  async readState(userId: string, container: Container) {
    await this.requireContainerAccess(userId, container);
    if (container.channelId !== null) {
      const rows = await this.prisma.channelMember.findMany({
        where: { channelId: container.channelId },
        select: { userId: true, lastReadMessage: { select: { createdAt: true } } },
      });
      return rows.map((r) => ({
        userId: r.userId,
        lastReadAt: r.lastReadMessage?.createdAt.toISOString() ?? null,
      }));
    }
    const rows = await this.prisma.conversationMember.findMany({
      where: { conversationId: container.conversationId },
      select: { userId: true, lastReadMessage: { select: { createdAt: true } } },
    });
    return rows.map((r) => ({
      userId: r.userId,
      lastReadAt: r.lastReadMessage?.createdAt.toISOString() ?? null,
    }));
  }

  /** Forward a message into another channel/DM as a quoted copy. */
  async forward(
    userId: string,
    messageId: string,
    target: { channelId?: string; conversationId?: string },
  ): Promise<MessageDto> {
    const original = await this.prisma.message.findUnique({ where: { id: messageId } });
    if (!original || original.deletedAt) throw new NotFoundException('Message not found');
    await this.requireContainerAccess(userId, containerOf(original));

    const targetContainer: Container = target.channelId
      ? channelContainer(target.channelId)
      : conversationContainer(target.conversationId!);

    let sourceLabel = 'a direct message';
    if (original.channelId) {
      const ch = await this.prisma.channel.findUnique({
        where: { id: original.channelId },
        select: { name: true },
      });
      sourceLabel = ch ? `#${ch.name}` : 'a channel';
    }
    const author = original.userId
      ? await this.prisma.user.findUnique({
          where: { id: original.userId },
          select: { displayName: true },
        })
      : null;

    const note = `Forwarded from ${sourceLabel}${author ? ` · ${author.displayName}` : ''}`;
    const contentJson = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: note, marks: [{ type: 'italic' }] }] },
        { type: 'paragraph', content: [{ type: 'text', text: original.contentText }] },
      ],
    };

    return this.send(userId, targetContainer, {
      clientMsgId: randomUUID(),
      contentJson,
      contentText: original.contentText,
      attachmentIds: [],
    });
  }

  async markRead(userId: string, container: Container, messageId: string) {
    await this.requireContainerAccess(userId, container);
    const message = await this.prisma.message.findUnique({ where: { id: messageId } });
    if (
      !message ||
      (container.channelId ? message.channelId !== container.channelId : message.conversationId !== container.conversationId)
    ) {
      throw new NotFoundException('Message not found');
    }

    if (container.channelId !== null) {
      const membership = await this.prisma.channelMember.findUniqueOrThrow({
        where: { channelId_userId: { channelId: container.channelId, userId } },
        include: { lastReadMessage: { select: { createdAt: true } } },
      });
      // Forward-only: never move the read marker backwards.
      if (!membership.lastReadMessage || membership.lastReadMessage.createdAt < message.createdAt) {
        await this.prisma.channelMember.update({
          where: { id: membership.id },
          data: { lastReadMessageId: messageId },
        });
      }
      await this.unread.pushChannelUnread(container.channelId, userId);
      return this.unread.computeChannelUnread(container.channelId, userId);
    }

    const membership = await this.prisma.conversationMember.findUniqueOrThrow({
      where: { conversationId_userId: { conversationId: container.conversationId, userId } },
      include: { lastReadMessage: { select: { createdAt: true } } },
    });
    if (!membership.lastReadMessage || membership.lastReadMessage.createdAt < message.createdAt) {
      await this.prisma.conversationMember.update({
        where: { id: membership.id },
        data: { lastReadMessageId: messageId },
      });
    }
    await this.unread.pushConversationUnread(container.conversationId, userId);
    return this.unread.computeConversationUnread(container.conversationId, userId);
  }

  // ---------- edit / delete ----------

  async edit(userId: string, messageId: string, input: EditMessageInput): Promise<MessageDto> {
    const message = await this.prisma.message.findUnique({ where: { id: messageId } });
    if (!message || message.deletedAt) throw new NotFoundException('Message not found');
    if (message.userId !== userId) throw new ForbiddenException('Only the author can edit a message');

    const container = containerOf(message);
    await this.requireContainerAccess(userId, container);

    const updated = await this.prisma.message.update({
      where: { id: messageId },
      data: {
        contentJson: (input.contentJson ?? {}) as Prisma.InputJsonValue,
        contentText: input.contentText,
        isEdited: true,
        editedAt: new Date(),
      },
      include: messageInclude,
    });

    // Newly-added mentions get rows + notifications; existing ones are untouched.
    const memberIds = new Set(await this.containerMemberIds(container));
    const mentions = extractMentions(input.contentJson);
    const targets = mentions.userIds.filter((id) => memberIds.has(id) && id !== userId);
    if (targets.length > 0) {
      const existing = await this.prisma.mention.findMany({
        where: { messageId, userId: { in: targets } },
        select: { userId: true },
      });
      const known = new Set(existing.map((m) => m.userId));
      const fresh = targets.filter((id) => !known.has(id));
      if (fresh.length > 0) {
        await this.prisma.mention.createMany({
          data: fresh.map((id) => ({ messageId, userId: id, type: MentionType.USER })),
          skipDuplicates: true,
        });
        const notifications = await this.prisma.$transaction(
          fresh.map((id) =>
            this.prisma.notification.create({
              data: {
                userId: id,
                type: NotificationType.MENTION,
                actorId: userId,
                messageId,
                channelId: message.channelId,
                conversationId: message.conversationId,
              },
            }),
          ),
        );
        const actor = updated.user ? toUserDto(updated.user) : null;
        for (const n of notifications) {
          this.realtime.emitToUser(n.userId, SOCKET_EVENTS.NOTIFICATION_NEW, {
            id: n.id,
            type: n.type,
            actor,
            messageId: n.messageId,
            channelId: n.channelId,
            conversationId: n.conversationId,
            payload: null,
            createdAt: n.createdAt.toISOString(),
          });
        }
      }
    }

    const dto = toMessageDto(updated);
    this.realtime.emitToContainer(
      { channelId: dto.channelId, conversationId: dto.conversationId },
      SOCKET_EVENTS.MESSAGE_UPDATED,
      { message: dto },
    );
    return dto;
  }

  async delete(userId: string, messageId: string) {
    const message = await this.prisma.message.findUnique({ where: { id: messageId } });
    if (!message || message.deletedAt) throw new NotFoundException('Message not found');

    if (message.userId !== userId) {
      // Channel admins may remove others' messages; DMs are author-only.
      if (!message.channelId) throw new ForbiddenException('Only the author can delete this message');
      await this.policy.requireChannelAdmin(userId, message.channelId);
    } else {
      await this.requireContainerAccess(userId, containerOf(message));
    }

    await this.prisma.message.update({
      where: { id: messageId },
      data: { deletedAt: new Date() },
    });

    this.realtime.emitToContainer(
      { channelId: message.channelId, conversationId: message.conversationId },
      SOCKET_EVENTS.MESSAGE_DELETED,
      {
        id: message.id,
        channelId: message.channelId,
        conversationId: message.conversationId,
        parentId: message.parentId,
      },
    );
    return { ok: true };
  }

  // ---------- reactions ----------

  async toggleReaction(userId: string, messageId: string, input: ToggleReactionInput) {
    const message = await this.prisma.message.findUnique({ where: { id: messageId } });
    if (!message || message.deletedAt) throw new NotFoundException('Message not found');
    await this.requireContainerAccess(userId, containerOf(message));

    const existing = await this.prisma.reaction.findUnique({
      where: { messageId_userId_emoji: { messageId, userId, emoji: input.emoji } },
    });

    let added: boolean;
    if (existing) {
      await this.prisma.reaction.delete({ where: { id: existing.id } });
      added = false;
    } else {
      await this.prisma.reaction.create({ data: { messageId, userId, emoji: input.emoji } });
      added = true;
      // Let integrations turn a reaction on one of their cards into an action
      // (e.g. ✅ on a Jira card → Done). Fire-and-forget: never block or fail
      // the reaction on an integration's behalf.
      void this.apps.onReaction(userId, message, input.emoji).catch(() => undefined);
      if (message.userId && message.userId !== userId) {
        const n = await this.prisma.notification.create({
          data: {
            userId: message.userId,
            type: NotificationType.REACTION,
            actorId: userId,
            messageId,
            channelId: message.channelId,
            conversationId: message.conversationId,
            payload: { emoji: input.emoji },
          },
        });
        const actor = await this.prisma.user.findUnique({ where: { id: userId } });
        this.realtime.emitToUser(message.userId, SOCKET_EVENTS.NOTIFICATION_NEW, {
          id: n.id,
          type: n.type,
          actor: actor ? toUserDto(actor) : null,
          messageId,
          channelId: message.channelId,
          conversationId: message.conversationId,
          payload: { emoji: input.emoji },
          createdAt: n.createdAt.toISOString(),
        });
      }
    }

    const reactions = await this.prisma.reaction.findMany({ where: { messageId } });
    const payload = {
      messageId,
      channelId: message.channelId,
      conversationId: message.conversationId,
      emoji: input.emoji,
      userId,
      reactions: groupReactions(reactions),
    };
    this.realtime.emitToContainer(
      { channelId: message.channelId, conversationId: message.conversationId },
      added ? SOCKET_EVENTS.REACTION_ADDED : SOCKET_EVENTS.REACTION_REMOVED,
      payload,
    );
    return { added, reactions: payload.reactions };
  }
}
