import { Injectable } from '@nestjs/common';
import type { FeedbackDto, SendFeedbackInput } from '@backstages/shared';
import { PrismaService } from '../prisma/prisma.service';
import { PolicyService } from '../authz/policy.service';
import { NotificationsService } from '../notifications/notifications.service';

/** "Send feedback" from inside the app: stored, owners notified, admins read it. */
@Injectable()
export class FeedbackService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
    private readonly notifications: NotificationsService,
  ) {}

  async send(userId: string, workspaceId: string, input: SendFeedbackInput, userAgent?: string): Promise<{ ok: true }> {
    await this.policy.requireWorkspaceMember(userId, workspaceId);
    // Keep only a path: never store another origin or a full URL with secrets.
    const page = input.page?.startsWith('/') ? input.page.slice(0, 500) : null;
    const row = await this.prisma.feedback.create({
      data: {
        workspaceId,
        userId,
        category: input.category,
        message: input.message.trim(),
        page,
        userAgent: userAgent?.slice(0, 300) ?? null,
      },
    });
    const owners = await this.prisma.workspaceMember.findMany({
      where: { workspaceId, role: 'OWNER', deactivatedAt: null, userId: { not: userId } },
      select: { userId: true },
    });
    await Promise.all(
      owners.map((o) =>
        this.notifications.notify({
          userId: o.userId,
          type: 'SYSTEM',
          actorId: userId,
          payload: {
            source: 'feedback',
            feedbackId: row.id,
            category: row.category,
            text: row.message.slice(0, 140),
          },
        }),
      ),
    );
    return { ok: true };
  }

  async list(userId: string, workspaceId: string): Promise<FeedbackDto[]> {
    await this.policy.requireWorkspaceMember(userId, workspaceId, 'ADMIN');
    const rows = await this.prisma.feedback.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { user: { select: { id: true, displayName: true, avatarUrl: true } } },
    });
    return rows.map((r) => ({
      id: r.id,
      category: r.category,
      message: r.message,
      page: r.page,
      createdAt: r.createdAt.toISOString(),
      user: r.user,
    }));
  }
}
