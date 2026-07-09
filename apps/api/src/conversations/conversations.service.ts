import { BadRequestException, Injectable } from '@nestjs/common';
import { CreateConversationInput } from '@backstages/shared';
import { PrismaService } from '../prisma/prisma.service';
import { PolicyService } from '../authz/policy.service';
import { toUserDto } from '../auth/auth.service';

@Injectable()
export class ConversationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
  ) {}

  /** Opens (or returns the existing) DM for the exact member set. */
  async open(userId: string, workspaceId: string, input: CreateConversationInput) {
    await this.policy.requireWorkspaceMember(userId, workspaceId);

    const otherIds = [...new Set(input.memberIds)].filter((id) => id !== userId);
    if (otherIds.length === 0) {
      throw new BadRequestException('A conversation needs at least one other member');
    }

    // Every participant must be an active member of this workspace.
    const memberRows = await this.prisma.workspaceMember.findMany({
      where: { workspaceId, userId: { in: otherIds }, deactivatedAt: null },
    });
    if (memberRows.length !== otherIds.length) {
      throw new BadRequestException('All participants must be members of the workspace');
    }

    const allIds = [userId, ...otherIds];
    const memberKey = [...allIds].sort().join(':');

    const existing = await this.prisma.conversation.findUnique({
      where: { workspaceId_memberKey: { workspaceId, memberKey } },
      include: { members: { include: { user: true } } },
    });
    if (existing) return this.toDto(existing);

    const created = await this.prisma.conversation.create({
      data: {
        workspaceId,
        isGroup: allIds.length > 2,
        memberKey,
        members: { create: allIds.map((id) => ({ userId: id })) },
      },
      include: { members: { include: { user: true } } },
    });
    return this.toDto(created);
  }

  async listMine(userId: string, workspaceId: string) {
    await this.policy.requireWorkspaceMember(userId, workspaceId);
    const rows = await this.prisma.conversation.findMany({
      where: { workspaceId, members: { some: { userId } } },
      include: { members: { include: { user: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((c) => this.toDto(c));
  }

  async get(userId: string, conversationId: string) {
    await this.policy.requireConversationMember(userId, conversationId);
    const row = await this.prisma.conversation.findUniqueOrThrow({
      where: { id: conversationId },
      include: { members: { include: { user: true } } },
    });
    return this.toDto(row);
  }

  private toDto(conversation: {
    id: string;
    workspaceId: string;
    isGroup: boolean;
    members: Array<{ user: Parameters<typeof toUserDto>[0] }>;
  }) {
    return {
      id: conversation.id,
      workspaceId: conversation.workspaceId,
      isGroup: conversation.isGroup,
      members: conversation.members.map((m) => toUserDto(m.user)),
    };
  }
}
