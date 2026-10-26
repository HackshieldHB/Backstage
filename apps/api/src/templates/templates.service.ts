import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  MessageTemplateDto,
  MessageTemplateInput,
  UpdateMessageTemplateInput,
} from '@backstages/shared';
import type { MessageTemplate, WorkspaceMember } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PolicyService } from '../authz/policy.service';

/** Each person can keep this many personal templates per workspace. */
const MAX_PER_OWNER = 100;

type WithOwner = MessageTemplate & { owner: { id: string; displayName: string } };

/**
 * Message templates (snippets): reusable messages people insert from the
 * composer. Personal ones are private to their owner; shared ones are for the
 * whole workspace. Owners manage their own; admins can also manage shared
 * ones. Guests may keep personal templates but not share them.
 */
@Injectable()
export class TemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
  ) {}

  async list(userId: string, workspaceId: string): Promise<MessageTemplateDto[]> {
    const member = await this.policy.requireWorkspaceMember(userId, workspaceId);
    const rows = await this.prisma.messageTemplate.findMany({
      where: { workspaceId, OR: [{ ownerId: userId }, { shared: true }] },
      include: { owner: { select: { id: true, displayName: true } } },
      orderBy: [{ shared: 'asc' }, { name: 'asc' }],
      take: 500,
    });
    return rows.map((r) => this.toDto(r, userId, member));
  }

  async create(
    userId: string,
    workspaceId: string,
    input: MessageTemplateInput,
  ): Promise<MessageTemplateDto> {
    const member = await this.policy.requireWorkspaceMember(userId, workspaceId);
    if (input.shared && member.role === 'GUEST')
      throw new ForbiddenException('Guests can’t share templates');
    const count = await this.prisma.messageTemplate.count({
      where: { workspaceId, ownerId: userId },
    });
    if (count >= MAX_PER_OWNER)
      throw new ForbiddenException(`You can keep up to ${MAX_PER_OWNER} templates.`);
    const row = await this.prisma.messageTemplate.create({
      data: {
        workspaceId,
        ownerId: userId,
        name: input.name,
        content: input.content,
        shared: input.shared ?? false,
      },
      include: { owner: { select: { id: true, displayName: true } } },
    });
    return this.toDto(row, userId, member);
  }

  async update(
    userId: string,
    templateId: string,
    input: UpdateMessageTemplateInput,
  ): Promise<MessageTemplateDto> {
    const { row, member } = await this.manageable(userId, templateId);
    if (input.shared && member.role === 'GUEST')
      throw new ForbiddenException('Guests can’t share templates');
    // Only the owner decides whether their template is shared.
    if (input.shared !== undefined && input.shared !== row.shared && row.ownerId !== userId) {
      throw new ForbiddenException('Only the owner can change who sees this template');
    }
    const updated = await this.prisma.messageTemplate.update({
      where: { id: row.id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.content !== undefined ? { content: input.content } : {}),
        ...(input.shared !== undefined ? { shared: input.shared } : {}),
      },
      include: { owner: { select: { id: true, displayName: true } } },
    });
    return this.toDto(updated, userId, member);
  }

  async remove(userId: string, templateId: string): Promise<{ ok: true }> {
    const { row } = await this.manageable(userId, templateId);
    await this.prisma.messageTemplate.delete({ where: { id: row.id } });
    return { ok: true };
  }

  /** The template, if the caller may change it; a 404 otherwise (don't reveal others' personal ones). */
  private async manageable(userId: string, templateId: string) {
    const row = await this.prisma.messageTemplate.findUnique({ where: { id: templateId } });
    if (!row) throw new NotFoundException('Template not found');
    const member = await this.policy.requireWorkspaceMember(userId, row.workspaceId);
    if (!canManage(row, userId, member)) {
      if (!row.shared) throw new NotFoundException('Template not found');
      throw new ForbiddenException('Only its owner or an admin can change this template');
    }
    return { row, member };
  }

  private toDto(r: WithOwner, userId: string, member: WorkspaceMember): MessageTemplateDto {
    return {
      id: r.id,
      name: r.name,
      content: r.content,
      shared: r.shared,
      owner: r.owner,
      canManage: canManage(r, userId, member),
      updatedAt: r.updatedAt.toISOString(),
    };
  }
}

export function canManage(
  row: Pick<MessageTemplate, 'ownerId' | 'shared'>,
  userId: string,
  member: Pick<WorkspaceMember, 'role'>,
) {
  if (row.ownerId === userId) return true;
  return row.shared && (member.role === 'OWNER' || member.role === 'ADMIN');
}
