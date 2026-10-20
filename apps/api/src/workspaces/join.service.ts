import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { JoinableWorkspaceDto, JoinRequestDto, JoinWorkspaceResultDto } from '@backstages/shared';
import { PrismaService } from '../prisma/prisma.service';
import { PolicyService } from '../authz/policy.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditService } from '../admin/audit.service';
import { WorkspacesService } from './workspaces.service';

const domainOf = (email: string) => email.slice(email.lastIndexOf('@') + 1).toLowerCase();

/**
 * Joining a workspace through its email domain ("anyone @acme.com can join"),
 * and join requests an admin approves.
 *
 * The rules that keep this safe:
 *  - only DNS-verified domains count (a domain is verified by one workspace at
 *    most, and nobody can verify gmail.com), and only for people whose own email
 *    is verified — otherwise anyone could sign up as ceo@acme.com and walk in;
 *  - the workspace owner opts in per domain (OFF by default);
 *  - someone an admin deactivated can't rejoin on their own.
 */
@Injectable()
export class JoinService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
    private readonly workspaces: WorkspacesService,
  ) {}

  /** Workspaces the caller can join or ask to join (by their verified email domain). */
  async joinable(userId: string): Promise<JoinableWorkspaceDto[]> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.emailVerifiedAt || user.isBot) return [];
    const domains = await this.prisma.workspaceDomain.findMany({
      where: {
        domain: domainOf(user.email),
        verifiedAt: { not: null },
        joinPolicy: { not: 'OFF' },
        // Not already in it (active or deactivated).
        workspace: { members: { none: { userId } } },
      },
      include: {
        workspace: {
          select: {
            id: true,
            name: true,
            _count: { select: { members: { where: { deactivatedAt: null } } } },
            joinRequests: { where: { userId }, select: { status: true } },
          },
        },
      },
    });
    return domains.map((d) => {
      const req = d.workspace.joinRequests[0]?.status;
      return {
        id: d.workspace.id,
        name: d.workspace.name,
        memberCount: d.workspace._count.members,
        domain: d.domain,
        policy: d.joinPolicy as 'REQUEST' | 'AUTO',
        requestStatus: req === 'PENDING' || req === 'DENIED' ? req : null,
      };
    });
  }

  /** Join directly (AUTO) or file a request (REQUEST). */
  async join(userId: string, workspaceId: string): Promise<JoinWorkspaceResultDto> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.emailVerifiedAt) throw new ForbiddenException('Confirm your email address first');
    const domain = await this.prisma.workspaceDomain.findFirst({
      where: { workspaceId, domain: domainOf(user.email), verifiedAt: { not: null }, joinPolicy: { not: 'OFF' } },
    });
    // Same answer whether the workspace doesn't exist or just isn't open to you.
    if (!domain || user.isBot) throw new NotFoundException('Workspace not found');

    const member = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
    });
    if (member?.deactivatedAt) throw new ForbiddenException('Your access to this workspace was removed — ask an admin');
    if (member) return { status: 'joined', workspaceId };

    if (domain.joinPolicy === 'AUTO') {
      await this.workspaces.addMember(userId, workspaceId, 'MEMBER', (tx) =>
        // A pending request is moot once they're in.
        tx.workspaceJoinRequest.updateMany({
          where: { workspaceId, userId, status: 'PENDING' },
          data: { status: 'APPROVED', decidedAt: new Date() },
        }),
      );
      this.audit.record(workspaceId, userId, 'member.join_domain', { targetType: 'user', targetId: userId, meta: { domain: domain.domain } });
      return { status: 'joined', workspaceId };
    }

    const existing = await this.prisma.workspaceJoinRequest.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
    });
    if (existing?.status === 'PENDING') return { status: 'requested', workspaceId };
    await this.prisma.workspaceJoinRequest.upsert({
      where: { workspaceId_userId: { workspaceId, userId } },
      create: { workspaceId, userId },
      update: { status: 'PENDING', createdAt: new Date(), decidedAt: null, decidedById: null },
    });
    const admins = await this.prisma.workspaceMember.findMany({
      where: { workspaceId, role: { in: ['OWNER', 'ADMIN'] }, deactivatedAt: null },
      select: { userId: true },
    });
    await Promise.all(
      admins.map((a) =>
        this.notifications.notify({
          userId: a.userId,
          type: 'SYSTEM',
          actorId: userId,
          payload: { source: 'join_request', action: 'requested', workspaceId, email: user.email },
        }),
      ),
    );
    return { status: 'requested', workspaceId };
  }

  async requests(adminId: string, workspaceId: string): Promise<JoinRequestDto[]> {
    await this.policy.requireWorkspaceMember(adminId, workspaceId, 'ADMIN');
    const rows = await this.prisma.workspaceJoinRequest.findMany({
      where: { workspaceId, status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
      include: { user: { select: { id: true, displayName: true, email: true, avatarUrl: true } } },
      take: 200,
    });
    return rows.map((r) => ({ id: r.id, user: r.user, status: r.status, createdAt: r.createdAt.toISOString() }));
  }

  async decide(adminId: string, workspaceId: string, requestId: string, approve: boolean): Promise<{ ok: true }> {
    await this.policy.requireWorkspaceMember(adminId, workspaceId, 'ADMIN');
    const req = await this.prisma.workspaceJoinRequest.findFirst({ where: { id: requestId, workspaceId } });
    if (!req) throw new NotFoundException('Join request not found');
    if (req.status !== 'PENDING') throw new BadRequestException('This request was already handled');

    if (approve) {
      const member = await this.prisma.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId, userId: req.userId } },
      });
      if (!member) {
        await this.workspaces.addMember(req.userId, workspaceId, 'MEMBER', (tx) =>
          tx.workspaceJoinRequest.update({
            where: { id: req.id },
            data: { status: 'APPROVED', decidedAt: new Date(), decidedById: adminId },
          }),
        );
      } else {
        await this.prisma.workspaceJoinRequest.update({
          where: { id: req.id },
          data: { status: 'APPROVED', decidedAt: new Date(), decidedById: adminId },
        });
      }
    } else {
      await this.prisma.workspaceJoinRequest.update({
        where: { id: req.id },
        data: { status: 'DENIED', decidedAt: new Date(), decidedById: adminId },
      });
    }
    this.audit.record(workspaceId, adminId, approve ? 'join_request.approve' : 'join_request.deny', {
      targetType: 'user',
      targetId: req.userId,
    });
    const ws = await this.prisma.workspace.findUnique({ where: { id: workspaceId }, select: { name: true } });
    await this.notifications.notify({
      userId: req.userId,
      type: 'SYSTEM',
      actorId: adminId,
      payload: { source: 'join_request', action: approve ? 'approved' : 'denied', workspaceId, workspaceName: ws?.name ?? '' },
    });
    return { ok: true };
  }
}
