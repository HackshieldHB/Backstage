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
  SOCKET_EVENTS,
  UpdateMemberRoleInput,
  UpdateWorkspaceInput,
  type MyInvitationDto,
} from '@backstages/shared';
import type { WorkspaceInvite } from '@prisma/client';
import { RealtimeService, roomForChannel, roomForWorkspace } from '../realtime/realtime.service';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { PolicyService } from '../authz/policy.service';
import { AuditService } from '../admin/audit.service';
import { EmailService } from '../email/email.service';
import { WorkflowEvents } from '../workflows/workflow-events';
import { sha256 } from '../auth/token.service';
import { toUserDto } from '../auth/auth.service';
import { textDoc } from '../workflows/workflow-utils';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/** Posted in #general when a workspace is created. */
const WELCOME_TEXT = [
  '👋 Welcome to your new workspace!',
  'A few things to try:',
  '• Invite your team with the invite button next to the workspace name.',
  '• Start a huddle from any channel or DM for voice, video and screen sharing.',
  '• Plan meetings in Calendar — everyone invited gets a reminder before it starts.',
  '• Turn messages into Tasks, and see your day in My day.',
  '• Press Ctrl/⌘ K to jump anywhere. Found a bug or have an idea? Use “Send feedback”.',
].join('\n');

@Injectable()
export class WorkspacesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
    private readonly email: EmailService,
    private readonly workflowEvents: WorkflowEvents,
    private readonly realtime: RealtimeService,
  ) {}

  /**
   * Sockets join their rooms when they connect, so a membership created later
   * (new workspace, accepted invite) must subscribe the user's open sockets too
   * — otherwise they see nothing live until they reload.
   */
  private async subscribeToWorkspace(userId: string, workspaceId: string, channelId: string | null) {
    await this.realtime.subscribeUserToRoom(userId, roomForWorkspace(workspaceId)).catch(() => undefined);
    if (channelId) {
      await this.realtime.subscribeUserToRoom(userId, roomForChannel(channelId)).catch(() => undefined);
    }
  }

  async create(userId: string, input: CreateWorkspaceInput) {
    const baseSlug = input.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60);
    const slug = `${baseSlug || 'workspace'}-${randomBytes(3).toString('hex')}`;

    const created = await this.prisma.$transaction(async (tx) => {
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
      // A short orientation so a brand-new workspace isn't a blank page.
      await tx.message.create({
        data: {
          workspaceId: workspace.id,
          channelId: general.id,
          userId: null,
          kind: 'INTEGRATION',
          appName: 'Backstages',
          contentText: WELCOME_TEXT,
          contentJson: textDoc(WELCOME_TEXT),
        },
      });
      return { workspace, generalId: general.id };
    });
    await this.subscribeToWorkspace(userId, created.workspace.id, created.generalId);
    return created.workspace;
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
    const updated = await this.prisma.workspaceMember.update({
      where: { id: target.id },
      data: { role: input.role },
    });
    this.audit.record(workspaceId, actorId, 'member.role_change', {
      targetType: 'user',
      targetId: targetUserId,
      meta: { from: target.role, to: input.role },
    });
    return updated;
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
    this.audit.record(workspaceId, actorId, isSelf ? 'member.leave' : 'member.remove', {
      targetType: 'user',
      targetId: targetUserId,
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
    return this.acceptInviteRecord(userId, invite);
  }

  /**
   * Invitations addressed to the caller's email that they can still accept
   * (shown on /welcome as "Join an existing workspace"). Only for a verified
   * address — the same rule acceptance enforces.
   */
  async myInvitations(userId: string): Promise<MyInvitationDto[]> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.emailVerifiedAt || user.isBot) return [];
    const invites = await this.prisma.workspaceInvite.findMany({
      where: {
        email: { equals: user.email, mode: 'insensitive' },
        revokedAt: null,
        usedAt: null,
        expiresAt: { gt: new Date() },
        workspace: { members: { none: { userId } } },
      },
      include: {
        workspace: { select: { id: true, name: true, _count: { select: { members: { where: { deactivatedAt: null } } } } } },
        createdBy: { select: { displayName: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    // One entry per workspace (the newest invite wins).
    const seen = new Set<string>();
    return invites
      .filter((i) => (seen.has(i.workspaceId) ? false : (seen.add(i.workspaceId), true)))
      .map((i) => ({
        id: i.id,
        workspace: { id: i.workspace.id, name: i.workspace.name, memberCount: i.workspace._count.members },
        invitedBy: i.createdBy.displayName,
        role: i.role,
        expiresAt: i.expiresAt.toISOString(),
      }));
  }

  /** Accept an invitation addressed to the caller (no link needed — it's theirs). */
  async acceptMyInvitation(userId: string, inviteId: string) {
    const invite = await this.prisma.workspaceInvite.findUnique({ where: { id: inviteId } });
    // Only invitations addressed to someone; link invites need the link itself.
    if (!invite?.email) throw new NotFoundException('Invitation not found');
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (invite.email.toLowerCase() !== user.email.toLowerCase()) throw new NotFoundException('Invitation not found');
    return this.acceptInviteRecord(userId, invite);
  }

  private async acceptInviteRecord(userId: string, invite: WorkspaceInvite | null) {
    if (!invite || invite.revokedAt || invite.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid or expired invite');
    }
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (invite.email && invite.email.toLowerCase() !== user.email.toLowerCase()) {
      throw new ForbiddenException('This invite was issued for a different email address');
    }
    // An invite addressed to a person is only theirs once they've proved they own
    // that address — otherwise anyone could sign up with it and take the seat.
    if (invite.email && !user.emailVerifiedAt) {
      throw new ForbiddenException('Confirm your email address first — check your inbox for the link');
    }
    if (invite.email && invite.usedAt) {
      throw new UnauthorizedException('Invite already used');
    }

    const existing = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId: invite.workspaceId, userId } },
    });
    if (existing) throw new BadRequestException('Already a member of this workspace');

    const joinedChannelId = await this.prisma.$transaction(async (tx) => {
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
      return general && invite.role !== 'GUEST' ? general.id : null;
    });
    await this.subscribeToWorkspace(userId, invite.workspaceId, joinedChannelId);
    if (joinedChannelId) {
      this.realtime.emitToChannel(joinedChannelId, SOCKET_EVENTS.MEMBER_JOINED, {
        channelId: joinedChannelId,
        user: toUserDto(user),
      });
      void this.workflowEvents.emit({
        type: 'member_joined',
        workspaceId: invite.workspaceId,
        channelId: joinedChannelId,
        userId,
      });
    }

    return this.getById(userId, invite.workspaceId);
  }
}
