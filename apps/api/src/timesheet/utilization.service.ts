import { Injectable } from '@nestjs/common';
import type { ActivitySegment } from '@prisma/client';
import type {
  ActivityKind,
  TimelineResponse,
  TimelineSegmentDto,
  UtilizationResponse,
  UtilizationRowDto,
} from '@backstages/shared';
import { PrismaService } from '../prisma/prisma.service';
import { PolicyService } from '../authz/policy.service';
import { resolveSegments, sumByKind, type RawSegment } from './activity-resolver';

/** Kinds that participate in the non-overlapping real-time timeline resolver. */
const REALTIME_KINDS: ActivityKind[] = [
  'MEETING',
  'IMPLEMENTATION',
  'DOCUMENTATION',
  'COLLABORATION',
  'AWAY',
  'ONLINE',
];

interface Member {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
}

/**
 * Read side of the timeline feature. Timeline and utilization are computed live
 * from ActivitySegment via the pure resolver, so any window works without a
 * rollup; computeDaily() additionally persists per-day totals for fast history.
 * Visibility is transparent — any workspace member may view the team timeline.
 */
@Injectable()
export class UtilizationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
  ) {}

  async timeline(
    userId: string,
    workspaceId: string,
    from: Date,
    to: Date,
  ): Promise<TimelineResponse> {
    await this.policy.requireWorkspaceMember(userId, workspaceId);
    const members = await this.members(workspaceId);
    const byUser = await this.segmentsByUser(workspaceId, from, to);
    const now = Date.now();

    const memberDtos = members.map((m) => {
      const raw = (byUser.get(m.userId) ?? [])
        .filter((s) => REALTIME_KINDS.includes(s.kind as ActivityKind))
        .map(toRaw);
      const resolved = resolveSegments(raw, from.getTime(), to.getTime(), now);
      const segments: TimelineSegmentDto[] = resolved.map((iv) => ({
        kind: iv.kind,
        startedAt: new Date(iv.start).toISOString(),
        endedAt: new Date(iv.end).toISOString(),
      }));
      return { ...m, segments };
    });

    return { from: from.toISOString(), to: to.toISOString(), members: memberDtos };
  }

  async utilization(
    userId: string,
    workspaceId: string,
    from: Date,
    to: Date,
  ): Promise<UtilizationResponse> {
    await this.policy.requireWorkspaceMember(userId, workspaceId);
    const members = await this.members(workspaceId);
    const byUser = await this.segmentsByUser(workspaceId, from, to);
    const now = Date.now();

    const rows: UtilizationRowDto[] = members.map((m) => {
      const all = byUser.get(m.userId) ?? [];
      const totals = this.totalsFor(all, from, to, now);
      return { ...m, ...totals };
    });

    return { from: from.toISOString(), to: to.toISOString(), rows };
  }

  /** Persist yesterday's per-member totals into UtilizationDaily (rollup job). */
  async computeDaily(day: Date): Promise<{ rows: number }> {
    const from = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()));
    const to = new Date(from.getTime() + 24 * 3600 * 1000);
    const now = Date.now();

    const segments = await this.prisma.activitySegment.findMany({
      where: { startedAt: { lte: to }, OR: [{ endedAt: null }, { endedAt: { gte: from } }] },
    });
    const grouped = new Map<string, { workspaceId: string; segs: ActivitySegment[] }>();
    for (const s of segments) {
      const key = `${s.workspaceId}:${s.userId}`;
      const bucket = grouped.get(key) ?? { workspaceId: s.workspaceId, segs: [] };
      bucket.segs.push(s);
      grouped.set(key, bucket);
    }

    let count = 0;
    for (const [key, { workspaceId, segs }] of grouped) {
      const userId = key.split(':')[1];
      const t = this.totalsFor(segs, from, to, now);
      await this.prisma.utilizationDaily.upsert({
        where: { workspaceId_userId_day: { workspaceId, userId, day: from } },
        create: {
          workspaceId,
          userId,
          day: from,
          meetingSec: t.meetingSec,
          implementationSec: t.implementationSec,
          documentationSec: t.documentationSec,
          collaborationSec: t.collaborationSec,
          idleSec: t.idleSec,
          awaySec: t.awaySec,
          onlineSec: t.onlineSec,
          loggedSec: t.loggedSec,
        },
        update: {
          meetingSec: t.meetingSec,
          implementationSec: t.implementationSec,
          documentationSec: t.documentationSec,
          collaborationSec: t.collaborationSec,
          idleSec: t.idleSec,
          awaySec: t.awaySec,
          onlineSec: t.onlineSec,
          loggedSec: t.loggedSec,
        },
      });
      count++;
    }
    return { rows: count };
  }

  /** Resolve a member's raw segments into non-overlapping per-kind seconds. */
  private totalsFor(all: ActivitySegment[], from: Date, to: Date, now: number) {
    const realtime = all.filter((s) => REALTIME_KINDS.includes(s.kind as ActivityKind)).map(toRaw);
    const resolved = resolveSegments(realtime, from.getTime(), to.getTime(), now);
    const totals = sumByKind(resolved);

    // WORK_LOGGED is explicit, possibly-backdated, and reported separately.
    const loggedSec = all
      .filter((s) => s.kind === 'WORK_LOGGED')
      .reduce((acc, s) => acc + (s.durationSec ?? 0), 0);

    const meetingSec = totals.MEETING;
    const implementationSec = totals.IMPLEMENTATION;
    const documentationSec = totals.DOCUMENTATION;
    const collaborationSec = totals.COLLABORATION;
    const idleSec = totals.ONLINE;
    const awaySec = totals.AWAY;
    // Present-and-not-away time; positive activity implies presence.
    const onlineSec = meetingSec + implementationSec + documentationSec + collaborationSec + idleSec;

    return {
      meetingSec,
      implementationSec,
      documentationSec,
      collaborationSec,
      idleSec,
      awaySec,
      onlineSec,
      loggedSec,
    };
  }

  private async members(workspaceId: string): Promise<Member[]> {
    const rows = await this.prisma.workspaceMember.findMany({
      where: { workspaceId, deactivatedAt: null },
      include: { user: { select: { id: true, displayName: true, avatarUrl: true } } },
      orderBy: { user: { displayName: 'asc' } },
    });
    return rows.map((r) => ({
      userId: r.user.id,
      displayName: r.user.displayName,
      avatarUrl: r.user.avatarUrl,
    }));
  }

  private async segmentsByUser(
    workspaceId: string,
    from: Date,
    to: Date,
  ): Promise<Map<string, ActivitySegment[]>> {
    const segments = await this.prisma.activitySegment.findMany({
      where: {
        workspaceId,
        startedAt: { lte: to },
        OR: [{ endedAt: null }, { endedAt: { gte: from } }],
      },
    });
    const map = new Map<string, ActivitySegment[]>();
    for (const s of segments) {
      const list = map.get(s.userId) ?? [];
      list.push(s);
      map.set(s.userId, list);
    }
    return map;
  }
}

function toRaw(s: ActivitySegment): RawSegment {
  return {
    kind: s.kind as ActivityKind,
    start: s.startedAt.getTime(),
    end: s.endedAt ? s.endedAt.getTime() : null,
  };
}
