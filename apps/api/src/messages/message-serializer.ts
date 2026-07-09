import { Prisma } from '@prisma/client';
import type { MessageDto, ReactionGroupDto } from '@backstages/shared';
import { toUserDto } from '../auth/auth.service';

/** Standard include used everywhere a MessageDto is built. */
export const messageInclude = {
  user: true,
  reactions: true,
  attachments: true,
  _count: { select: { replies: true } },
  replies: {
    select: { createdAt: true, user: true },
    orderBy: { createdAt: 'desc' as const },
    take: 8,
  },
} satisfies Prisma.MessageInclude;

export type MessageWithRelations = Prisma.MessageGetPayload<{ include: typeof messageInclude }>;

export function groupReactions(
  reactions: Array<{ emoji: string; userId: string }>,
): ReactionGroupDto[] {
  const groups = new Map<string, { emoji: string; count: number; userIds: string[] }>();
  for (const r of reactions) {
    const g = groups.get(r.emoji) ?? { emoji: r.emoji, count: 0, userIds: [] };
    g.count += 1;
    g.userIds.push(r.userId);
    groups.set(r.emoji, g);
  }
  return [...groups.values()];
}

export function toMessageDto(message: MessageWithRelations): MessageDto {
  const isDeleted = message.deletedAt !== null;

  const participantsById = new Map<string, ReturnType<typeof toUserDto>>();
  for (const reply of message.replies) {
    if (reply.user && !participantsById.has(reply.user.id)) {
      participantsById.set(reply.user.id, toUserDto(reply.user));
    }
  }

  return {
    id: message.id,
    workspaceId: message.workspaceId,
    channelId: message.channelId,
    conversationId: message.conversationId,
    user: message.user ? toUserDto(message.user) : null,
    kind: message.kind,
    // Tombstone: deleted content never leaves the server.
    contentJson: isDeleted ? null : message.contentJson,
    contentText: isDeleted ? '' : message.contentText,
    parentId: message.parentId,
    showInChannel: message.showInChannel,
    isEdited: message.isEdited,
    isDeleted,
    clientMsgId: message.clientMsgId,
    createdAt: message.createdAt.toISOString(),
    editedAt: message.editedAt?.toISOString() ?? null,
    reactions: isDeleted ? [] : groupReactions(message.reactions),
    attachments: isDeleted
      ? []
      : message.attachments.map((a) => ({
          id: a.id,
          filename: a.filename,
          mimeType: a.mimeType,
          sizeBytes: a.sizeBytes,
          url: `/attachments/${a.id}`,
          width: a.width,
          height: a.height,
        })),
    replyCount: message._count.replies,
    threadParticipants: [...participantsById.values()].slice(0, 5),
    lastReplyAt: message.replies[0]?.createdAt.toISOString() ?? null,
  };
}
