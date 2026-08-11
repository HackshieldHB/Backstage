import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PolicyService } from '../authz/policy.service';

export interface WorkspaceAnalytics {
  totalMessages: number;
  memberCount: number;
  activeUsers7d: number;
  messagesByDay: { date: string; count: number }[];
  topChannels: { name: string; count: number }[];
}

@Injectable()
export class AnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
  ) {}

  async workspace(userId: string, workspaceId: string): Promise<WorkspaceAnalytics> {
    await this.policy.requireWorkspaceMember(userId, workspaceId, 'ADMIN');
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [totalMessages, memberCount, activeRows, byDay, topChannelRows] = await Promise.all([
      this.prisma.message.count({ where: { workspaceId, deletedAt: null } }),
      this.prisma.workspaceMember.count({ where: { workspaceId } }),
      this.prisma.message.findMany({
        where: { workspaceId, createdAt: { gte: weekAgo }, userId: { not: null } },
        select: { userId: true },
        distinct: ['userId'],
      }),
      this.prisma.$queryRaw<{ date: Date; count: bigint }[]>(Prisma.sql`
        SELECT date_trunc('day', "createdAt") AS date, count(*)::bigint AS count
        FROM "Message"
        WHERE "workspaceId" = ${workspaceId} AND "createdAt" >= ${weekAgo} AND "deletedAt" IS NULL
        GROUP BY 1 ORDER BY 1 ASC
      `),
      this.prisma.message.groupBy({
        by: ['channelId'],
        where: { workspaceId, deletedAt: null, channelId: { not: null } },
        _count: { _all: true },
        orderBy: { _count: { channelId: 'desc' } },
        take: 5,
      }),
    ]);

    const channelNames = await this.prisma.channel.findMany({
      where: { id: { in: topChannelRows.map((r) => r.channelId!).filter(Boolean) } },
      select: { id: true, name: true },
    });
    const nameById = new Map(channelNames.map((c) => [c.id, c.name]));

    return {
      totalMessages,
      memberCount,
      activeUsers7d: activeRows.length,
      messagesByDay: byDay.map((r) => ({
        date: r.date.toISOString().slice(0, 10),
        count: Number(r.count),
      })),
      topChannels: topChannelRows.map((r) => ({
        name: nameById.get(r.channelId!) ?? 'unknown',
        count: r._count._all,
      })),
    };
  }
}
