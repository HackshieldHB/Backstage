import { Injectable } from '@nestjs/common';
import type { MeetingInsightsDto, MeetingInsightsMember } from '@backstages/shared';
import { PrismaService } from '../prisma/prisma.service';
import { PolicyService } from '../authz/policy.service';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Read-only meeting-load analytics computed from persisted huddle sessions.
 *  No new tables — it aggregates HuddleSession + HuddleParticipant. */
@Injectable()
export class MeetingInsightsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
  ) {}

  async forWorkspace(userId: string, workspaceId: string, days = 7): Promise<MeetingInsightsDto> {
    await this.policy.requireWorkspaceMember(userId, workspaceId);
    const rangeDays = Math.max(1, Math.min(90, Math.floor(days) || 7));
    const now = Date.now();
    const start = new Date(now - rangeDays * DAY_MS);

    const sessions = await this.prisma.huddleSession.findMany({
      where: { workspaceId, startedAt: { gte: start } },
      include: { participants: true },
    });

    const totalMeetings = sessions.length;

    // Average wall-clock meeting length (per session).
    let sessionMinutesSum = 0;
    for (const s of sessions) {
      const end = s.endedAt ? s.endedAt.getTime() : now;
      sessionMinutesSum += Math.max(0, end - s.startedAt.getTime()) / 60000;
    }
    const avgMeetingMinutes = totalMeetings ? Math.round(sessionMinutesSum / totalMeetings) : 0;

    // Per-member participant-minutes + distinct meetings; daily buckets.
    const perMember = new Map<string, { minutes: number; sessions: Set<string> }>();
    const perDay = new Map<string, { minutes: number; sessions: Set<string> }>();

    // Seed every day in the range so the series is continuous.
    for (let i = 0; i < rangeDays; i++) {
      const d = new Date(now - i * DAY_MS).toISOString().slice(0, 10);
      if (!perDay.has(d)) perDay.set(d, { minutes: 0, sessions: new Set() });
    }

    for (const s of sessions) {
      for (const p of s.participants) {
        const joined = p.joinedAt.getTime();
        const left = (p.leftAt ?? s.endedAt ?? new Date(now)).getTime();
        const minutes = Math.max(0, (left - joined) / 60000);
        if (minutes <= 0) continue;

        const m = perMember.get(p.userId) ?? { minutes: 0, sessions: new Set<string>() };
        m.minutes += minutes;
        m.sessions.add(s.id);
        perMember.set(p.userId, m);

        const day = p.joinedAt.toISOString().slice(0, 10);
        const d = perDay.get(day) ?? { minutes: 0, sessions: new Set<string>() };
        d.minutes += minutes;
        d.sessions.add(s.id);
        perDay.set(day, d);
      }
    }

    const memberIds = [...perMember.keys()];
    const users = memberIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: memberIds } },
          select: { id: true, displayName: true, avatarUrl: true },
        })
      : [];
    const userById = new Map(users.map((u) => [u.id, u]));

    const byMember: MeetingInsightsMember[] = memberIds
      .map((id) => {
        const m = perMember.get(id)!;
        const u = userById.get(id);
        return {
          userId: id,
          displayName: u?.displayName ?? 'Unknown',
          avatarUrl: u?.avatarUrl ?? null,
          meetings: m.sessions.size,
          minutes: Math.round(m.minutes),
        };
      })
      .sort((a, b) => b.minutes - a.minutes);

    const byDay = [...perDay.entries()]
      .map(([date, v]) => ({ date, minutes: Math.round(v.minutes), meetings: v.sessions.size }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const totalMinutes = byMember.reduce((sum, m) => sum + m.minutes, 0);

    return { rangeDays, totalMeetings, totalMinutes, avgMeetingMinutes, byMember, byDay };
  }
}
