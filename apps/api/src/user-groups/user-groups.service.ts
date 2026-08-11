import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PolicyService } from '../authz/policy.service';
import { AuditService } from '../admin/audit.service';

const HANDLE_RE = /^[a-z0-9][a-z0-9_-]{1,31}$/;

export interface UserGroupView {
  id: string;
  name: string;
  handle: string;
  memberIds: string[];
}

@Injectable()
export class UserGroupsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
  ) {}

  async list(userId: string, workspaceId: string): Promise<UserGroupView[]> {
    await this.policy.requireWorkspaceMember(userId, workspaceId);
    const rows = await this.prisma.userGroup.findMany({
      where: { workspaceId },
      orderBy: { handle: 'asc' },
      include: { members: { select: { userId: true } } },
    });
    return rows.map((g) => ({
      id: g.id,
      name: g.name,
      handle: g.handle,
      memberIds: g.members.map((m) => m.userId),
    }));
  }

  async create(
    userId: string,
    workspaceId: string,
    input: { name: string; handle: string; memberIds: string[] },
  ): Promise<UserGroupView> {
    await this.policy.requireWorkspaceMember(userId, workspaceId, 'ADMIN');
    const handle = input.handle.trim().toLowerCase().replace(/^@/, '');
    if (!HANDLE_RE.test(handle)) throw new BadRequestException('Invalid handle');
    if (!input.name.trim()) throw new BadRequestException('Name required');
    // Keep membership within the workspace.
    const validMembers = await this.prisma.workspaceMember.findMany({
      where: { workspaceId, userId: { in: input.memberIds } },
      select: { userId: true },
    });
    const group = await this.prisma.userGroup.create({
      data: {
        workspaceId,
        name: input.name.trim(),
        handle,
        createdById: userId,
        members: { create: validMembers.map((m) => ({ userId: m.userId })) },
      },
      include: { members: { select: { userId: true } } },
    });
    this.audit.record(workspaceId, userId, 'user_group.create', {
      targetType: 'user_group',
      targetId: group.id,
      meta: { handle: group.handle, name: group.name },
    });
    return { id: group.id, name: group.name, handle: group.handle, memberIds: group.members.map((m) => m.userId) };
  }

  async update(
    userId: string,
    id: string,
    input: { name?: string; memberIds?: string[] },
  ): Promise<UserGroupView> {
    const group = await this.prisma.userGroup.findUnique({ where: { id } });
    if (!group) throw new NotFoundException('Group not found');
    await this.policy.requireWorkspaceMember(userId, group.workspaceId, 'ADMIN');
    if (input.memberIds) {
      const valid = await this.prisma.workspaceMember.findMany({
        where: { workspaceId: group.workspaceId, userId: { in: input.memberIds } },
        select: { userId: true },
      });
      await this.prisma.userGroupMember.deleteMany({ where: { groupId: id } });
      await this.prisma.userGroupMember.createMany({
        data: valid.map((m) => ({ groupId: id, userId: m.userId })),
        skipDuplicates: true,
      });
    }
    const updated = await this.prisma.userGroup.update({
      where: { id },
      data: { ...(input.name ? { name: input.name.trim() } : {}) },
      include: { members: { select: { userId: true } } },
    });
    return {
      id: updated.id,
      name: updated.name,
      handle: updated.handle,
      memberIds: updated.members.map((m) => m.userId),
    };
  }

  async remove(userId: string, id: string): Promise<void> {
    const group = await this.prisma.userGroup.findUnique({ where: { id } });
    if (!group) throw new NotFoundException('Group not found');
    await this.policy.requireWorkspaceMember(userId, group.workspaceId, 'ADMIN');
    await this.prisma.userGroup.delete({ where: { id } });
    this.audit.record(group.workspaceId, userId, 'user_group.delete', {
      targetType: 'user_group',
      targetId: id,
      meta: { handle: group.handle },
    });
  }

  /** Expand `group:<id>` mention ids to their member user ids (for notifications). */
  async expandGroupMentions(workspaceId: string, groupIds: string[]): Promise<string[]> {
    if (groupIds.length === 0) return [];
    const rows = await this.prisma.userGroupMember.findMany({
      where: { groupId: { in: groupIds }, group: { workspaceId } },
      select: { userId: true },
    });
    return [...new Set(rows.map((r) => r.userId))];
  }
}
