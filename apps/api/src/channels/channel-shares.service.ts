import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import type { ChannelShare, Workspace } from '@prisma/client';
import { SOCKET_EVENTS } from '@backstages/shared';
import type {
  ChannelShareDto,
  ChannelShareInviteDto,
  IncomingSharedChannelDto,
} from '@backstages/shared';
import { PrismaService } from '../prisma/prisma.service';
import { PolicyService } from '../authz/policy.service';
import { AuditService } from '../admin/audit.service';
import { RealtimeService, roomForChannel } from '../realtime/realtime.service';
import { toUserDto } from '../auth/auth.service';

const TOKEN_PREFIX = 'bs_share_';
const INVITE_TTL_MS = 7 * 86_400_000;
const MAX_PARTNERS = 20;
const hash = (raw: string) => createHash('sha256').update(raw).digest('hex');

type ShareWithGuest = ChannelShare & { guestWorkspace: Workspace | null };

/**
 * Channels shared between two workspaces on this deployment.
 *
 *  1. An admin of the host workspace creates a one-time invite for a public
 *     channel (they must be in it).
 *  2. An admin of the partner workspace accepts it.
 *  3. Partner members (not guests) can then join the channel and use core
 *     messaging; the host's integrations, workflows and admin tools stay
 *     host-only (see PolicyService.requireChannelParticipant).
 *  4. Either side's admin can end the share; partner members are removed.
 */
@Injectable()
export class ChannelSharesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
  ) {}

  // ---------- host side ----------

  async createInvite(userId: string, channelId: string): Promise<ChannelShareInviteDto> {
    const { channel } = await this.policy.requireChannelAdmin(userId, channelId);
    await this.policy.requireChannelMember(userId, channelId);
    if (channel.isPrivate) throw new BadRequestException('Only public channels can be shared with another workspace');
    if (channel.isDefault) throw new BadRequestException('The default channel cannot be shared');
    if (channel.isArchived) throw new BadRequestException('Channel is archived');
    const active = await this.prisma.channelShare.count({ where: { channelId, revokedAt: null } });
    if (active >= MAX_PARTNERS) throw new BadRequestException(`A channel can have at most ${MAX_PARTNERS} shares`);

    const token = TOKEN_PREFIX + randomBytes(24).toString('base64url');
    const share = await this.prisma.channelShare.create({
      data: {
        channelId,
        hostWorkspaceId: channel.workspaceId,
        inviteTokenHash: hash(token),
        inviteExpiresAt: new Date(Date.now() + INVITE_TTL_MS),
        invitedById: userId,
      },
      include: { guestWorkspace: true },
    });
    this.audit.record(channel.workspaceId, userId, 'channel.share.invite', {
      targetType: 'channel',
      targetId: channelId,
    });
    return { ...toDto(share), token };
  }

  async listForChannel(userId: string, channelId: string): Promise<ChannelShareDto[]> {
    await this.policy.requireChannelAdmin(userId, channelId);
    const rows = await this.prisma.channelShare.findMany({
      where: { channelId },
      include: { guestWorkspace: true },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toDto);
  }

  // ---------- guest side ----------

  async accept(userId: string, guestWorkspaceId: string, token: string): Promise<IncomingSharedChannelDto> {
    await this.policy.requireWorkspaceMember(userId, guestWorkspaceId, 'ADMIN');
    const share = await this.prisma.channelShare.findUnique({
      where: { inviteTokenHash: hash(token.trim()) },
      include: { channel: true },
    });
    if (!share || share.revokedAt || share.acceptedAt || share.inviteExpiresAt <= new Date()) {
      throw new NotFoundException('This invite is invalid or has expired');
    }
    if (share.hostWorkspaceId === guestWorkspaceId) {
      throw new BadRequestException('This channel already belongs to this workspace');
    }
    const existing = await this.prisma.channelShare.findFirst({
      where: { channelId: share.channelId, guestWorkspaceId, revokedAt: null },
    });
    if (existing) throw new ConflictException('This channel is already shared with this workspace');

    // Single winner: only one accept can claim the token (and the partial unique
    // index allows only one live share per partner, should two invites race).
    const { count } = await this.prisma.channelShare
      .updateMany({
        where: { id: share.id, acceptedAt: null, revokedAt: null },
        data: { guestWorkspaceId, acceptedById: userId, acceptedAt: new Date(), inviteTokenHash: null },
      })
      .catch(() => {
        throw new ConflictException('This channel is already shared with this workspace');
      });
    if (count === 0) throw new NotFoundException('This invite is invalid or has expired');

    this.audit.record(share.hostWorkspaceId, null, 'channel.share.accept', {
      targetType: 'channel',
      targetId: share.channelId,
      meta: { guestWorkspaceId },
    });
    this.audit.record(guestWorkspaceId, userId, 'channel.share.accept', {
      targetType: 'channel',
      targetId: share.channelId,
    });
    const host = await this.prisma.workspace.findUniqueOrThrow({ where: { id: share.hostWorkspaceId } });
    return {
      shareId: share.id,
      channelId: share.channelId,
      name: share.channel.name,
      topic: share.channel.topic,
      host: { workspaceId: host.id, name: host.name },
      isMember: false,
      isArchived: share.channel.isArchived,
    };
  }

  /** Channels other workspaces shared into this one (for its members to join). */
  async listIncoming(userId: string, workspaceId: string): Promise<IncomingSharedChannelDto[]> {
    const member = await this.policy.requireWorkspaceMember(userId, workspaceId);
    if (member.role === 'GUEST') return [];
    const shares = await this.prisma.channelShare.findMany({
      where: { guestWorkspaceId: workspaceId, acceptedAt: { not: null }, revokedAt: null },
      include: {
        channel: { include: { members: { where: { userId }, select: { id: true } } } },
        hostWorkspace: true,
      },
      orderBy: { acceptedAt: 'desc' },
    });
    return shares.map((s) => ({
      shareId: s.id,
      channelId: s.channelId,
      name: s.channel.name,
      topic: s.channel.topic,
      host: { workspaceId: s.hostWorkspace.id, name: s.hostWorkspace.name },
      isMember: s.channel.members.length > 0,
      isArchived: s.channel.isArchived,
    }));
  }

  async join(userId: string, shareId: string) {
    const share = await this.prisma.channelShare.findUnique({ where: { id: shareId }, include: { channel: true } });
    if (!share?.guestWorkspaceId || !share.acceptedAt || share.revokedAt) {
      throw new NotFoundException('Shared channel not found');
    }
    const member = await this.policy.requireWorkspaceMember(userId, share.guestWorkspaceId);
    if (member.role === 'GUEST') throw new NotFoundException('Shared channel not found');
    if (share.channel.isArchived) throw new BadRequestException('Channel is archived');

    const existing = await this.prisma.channelMember.findUnique({
      where: { channelId_userId: { channelId: share.channelId, userId } },
    });
    if (existing) return existing;
    const created = await this.prisma.channelMember.create({ data: { channelId: share.channelId, userId } });
    await this.realtime.subscribeUserToRoom(userId, roomForChannel(share.channelId)).catch(() => undefined);
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    this.realtime.emitToChannel(share.channelId, SOCKET_EVENTS.MEMBER_JOINED, {
      channelId: share.channelId,
      user: user ? toUserDto(user) : null,
    });
    return created;
  }

  // ---------- either side ----------

  /**
   * End a share (host channel admin, or an admin of the partner workspace).
   * Partner members who no longer have any way in are removed from the channel.
   */
  async revoke(userId: string, shareId: string): Promise<{ ok: boolean }> {
    const share = await this.prisma.channelShare.findUnique({ where: { id: shareId } });
    if (!share || share.revokedAt) throw new NotFoundException('Share not found');
    const isHostAdmin = await this.policy
      .requireChannelAdmin(userId, share.channelId)
      .then(() => true)
      .catch(() => false);
    const isGuestAdmin =
      !!share.guestWorkspaceId &&
      (await this.policy
        .requireWorkspaceMember(userId, share.guestWorkspaceId, 'ADMIN')
        .then(() => true)
        .catch(() => false));
    if (!isHostAdmin && !isGuestAdmin) throw new NotFoundException('Share not found');

    await this.prisma.channelShare.update({
      where: { id: share.id },
      data: { revokedAt: new Date(), inviteTokenHash: null },
    });
    const removed = await this.removeStrandedMembers(share.channelId, share.hostWorkspaceId);
    for (const ws of [share.hostWorkspaceId, share.guestWorkspaceId].filter((w): w is string => !!w)) {
      this.audit.record(ws, userId, 'channel.share.revoke', {
        targetType: 'channel',
        targetId: share.channelId,
        meta: { removedMembers: removed },
      });
    }
    return { ok: true };
  }

  /** Remove channel members who are neither host members nor covered by another active share. */
  private async removeStrandedMembers(channelId: string, hostWorkspaceId: string): Promise<number> {
    const members = await this.prisma.channelMember.findMany({ where: { channelId }, select: { id: true, userId: true } });
    let removed = 0;
    for (const m of members) {
      const home = await this.prisma.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId: hostWorkspaceId, userId: m.userId } },
      });
      if (home && !home.deactivatedAt) continue;
      if (await this.policy.sharedAccessWorkspace(m.userId, channelId)) continue;
      await this.prisma.channelMember.delete({ where: { id: m.id } });
      await this.realtime.unsubscribeUserFromRoom(m.userId, roomForChannel(channelId)).catch(() => undefined);
      this.realtime.emitToChannel(channelId, SOCKET_EVENTS.MEMBER_LEFT, { channelId, userId: m.userId });
      // Tell the removed person's clients so the channel disappears from their sidebar.
      this.realtime.emitToUser(m.userId, SOCKET_EVENTS.MEMBER_LEFT, { channelId, userId: m.userId });
      removed++;
    }
    return removed;
  }
}

function toDto(s: ShareWithGuest): ChannelShareDto {
  return {
    id: s.id,
    status: s.revokedAt ? 'revoked' : s.acceptedAt ? 'active' : 'pending',
    partner: s.guestWorkspace ? { workspaceId: s.guestWorkspace.id, name: s.guestWorkspace.name } : null,
    inviteExpiresAt: s.inviteExpiresAt.toISOString(),
    acceptedAt: s.acceptedAt?.toISOString() ?? null,
    createdAt: s.createdAt.toISOString(),
  };
}
