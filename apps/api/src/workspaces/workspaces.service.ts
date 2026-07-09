import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  CreateInviteInput,
  CreateWorkspaceInput,
  DEFAULT_CHANNEL_NAME,
  UpdateMemberRoleInput,
  UpdateWorkspaceInput,
} from '@backstages/shared';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { PolicyService } from '../authz/policy.service';
import { EmailService } from '../email/email.service';
import { sha256 } from '../auth/token.service';
import { toUserDto } from '../auth/auth.service';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

@Injectable()
export class WorkspacesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
    private readonly email: EmailService,
  ) {}

  async create(userId: string, input: CreateWorkspaceInput) {
    const baseSlug = input.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60);
    const slug = `${baseSlug || 'workspace'}-${randomBytes(3).toString('hex')}`;

    return this.prisma.$transaction(async (tx) => {
      const workspace = await tx.workspace.create({
        data: { name: input.name, slug, ownerId: userId },
      });
      await tx.workspaceMember.create({
        data: { workspaceId: workspace.id, userId, role: 'OWNER' },
      });
      const general = await tx.channel.create({
        data: {
          workspaceId: workspace.id,
          name: DEFAULT_CHANNEL_NAME,
          isDefault: true,
          topic: 'Company-wide announcements and work-based matters',
          createdById: userId,
        },
      });
      await tx.channelMember.create({ data: { channelId: general.id, userId } });
      return workspace;
    });
  }

  async listMine(userId: string) {
    const memberships = await this.prisma.workspaceMember.findMany({
      where: { userId, deactivatedAt: null },
      include: { workspace: true },
      orderBy: { createdAt: 'asc' },
    });
    return memberships.map((m) => ({ ...m.workspace, myRole: m.role }));
  }

  async getById(userId: string, workspaceId: string) {
    const member = await this.policy.requireWorkspaceMember(userId, workspaceId);
    const workspace = await this.prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } });
    return { ...workspace, myRole: member.role };
  }

  async update(userId: string, workspaceId: string, input: UpdateWorkspaceInput) {
    await this.policy.requireWorkspaceMember(userId, workspaceId, 'ADMIN');
    return this.prisma.workspace.update({ where: { id: workspaceId }, data: { name: input.name } });
  }

  async listMembers(userId: string, workspaceId: string) {
    await this.policy.requireWorkspaceMember(userId, workspaceId);
    const members = await this.prisma.workspaceMember.findMany({
      where: { workspaceId },
      include: { user: true },
      orderBy: { createdAt: 'asc' },
    });
    return members.map((m) => ({
      id: m.id,
      workspaceId: m.workspaceId,
      role: m.role,
      deactivatedAt: m.deactivatedAt?.toISOString() ?? null,
      user: toUserDto(m.user),
    }));
  }

  async updateMemberRole(
    actorId: string,
    workspaceId: string,
    targetUserId: string,
    input: UpdateMemberRoleInput,
  ) {
    const actor = await this.policy.requireWorkspaceMember(actorId, workspaceId, 'ADMIN');
    const target = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: targetUserId } },
    });
    if (!target) throw new NotFoundException('Member not found');
    if (target.role === 'OWNER') throw new ForbiddenException('The owner role cannot be changed');
    if (target.role === 'ADMIN' && actor.role !== 'OWNER') {
      throw new ForbiddenException('Only the owner can change an admin');
    }
    return this.prisma.workspaceMember.update({
      where: { id: target.id },
      data: { role: input.role },
    });
  }

  async removeMember(actorId: string, workspaceId: string, targetUserId: string) {
    const isSelf = actorId === targetUserId;
    const actor = isSelf
      ? await this.policy.requireWorkspaceMember(actorId, workspaceId)
      : await this.policy.requireWorkspaceMember(actorId, workspaceId, 'ADMIN');
    const target = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: targetUserId } },
    });
    if (!target) throw new NotFoundException('Member not found');
    if (target.role === 'OWNER') {
      throw new ForbiddenException('The workspace owner cannot be removed');
    }
    if (!isSelf && target.role === 'ADMIN' && actor.role !== 'OWNER') {
      throw new ForbiddenException('Only the owner can remove an admin');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.channelMember.deleteMany({
        where: { userId: targetUserId, channel: { workspaceId } },
      });
      await tx.workspaceMember.delete({ where: { id: target.id } });
    });
    return { ok: true };
  }

  async createInvite(actorId: string, workspaceId: string, input: CreateInviteInput) {
    await this.policy.requireWorkspaceMember(actorId, workspaceId, 'ADMIN');
    const rawToken = randomBytes(24).toString('base64url');
    const invite = await this.prisma.workspaceInvite.create({
      data: {
        workspaceId,
        email: input.email ?? null,
        role: input.role,
        tokenHash: sha256(rawToken),
        createdById: actorId,
        expiresAt: new Date(Date.now() + INVITE_TTL_MS),
      },
    });

    const url = `${process.env.WEB_ORIGIN ?? 'http://localhost:3000'}/invite/${rawToken}`;
    if (input.email) {
      const workspace = await this.prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } });
      await this.email.send({
        to: input.email,
        subject: `You have been invited to ${workspace.name} on Backstages`,
        body: `Join here (valid 7 days): ${url}`,
      });
    }
    // The raw token is returned exactly once; only its hash is stored.
    return { id: invite.id, email: invite.email, role: invite.role, token: rawToken, url, expiresAt: invite.expiresAt };
  }

  async listInvites(actorId: string, workspaceId: string) {
    await this.policy.requireWorkspaceMember(actorId, workspaceId, 'ADMIN');
    return this.prisma.workspaceInvite.findMany({
      where: { workspaceId, revokedAt: null, expiresAt: { gt: new Date() } },
      select: { id: true, email: true, role: true, expiresAt: true, usedCount: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async revokeInvite(actorId: string, workspaceId: string, inviteId: string) {
    await this.policy.requireWorkspaceMember(actorId, workspaceId, 'ADMIN');
    const invite = await this.prisma.workspaceInvite.findUnique({ where: { id: inviteId } });
    // Scope check: the invite must belong to the workspace the actor administers.
    if (!invite || invite.workspaceId !== workspaceId) throw new NotFoundException('Invite not found');
    await this.prisma.workspaceInvite.update({
      where: { id: inviteId },
      data: { revokedAt: new Date() },
    });
    return { ok: true };
  }

  async acceptInvite(userId: string, rawToken: string) {
    const invite = await this.prisma.workspaceInvite.findUnique({
      where: { tokenHash: sha256(rawToken) },
    });
    if (!invite || invite.revokedAt || invite.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid or expired invite');
    }
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (invite.email && invite.email.toLowerCase() !== user.email.toLowerCase()) {
      throw new ForbiddenException('This invite was issued for a different email address');
    }
    if (invite.email && invite.usedAt) {
      throw new UnauthorizedException('Invite already used');
    }

    const existing = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId: invite.workspaceId, userId } },
    });
    if (existing) throw new BadRequestException('Already a member of this workspace');

    await this.prisma.$transaction(async (tx) => {
      await tx.workspaceMember.create({
        data: { workspaceId: invite.workspaceId, userId, role: invite.role },
      });
      const general = await tx.channel.findFirst({
        where: { workspaceId: invite.workspaceId, isDefault: true },
      });
      // Guests are not auto-added anywhere: they only see explicitly granted channels.
      if (general && invite.role !== 'GUEST') {
        await tx.channelMember.create({ data: { channelId: general.id, userId } });
      }
      await tx.workspaceInvite.update({
        where: { id: invite.id },
        data: {
          usedCount: { increment: 1 },
          ...(invite.email ? { usedAt: new Date(), usedById: userId } : {}),
        },
      });
    });

    return this.getById(userId, invite.workspaceId);
  }
}
