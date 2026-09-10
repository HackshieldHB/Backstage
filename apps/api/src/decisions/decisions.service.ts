import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { Prisma } from '@prisma/client';
import type {
  AssignDecisionInput,
  CreateDecisionInput,
  DecideInput,
  DecisionDto,
} from '@backstages/shared';
import { PrismaService } from '../prisma/prisma.service';
import { PolicyService } from '../authz/policy.service';
import { MessagesService, channelContainer } from '../messages/messages.service';

function textDoc(text: string) {
  return {
    type: 'doc',
    content: text
      .split('\n')
      .map((l) => ({ type: 'paragraph', content: l ? [{ type: 'text', text: l }] : [] })),
  };
}

const userSelect = { select: { id: true, displayName: true, avatarUrl: true } };
const decisionInclude = {
  createdBy: userSelect,
  decidedBy: userSelect,
  owner: userSelect,
} satisfies Prisma.DecisionInclude;
type DecisionRow = Prisma.DecisionGetPayload<{ include: typeof decisionInclude }>;

@Injectable()
export class DecisionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
    private readonly messages: MessagesService,
  ) {}

  async list(userId: string, workspaceId: string): Promise<DecisionDto[]> {
    await this.policy.requireWorkspaceMember(userId, workspaceId);
    const rows = await this.prisma.decision.findMany({
      where: { workspaceId },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      include: decisionInclude,
    });
    return rows.map(toDto);
  }

  async create(userId: string, workspaceId: string, input: CreateDecisionInput): Promise<DecisionDto> {
    const { channel } = await this.policy.requireChannelMember(userId, input.channelId);
    if (channel.workspaceId !== workspaceId) throw new ForbiddenException('Channel not in workspace');
    if (input.ownerId) await this.requireWorkspaceUser(workspaceId, input.ownerId);
    const row = await this.prisma.decision.create({
      data: {
        workspaceId,
        channelId: input.channelId,
        messageId: input.messageId ?? null,
        title: input.title.trim(),
        detail: input.detail,
        ownerId: input.ownerId ?? null,
        dueAt: input.dueAt ? new Date(input.dueAt) : null,
        createdById: userId,
      },
      include: decisionInclude,
    });
    return toDto(row);
  }

  /** Assign or clear the accountable owner and/or due date on a decision. */
  async assign(userId: string, id: string, input: AssignDecisionInput): Promise<DecisionDto> {
    const existing = await this.prisma.decision.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Decision not found');
    await this.policy.requireChannelMember(userId, existing.channelId);
    if (input.ownerId) await this.requireWorkspaceUser(existing.workspaceId, input.ownerId);

    const row = await this.prisma.decision.update({
      where: { id },
      data: {
        ...(input.ownerId !== undefined ? { ownerId: input.ownerId } : {}),
        ...(input.dueAt !== undefined ? { dueAt: input.dueAt ? new Date(input.dueAt) : null } : {}),
      },
      include: decisionInclude,
    });
    return toDto(row);
  }

  private async requireWorkspaceUser(workspaceId: string, userId: string): Promise<void> {
    const member = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
      select: { id: true },
    });
    if (!member) throw new ForbiddenException('Owner must be a member of this workspace');
  }

  async decide(userId: string, id: string, input: DecideInput): Promise<DecisionDto> {
    const existing = await this.prisma.decision.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Decision not found');
    await this.policy.requireChannelMember(userId, existing.channelId);

    const row = await this.prisma.decision.update({
      where: { id },
      data: {
        status: 'DECIDED',
        outcome: input.outcome,
        decidedById: userId,
        decidedAt: new Date(),
      },
      include: decisionInclude,
    });

    const text = `✅ Decision recorded: ${row.title}\n${input.outcome}`;
    await this.messages
      .send(userId, channelContainer(row.channelId), {
        clientMsgId: randomUUID(),
        contentJson: textDoc(text),
        contentText: text,
        attachmentIds: [],
      })
      .catch(() => undefined);

    return toDto(row);
  }

  async remove(userId: string, id: string): Promise<{ ok: boolean }> {
    const existing = await this.prisma.decision.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Decision not found');
    const member = await this.policy.requireWorkspaceMember(userId, existing.workspaceId);
    if (existing.createdById !== userId && member.role !== 'OWNER' && member.role !== 'ADMIN') {
      throw new ForbiddenException('Only the creator or an admin can delete this');
    }
    await this.prisma.decision.delete({ where: { id } });
    return { ok: true };
  }
}

function toDto(row: DecisionRow): DecisionDto {
  return {
    id: row.id,
    channelId: row.channelId,
    messageId: row.messageId,
    title: row.title,
    detail: row.detail,
    status: row.status,
    outcome: row.outcome,
    owner: row.owner
      ? { id: row.owner.id, displayName: row.owner.displayName, avatarUrl: row.owner.avatarUrl }
      : null,
    dueAt: row.dueAt ? row.dueAt.toISOString() : null,
    decidedBy: row.decidedBy
      ? { id: row.decidedBy.id, displayName: row.decidedBy.displayName, avatarUrl: row.decidedBy.avatarUrl }
      : null,
    decidedAt: row.decidedAt ? row.decidedAt.toISOString() : null,
    createdBy: {
      id: row.createdBy.id,
      displayName: row.createdBy.displayName,
      avatarUrl: row.createdBy.avatarUrl,
    },
    createdAt: row.createdAt.toISOString(),
  };
}
