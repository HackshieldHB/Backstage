import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ScheduledHuddlesService } from './scheduled-huddles.service';
import { nextOccurrence, nextOccurrenceAfter, projectOccurrences } from './recurrence';
import type { PrismaService } from '../prisma/prisma.service';
import type { PolicyService } from '../authz/policy.service';
import type { NotificationsService } from '../notifications/notifications.service';

const MIN = 60_000;

/** A meeting row shaped like the Prisma model. */
function row(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'h1',
    workspaceId: 'w1',
    channelId: 'c1',
    conversationId: null,
    createdById: 'u1',
    title: 'Sprint sync',
    description: null,
    scheduledFor: new Date(Date.now() - 1000),
    durationMins: 30,
    reminderMins: 10,
    reminderSentAt: null,
    notifiedAt: null,
    recurrence: 'NONE',
    timeZone: null,
    seriesId: null,
    createdAt: new Date(),
    ...over,
  };
}

type Row = ReturnType<typeof row>;

function make(opts: { soon?: Row[]; due?: Row[]; declined?: string[]; claim?: number } = {}) {
  const notify = jest.fn().mockResolvedValue(undefined);
  const updateMany = jest.fn().mockResolvedValue({ count: opts.claim ?? 1 });
  const deleteMany = jest.fn().mockResolvedValue({ count: 1 });
  const create = jest.fn().mockResolvedValue({});
  const findMany = jest.fn((args: { where: Record<string, unknown> }) =>
    Promise.resolve('reminderMins' in args.where ? (opts.soon ?? []) : (opts.due ?? [])),
  );
  const responses = {
    findMany: jest.fn().mockResolvedValue((opts.declined ?? []).map((userId) => ({ userId }))),
    findUnique: jest.fn().mockResolvedValue(null),
    upsert: jest.fn().mockResolvedValue({}),
    deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
  };
  const prisma = {
    scheduledHuddle: { deleteMany, findMany, updateMany, create, findUnique: jest.fn(), findFirst: jest.fn() },
    scheduledHuddleResponse: responses,
    channelMember: {
      findMany: jest.fn().mockResolvedValue([{ userId: 'u1' }, { userId: 'u2' }, { userId: 'u3' }]),
    },
    conversationMember: {
      findMany: jest.fn().mockResolvedValue([{ userId: 'u4' }, { userId: 'u5' }]),
    },
    user: { findUnique: jest.fn().mockResolvedValue({ displayName: 'Ada' }) },
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(prisma));
  const policy = {
    requireChannelMember: jest.fn().mockResolvedValue({}),
    requireConversationMember: jest.fn().mockResolvedValue({}),
  };
  const svc = new ScheduledHuddlesService(
    prisma as unknown as PrismaService,
    policy as unknown as PolicyService,
    { notify } as unknown as NotificationsService,
  );
  return { svc, notify, prisma, policy };
}

const recipients = (notify: jest.Mock) => notify.mock.calls.map((c) => c[0].userId).sort();
const kinds = (notify: jest.Mock) => notify.mock.calls.map((c) => c[0].payload.kind);

describe('ScheduledHuddlesService.fireDue — early reminder', () => {
  it('reminds guests reminderMins before the start, with the minutes left', async () => {
    const now = new Date();
    const h = row({ scheduledFor: new Date(now.getTime() + 10 * MIN), reminderMins: 10 });
    const { svc, notify, prisma } = make({ soon: [h] });
    expect(await svc.fireDue(now)).toBe(1);
    expect(recipients(notify)).toEqual(['u1', 'u2', 'u3']);
    expect(notify.mock.calls[0][0]).toMatchObject({
      type: 'SYSTEM',
      channelId: 'c1',
      payload: { source: 'scheduled-huddle', kind: 'reminder', minutes: 10, scheduledHuddleId: 'h1' },
    });
    // Claimed before sending, guarded on the time it was read with.
    expect(prisma.scheduledHuddle.updateMany).toHaveBeenCalledWith({
      where: { id: 'h1', reminderSentAt: null, notifiedAt: null, scheduledFor: h.scheduledFor },
      data: { reminderSentAt: now },
    });
  });

  it('waits until the reminder window opens', async () => {
    const now = new Date();
    const h = row({ scheduledFor: new Date(now.getTime() + 30 * MIN), reminderMins: 15 });
    const { svc, notify, prisma } = make({ soon: [h] });
    expect(await svc.fireDue(now)).toBe(0);
    expect(notify).not.toHaveBeenCalled();
    expect(prisma.scheduledHuddle.updateMany).not.toHaveBeenCalled();
  });

  it('skips guests who declined', async () => {
    const now = new Date();
    const h = row({ scheduledFor: new Date(now.getTime() + 5 * MIN), reminderMins: 15 });
    const { svc, notify } = make({ soon: [h], declined: ['u2'] });
    await svc.fireDue(now);
    expect(recipients(notify)).toEqual(['u1', 'u3']);
  });

  it('sends nothing when another worker already claimed it', async () => {
    const now = new Date();
    const h = row({ scheduledFor: new Date(now.getTime() + 5 * MIN) });
    const { svc, notify } = make({ soon: [h], claim: 0 });
    expect(await svc.fireDue(now)).toBe(0);
    expect(notify).not.toHaveBeenCalled();
  });
});

describe('ScheduledHuddlesService.fireDue — start', () => {
  it('notifies every member that it is starting and does not repeat a one-off', async () => {
    const { svc, notify, prisma } = make({ due: [row()] });
    expect(await svc.fireDue(new Date())).toBe(1);
    expect(kinds(notify)).toEqual(['starting', 'starting', 'starting']);
    expect(prisma.scheduledHuddle.create).not.toHaveBeenCalled();
  });

  it('notifies conversation members for a DM meeting', async () => {
    const { svc, notify } = make({ due: [row({ channelId: null, conversationId: 'cv1' })] });
    await svc.fireDue(new Date());
    expect(recipients(notify)).toEqual(['u4', 'u5']);
    expect(notify.mock.calls[0][0]).toMatchObject({ conversationId: 'cv1' });
  });

  it('counts a failed notice as not fired but keeps it claimed', async () => {
    const { svc, notify, prisma } = make({ due: [row()] });
    notify.mockRejectedValueOnce(new Error('boom'));
    expect(await svc.fireDue(new Date())).toBe(0);
    expect(prisma.scheduledHuddle.updateMany).toHaveBeenCalled();
  });

  it('creates the next occurrence of a weekly meeting', async () => {
    const start = new Date(Date.now() - 1000);
    const { svc, prisma } = make({ due: [row({ scheduledFor: start, recurrence: 'WEEKLY', seriesId: 'h1' })] });
    await svc.fireDue(new Date());
    expect(prisma.scheduledHuddle.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        scheduledFor: new Date(start.getTime() + 7 * 24 * 60 * MIN),
        recurrence: 'WEEKLY',
        seriesId: 'h1',
        title: 'Sprint sync',
      }),
    });
  });

  it('stays quiet about a meeting long over (server was down) but still moves the series on', async () => {
    const now = new Date();
    const start = new Date(now.getTime() - 3 * 24 * 60 * MIN); // 3 days ago
    const { svc, notify, prisma } = make({ due: [row({ scheduledFor: start, recurrence: 'DAILY' })] });
    expect(await svc.fireDue(now)).toBe(0);
    expect(notify).not.toHaveBeenCalled();
    const next = prisma.scheduledHuddle.create.mock.calls[0][0].data.scheduledFor as Date;
    expect(next.getTime()).toBeGreaterThan(now.getTime());
    expect(next.getTime() - now.getTime()).toBeLessThanOrEqual(24 * 60 * MIN);
  });

  it('prunes rows past the retention window', async () => {
    const now = new Date();
    const { svc, prisma } = make();
    await svc.fireDue(now);
    const cutoff = prisma.scheduledHuddle.deleteMany.mock.calls[0][0].where.scheduledFor.lt as Date;
    expect(now.getTime() - cutoff.getTime()).toBe(30 * 24 * 60 * MIN);
  });
});

describe('ScheduledHuddlesService — organiser and guest actions', () => {
  it('only the organiser can edit', async () => {
    const { svc, prisma } = make();
    prisma.scheduledHuddle.findUnique.mockResolvedValue(row({ scheduledFor: new Date(Date.now() + 60 * MIN) }));
    await expect(svc.update('u2', 'h1', { title: 'New' })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses to edit a meeting that already started', async () => {
    const { svc, prisma } = make();
    prisma.scheduledHuddle.findUnique.mockResolvedValue(row({ notifiedAt: new Date() }));
    await expect(svc.update('u1', 'h1', { title: 'New' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('tells the organiser when a guest answers', async () => {
    const { svc, notify, prisma } = make();
    prisma.scheduledHuddle.findUnique.mockResolvedValue(row({ scheduledFor: new Date(Date.now() + 60 * MIN) }));
    jest.spyOn(svc as never, 'dtoById' as never).mockResolvedValue({} as never);
    await svc.respond('u2', 'h1', 'DECLINED');
    expect(prisma.scheduledHuddleResponse.upsert).toHaveBeenCalled();
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][0]).toMatchObject({
      userId: 'u1',
      actorId: 'u2',
      payload: { kind: 'response', response: 'DECLINED' },
    });
  });

  it('skipping one occurrence moves a recurring meeting to the next one', async () => {
    const start = new Date(Date.now() + 60 * MIN);
    const { svc, notify, prisma } = make();
    prisma.scheduledHuddle.findFirst.mockResolvedValue(row({ scheduledFor: start, recurrence: 'DAILY' }));
    expect(await svc.cancel('u1', 'h1', 'occurrence')).toEqual({ ok: true });
    expect(prisma.scheduledHuddle.updateMany).toHaveBeenCalledWith({
      where: { id: 'h1', scheduledFor: start, notifiedAt: null },
      data: { scheduledFor: new Date(start.getTime() + 24 * 60 * MIN), reminderSentAt: null },
    });
    expect(prisma.scheduledHuddle.deleteMany).not.toHaveBeenCalled();
    expect(kinds(notify)).toEqual(['cancelled', 'cancelled']); // u2 + u3, not the organiser
  });

  it('cancelling a series also removes its upcoming occurrence', async () => {
    const { svc, prisma } = make();
    prisma.scheduledHuddle.findFirst.mockResolvedValue(row({ recurrence: 'WEEKLY', seriesId: 's1', notifiedAt: new Date() }));
    await svc.cancel('u1', 'h1', 'series');
    expect(prisma.scheduledHuddle.deleteMany).toHaveBeenCalledWith({
      where: { createdById: 'u1', OR: [{ id: 'h1' }, { seriesId: 's1', notifiedAt: null }] },
    });
  });

  it("a non-organiser's cancel is a silent no-op", async () => {
    const { svc, prisma } = make();
    prisma.scheduledHuddle.findFirst.mockResolvedValue(null);
    expect(await svc.cancel('u2', 'h1')).toEqual({ ok: false });
    expect(prisma.scheduledHuddle.deleteMany).not.toHaveBeenCalled();
  });
});

describe('recurrence', () => {
  it('keeps a weekday meeting on Mon–Fri in the organiser’s zone', () => {
    // Fri 09:00 Jakarta (UTC+7) = Fri 02:00Z → Mon 09:00 Jakarta.
    const fri = new Date('2026-10-23T02:00:00Z');
    expect(nextOccurrence(fri, 'WEEKDAYS', 'Asia/Jakarta')?.toISOString()).toBe('2026-10-26T02:00:00.000Z');
  });

  it('uses the local weekday, not the UTC one', () => {
    // Mon 06:00 Jakarta is Sun 23:00Z — the next weekday is Tue 06:00 Jakarta.
    const mon = new Date('2026-10-25T23:00:00Z');
    expect(nextOccurrence(mon, 'WEEKDAYS', 'Asia/Jakarta')?.toISOString()).toBe('2026-10-26T23:00:00.000Z');
  });

  it('keeps the local time across a DST change', () => {
    // 09:00 New York on Fri 30 Oct 2026 (EDT, 13:00Z) → Fri 6 Nov (EST, 14:00Z).
    const d = new Date('2026-10-30T13:00:00Z');
    expect(nextOccurrence(d, 'WEEKLY', 'America/New_York')?.toISOString()).toBe('2026-11-06T14:00:00.000Z');
  });

  it('rolls daily over a month end and falls back to UTC for an unknown zone', () => {
    const d = new Date('2026-10-31T10:30:00Z');
    expect(nextOccurrence(d, 'DAILY', 'Not/AZone')?.toISOString()).toBe('2026-11-01T10:30:00.000Z');
  });

  it('a one-off meeting has no next occurrence', () => {
    expect(nextOccurrence(new Date(), 'NONE', null)).toBeNull();
    expect(nextOccurrenceAfter(new Date(), 'NONE', null, new Date())).toBeNull();
  });

  it('projects occurrences up to the end of a range', () => {
    const d = new Date('2026-10-19T02:00:00Z'); // Mon
    const out = projectOccurrences(d, 'WEEKDAYS', 'Asia/Jakarta', new Date('2026-10-27T00:00:00Z'));
    expect(out.map((x) => x.toISOString().slice(0, 10))).toEqual([
      '2026-10-20',
      '2026-10-21',
      '2026-10-22',
      '2026-10-23',
      '2026-10-26',
    ]);
  });
});
