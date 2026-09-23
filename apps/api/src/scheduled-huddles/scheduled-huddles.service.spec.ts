import { ScheduledHuddlesService } from './scheduled-huddles.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { PolicyService } from '../authz/policy.service';
import type { NotificationsService } from '../notifications/notifications.service';

/** A due channel huddle, shaped like the Prisma row (+ createdBy include). */
function dueRow(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'h1',
    workspaceId: 'w1',
    channelId: 'c1',
    conversationId: null,
    createdById: 'u1',
    title: 'Sprint sync',
    scheduledFor: new Date(Date.now() - 1000),
    durationMins: 30,
    notifiedAt: null,
    createdAt: new Date(),
    createdBy: { displayName: 'Ada' },
    ...over,
  };
}

describe('ScheduledHuddlesService.fireDue', () => {
  function make(rows: ReturnType<typeof dueRow>[]) {
    const notify = jest.fn().mockResolvedValue(undefined);
    const update = jest.fn().mockResolvedValue(undefined);
    const deleteMany = jest.fn().mockResolvedValue({ count: 0 });
    const prisma = {
      scheduledHuddle: {
        deleteMany,
        findMany: jest.fn().mockResolvedValue(rows),
        update,
      },
      channelMember: {
        findMany: jest.fn().mockResolvedValue([{ userId: 'u1' }, { userId: 'u2' }]),
      },
      conversationMember: {
        findMany: jest.fn().mockResolvedValue([{ userId: 'u3' }, { userId: 'u4' }]),
      },
    } as unknown as PrismaService;
    const svc = new ScheduledHuddlesService(
      prisma,
      {} as PolicyService,
      { notify } as unknown as NotificationsService,
    );
    return { svc, notify, update, deleteMany, prisma };
  }

  it('notifies every channel member and marks the row fired', async () => {
    const { svc, notify, update } = make([dueRow()]);
    const n = await svc.fireDue(new Date());
    expect(n).toBe(1);
    expect(notify).toHaveBeenCalledTimes(2); // u1 + u2
    expect(notify.mock.calls[0][0]).toMatchObject({
      type: 'SYSTEM',
      channelId: 'c1',
      payload: { source: 'scheduled-huddle', scheduledHuddleId: 'h1', title: 'Sprint sync' },
    });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'h1' }, data: expect.objectContaining({ notifiedAt: expect.any(Date) }) }),
    );
  });

  it('notifies conversation members for a DM huddle', async () => {
    const { svc, notify } = make([dueRow({ channelId: null, conversationId: 'cv1' })]);
    await svc.fireDue(new Date());
    expect(notify).toHaveBeenCalledTimes(2); // u3 + u4
    expect(notify.mock.calls[0][0]).toMatchObject({ conversationId: 'cv1' });
  });

  it('still marks a row fired when notifying throws, so it is not retried forever', async () => {
    const { svc, notify, update } = make([dueRow()]);
    notify.mockRejectedValueOnce(new Error('boom'));
    const n = await svc.fireDue(new Date());
    expect(n).toBe(0); // counted as not fired
    expect(update).toHaveBeenCalled(); // but still marked
  });

  it('prunes rows well past their start time', async () => {
    const { svc, deleteMany } = make([]);
    await svc.fireDue(new Date());
    expect(deleteMany).toHaveBeenCalled();
  });
});
