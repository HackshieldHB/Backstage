import { ForbiddenException, Injectable } from '@nestjs/common';
import type {
  WellbeingLevel,
  WellbeingReportDto,
  WellbeingSignalDto,
  WellbeingTeamDto,
  WellbeingTeamSignalDto,
} from '@backstages/shared';
import { PrismaService } from '../prisma/prisma.service';
import { PolicyService } from '../authz/policy.service';

/** Below this many opted-in members, team aggregates are suppressed to protect anonymity. */
export const MIN_COHORT = 3;

function fmtH(sec: number): string {
  return `${Math.round((sec / 3600) * 10) / 10}h`;
}

export interface Seg {
  kind: string;
  durationSec: number | null;
  startedAt: Date;
  endedAt: Date | null;
}

/** Pure derivation of wellbeing signals from a week of a member's activity segments. */
export function computeSignals(segs: Seg[]): WellbeingSignalDto[] {
  let meetingSec = 0;
  let afterHoursSec = 0;
  let weekendSec = 0;
  for (const s of segs) {
    const raw = s.durationSec ?? Math.round(((s.endedAt?.getTime() ?? Date.now()) - s.startedAt.getTime()) / 1000);
    const d = Math.max(0, raw);
    if (s.kind === 'MEETING') meetingSec += d;
    const hour = s.startedAt.getHours();
    if (hour >= 20 || hour < 7) afterHoursSec += d;
    const day = s.startedAt.getDay();
    if (day === 0 || day === 6) weekendSec += d;
  }
  // Context-switching proxy: many short sessions in a week reads as a fragmented day.
  const sessions = segs.length;

  const band = (v: number, watch: number, high: number): WellbeingLevel =>
    v >= high ? 'high' : v >= watch ? 'watch' : 'ok';

  return [
    {
      key: 'meeting',
      level: band(meetingSec, 8 * 3600, 15 * 3600),
      label: 'Meeting load',
      detail: `${fmtH(meetingSec)} in huddles/meetings this week`,
    },
    {
      key: 'after_hours',
      level: band(afterHoursSec, 2 * 3600, 5 * 3600),
      label: 'After-hours activity',
      detail: `${fmtH(afterHoursSec)} active before 7am / after 8pm`,
    },
    {
      key: 'weekend',
      level: band(weekendSec, 1 * 3600, 4 * 3600),
      label: 'Weekend work',
      detail: `${fmtH(weekendSec)} active on the weekend`,
    },
    {
      key: 'fragmentation',
      level: band(sessions, 40, 80),
      label: 'Context switching',
      detail: `${sessions} separate work sessions this week`,
    },
  ];
}

/** A gentle, actionable suggestion keyed to the most pressing elevated signal. */
export function nudgeFor(signals: WellbeingSignalDto[]): string | null {
  const high = signals.find((s) => s.level === 'high');
  if (!high) return null;
  switch (high.key) {
    case 'meeting':
      return 'Your meeting load is high this week — consider declining optional meetings or blocking a focus session.';
    case 'after_hours':
      return "You've been active late several times — try protecting your evenings and switching off notifications.";
    case 'weekend':
      return 'You put in notable weekend hours — take some of that time back during the week.';
    case 'fragmentation':
      return 'Your week looks fragmented across many short sessions — a longer focus block could help you get into flow.';
    default:
      return null;
  }
}

/**
 * Pure aggregation of per-member signals into an anonymised team rollup. Suppressed
 * entirely below MIN_COHORT so no individual can be singled out; never carries names.
 */
export function buildTeamReport(
  perMember: WellbeingSignalDto[][],
  optedInCount: number,
): WellbeingTeamDto {
  if (optedInCount < MIN_COHORT) {
    return { available: false, optedInCount, signals: [] };
  }
  const tally = new Map<string, WellbeingTeamSignalDto>();
  for (const signals of perMember) {
    for (const sig of signals) {
      const row = tally.get(sig.key) ?? { key: sig.key, label: sig.label, ok: 0, watch: 0, high: 0 };
      row[sig.level] += 1;
      tally.set(sig.key, row);
    }
  }
  return { available: true, optedInCount, signals: [...tally.values()] };
}

@Injectable()
export class WellbeingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
  ) {}

  async setOptIn(userId: string, workspaceId: string, value: boolean): Promise<{ optIn: boolean }> {
    await this.policy.requireWorkspaceMember(userId, workspaceId);
    await this.prisma.workspaceMember.update({
      where: { workspaceId_userId: { workspaceId, userId } },
      data: { wellbeingOptIn: value },
    });
    return { optIn: value };
  }

  /** Private, self-only workload snapshot. Empty unless the member opted in. */
  async me(userId: string, workspaceId: string): Promise<WellbeingReportDto> {
    const member = await this.policy.requireWorkspaceMember(userId, workspaceId);
    if (!member.wellbeingOptIn) return { optIn: false, signals: [], nudge: null };

    const weekAgo = new Date(Date.now() - 7 * 86400_000);
    const segs = await this.prisma.activitySegment.findMany({
      where: { workspaceId, userId, startedAt: { gte: weekAgo } },
      select: { kind: true, durationSec: true, startedAt: true, endedAt: true },
    });

    const signals = computeSignals(segs);
    return { optIn: true, signals, nudge: nudgeFor(signals) };
  }

  /**
   * Anonymised, manager-facing rollup across opted-in members. Suppressed below
   * MIN_COHORT so no individual can be singled out; never returns names.
   */
  async team(userId: string, workspaceId: string): Promise<WellbeingTeamDto> {
    const member = await this.policy.requireWorkspaceMember(userId, workspaceId);
    if (member.role !== 'OWNER' && member.role !== 'ADMIN') {
      throw new ForbiddenException('Only workspace admins can view team wellbeing');
    }

    const optedIn = await this.prisma.workspaceMember.findMany({
      where: { workspaceId, wellbeingOptIn: true, deactivatedAt: null },
      select: { userId: true },
    });
    const userIds = optedIn.map((m) => m.userId);
    if (userIds.length < MIN_COHORT) {
      return buildTeamReport([], userIds.length);
    }

    const weekAgo = new Date(Date.now() - 7 * 86400_000);
    const segs = await this.prisma.activitySegment.findMany({
      where: { workspaceId, userId: { in: userIds }, startedAt: { gte: weekAgo } },
      select: { userId: true, kind: true, durationSec: true, startedAt: true, endedAt: true },
    });
    const byUser = new Map<string, Seg[]>();
    for (const id of userIds) byUser.set(id, []);
    for (const s of segs) byUser.get(s.userId)?.push(s);

    const perMember = [...byUser.values()].map((list) => computeSignals(list));
    return buildTeamReport(perMember, userIds.length);
  }
}
