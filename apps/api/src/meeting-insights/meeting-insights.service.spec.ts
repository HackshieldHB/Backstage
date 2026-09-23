import { MeetingInsightsService } from './meeting-insights.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { PolicyService } from '../authz/policy.service';

describe('MeetingInsightsService', () => {
  const now = Date.now();
  const min = (n: number) => n * 60000;

  function make(sessions: unknown[], users: unknown[]) {
    const prisma = {
      huddleSession: { findMany: jest.fn().mockResolvedValue(sessions) },
      user: { findMany: jest.fn().mockResolvedValue(users) },
    } as unknown as PrismaService;
    const policy = { requireWorkspaceMember: jest.fn().mockResolvedValue({}) } as unknown as PolicyService;
    return new MeetingInsightsService(prisma, policy);
  }

  it('aggregates participant-minutes per member and overall', async () => {
    const start = new Date(now - min(60));
    const end = new Date(now - min(30)); // a 30-min session
    const sessions = [
      {
        id: 's1',
        startedAt: start,
        endedAt: end,
        participants: [
          { userId: 'u1', joinedAt: start, leftAt: end }, // 30 min
          { userId: 'u2', joinedAt: new Date(now - min(50)), leftAt: end }, // 20 min
        ],
      },
    ];
    const users = [
      { id: 'u1', displayName: 'Ada', avatarUrl: null },
      { id: 'u2', displayName: 'Bob', avatarUrl: null },
    ];
    const svc = make(sessions, users);
    const r = await svc.forWorkspace('u1', 'w1', 7);

    expect(r.totalMeetings).toBe(1);
    expect(r.avgMeetingMinutes).toBe(30);
    expect(r.byMember).toEqual([
      { userId: 'u1', displayName: 'Ada', avatarUrl: null, meetings: 1, minutes: 30 },
      { userId: 'u2', displayName: 'Bob', avatarUrl: null, meetings: 1, minutes: 20 },
    ]);
    expect(r.totalMinutes).toBe(50);
    expect(r.byDay).toHaveLength(7); // continuous series
    expect(r.byDay.reduce((s, d) => s + d.minutes, 0)).toBe(50);
  });

  it('treats an ongoing participant (no leftAt / open session) as running until now', async () => {
    const start = new Date(now - min(10));
    const sessions = [
      { id: 's1', startedAt: start, endedAt: null, participants: [{ userId: 'u1', joinedAt: start, leftAt: null }] },
    ];
    const svc = make(sessions, [{ id: 'u1', displayName: 'Ada', avatarUrl: null }]);
    const r = await svc.forWorkspace('u1', 'w1', 7);
    expect(r.byMember[0].minutes).toBe(10);
  });

  it('clamps the range and returns an empty-but-shaped result with no sessions', async () => {
    const svc = make([], []);
    const r = await svc.forWorkspace('u1', 'w1', 999);
    expect(r.rangeDays).toBe(90); // clamped
    expect(r.totalMeetings).toBe(0);
    expect(r.byMember).toEqual([]);
    expect(r.byDay).toHaveLength(90);
  });
});
