import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import type { MessageDto } from '@backstages/shared';
import { PrismaService } from '../prisma/prisma.service';
import { PolicyService } from '../authz/policy.service';
import { messageInclude, toMessageDto } from '../messages/message-serializer';

export interface CreateShareInput {
  channelId?: string;
  messageId?: string;
}

export type SharedView =
  | { kind: 'channel'; workspaceName: string; title: string; messages: MessageDto[] }
  | { kind: 'thread'; workspaceName: string; title: string; parent: MessageDto; replies: MessageDto[] };

@Injectable()
export class ShareService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
  ) {}

  async create(userId: string, workspaceId: string, input: CreateShareInput) {
    if (!input.channelId === !input.messageId) {
      throw new BadRequestException('Provide exactly one of channelId or messageId');
    }
    await this.policy.requireWorkspaceMember(userId, workspaceId);

    if (input.channelId) {
      const { channel } = await this.policy.requireChannelMember(userId, input.channelId);
      if (channel.workspaceId !== workspaceId) throw new ForbiddenException('Wrong workspace');
    } else {
      const message = await this.prisma.message.findUnique({ where: { id: input.messageId } });
      // Only channel threads are shareable — never DMs (privacy).
      if (!message || message.parentId !== null || !message.channelId) {
        throw new BadRequestException('Only channel threads can be shared');
      }
      const { channel } = await this.policy.requireChannelMember(userId, message.channelId);
      if (channel.workspaceId !== workspaceId) throw new ForbiddenException('Wrong workspace');
    }

    // Reuse an existing live link for the same target so repeat clicks are stable.
    const existing = await this.prisma.shareLink.findFirst({
      where: {
        workspaceId,
        channelId: input.channelId ?? null,
        messageId: input.messageId ?? null,
        revokedAt: null,
      },
    });
    if (existing) return { id: existing.id, token: existing.token, url: `/share/${existing.token}` };

    const token = randomBytes(24).toString('base64url');
    const link = await this.prisma.shareLink.create({
      data: {
        token,
        workspaceId,
        channelId: input.channelId ?? null,
        messageId: input.messageId ?? null,
        createdById: userId,
      },
    });
    return { id: link.id, token: link.token, url: `/share/${link.token}` };
  }

  async listForChannel(userId: string, channelId: string) {
    await this.policy.requireChannelMember(userId, channelId);
    const rows = await this.prisma.shareLink.findMany({
      where: { channelId, revokedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => ({ id: r.id, token: r.token, url: `/share/${r.token}` }));
  }

  async revoke(userId: string, id: string): Promise<void> {
    const link = await this.prisma.shareLink.findUnique({ where: { id } });
    if (!link || link.revokedAt) throw new NotFoundException('Share link not found');
    const member = await this.policy.requireWorkspaceMember(userId, link.workspaceId);
    if (link.createdById !== userId && !this.policy.roleAtLeast(member.role, 'ADMIN')) {
      throw new ForbiddenException('Only the creator or an admin can revoke this link');
    }
    await this.prisma.shareLink.update({ where: { id }, data: { revokedAt: new Date() } });
  }

  /** Public — resolves a share token to a read-only snapshot. No auth. */
  async resolve(token: string): Promise<SharedView> {
    const link = await this.prisma.shareLink.findUnique({
      where: { token },
      include: { workspace: { select: { name: true } } },
    });
    if (!link || link.revokedAt || (link.expiresAt && link.expiresAt < new Date())) {
      throw new NotFoundException('This share link is no longer available');
    }

    if (link.channelId) {
      const channel = await this.prisma.channel.findUnique({
        where: { id: link.channelId },
        select: { name: true },
      });
      if (!channel) throw new NotFoundException('Shared channel not found');
      const rows = await this.prisma.message.findMany({
        where: { channelId: link.channelId, parentId: null, deletedAt: null },
        include: messageInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 50,
      });
      return {
        kind: 'channel',
        workspaceName: link.workspace.name,
        title: `#${channel.name}`,
        messages: rows.reverse().map(toMessageDto),
      };
    }

    const parent = await this.prisma.message.findUnique({
      where: { id: link.messageId! },
      include: messageInclude,
    });
    if (!parent || parent.deletedAt) throw new NotFoundException('Shared thread not found');
    const replies = await this.prisma.message.findMany({
      where: { parentId: parent.id, deletedAt: null },
      include: messageInclude,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return {
      kind: 'thread',
      workspaceName: link.workspace.name,
      title: 'Shared thread',
      parent: toMessageDto(parent),
      replies: replies.map(toMessageDto),
    };
  }
}
