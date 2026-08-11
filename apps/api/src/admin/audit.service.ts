import { Global, Injectable, Module } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Append-only workspace audit trail. `record` is fire-and-forget for callers —
 * an audit write must never break the action it is logging.
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  record(
    workspaceId: string,
    actorId: string | null,
    action: string,
    extra?: { targetType?: string; targetId?: string; meta?: Prisma.InputJsonValue },
  ): void {
    void this.prisma.auditLog
      .create({
        data: {
          workspaceId,
          actorId,
          action,
          targetType: extra?.targetType ?? null,
          targetId: extra?.targetId ?? null,
          meta: extra?.meta,
        },
      })
      .catch(() => undefined);
  }

  async list(workspaceId: string, limit = 100) {
    const rows = await this.prisma.auditLog.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { actor: { select: { id: true, displayName: true, avatarUrl: true } } },
    });
    return rows.map((r) => ({
      id: r.id,
      action: r.action,
      actor: r.actor,
      targetType: r.targetType,
      targetId: r.targetId,
      meta: r.meta,
      createdAt: r.createdAt.toISOString(),
    }));
  }
}

@Global()
@Module({
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
