import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { FeatureUsageDto, TrackUsageInput } from '@backstages/shared';
import { PrismaService } from '../prisma/prisma.service';
import { PolicyService } from '../authz/policy.service';

const RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * Lightweight product analytics: which features get used, by how many people.
 * Events are only ever shown aggregated (count + distinct users per feature) —
 * never as a per-person activity log — and are pruned after 90 days.
 */
@Injectable()
export class UsageService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(UsageService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
  ) {}

  onModuleInit() {
    if (process.env.DISABLE_SYNC_QUEUE === '1') return; // tests prune explicitly
    const prune = () => void this.prune().catch((err) => this.logger.warn(`Usage prune failed: ${String(err)}`));
    this.timer = setInterval(prune, 6 * 60 * 60 * 1000);
    this.timer.unref();
    prune();
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }

  async track(userId: string, workspaceId: string, input: TrackUsageInput): Promise<{ ok: true }> {
    await this.policy.requireWorkspaceMember(userId, workspaceId);
    await this.prisma.usageEvent.createMany({
      data: input.events.map((e) => ({ workspaceId, userId, name: e.name })),
    });
    return { ok: true };
  }

  /** Top features over the last `days` days (admin analytics). */
  async topFeatures(workspaceId: string, days = 30): Promise<FeatureUsageDto[]> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const rows = await this.prisma.$queryRaw<{ name: string; count: bigint; users: bigint }[]>(Prisma.sql`
      SELECT "name", count(*)::bigint AS count, count(DISTINCT "userId")::bigint AS users
      FROM "UsageEvent"
      WHERE "workspaceId" = ${workspaceId} AND "createdAt" >= ${since}
      GROUP BY "name"
      ORDER BY count DESC
      LIMIT 25
    `);
    return rows.map((r) => ({ name: r.name, count: Number(r.count), users: Number(r.users) }));
  }

  async prune(now = new Date()): Promise<number> {
    const { count } = await this.prisma.usageEvent.deleteMany({
      where: { createdAt: { lt: new Date(now.getTime() - RETENTION_MS) } },
    });
    return count;
  }
}
