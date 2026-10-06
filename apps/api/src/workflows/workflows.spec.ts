import { WorkflowInputSchema } from '@backstages/shared';
import { localSlot, renderTemplate, scheduleSlotDue, severityMeets } from './workflows.service';

describe('renderTemplate', () => {
  it('fills known variables and leaves unknown tokens as typed', () => {
    expect(
      renderTemplate('Hi {{user}} in #{{ channel }} — {{nope}}', { user: 'Ada', channel: 'ops' }),
    ).toBe('Hi Ada in #ops — {{nope}}');
  });

  it('does not interpret replacement patterns in values', () => {
    expect(renderTemplate('{{message}}', { message: "$& $1 $$ it's" })).toBe("$& $1 $$ it's");
  });
});

describe('localSlot / scheduleSlotDue', () => {
  it('reads weekday and HH:MM in the given time zone', () => {
    // 2026-10-05 is a Monday. 23:30 UTC is already Tuesday 08:30 in Tokyo.
    const at = new Date('2026-10-05T23:30:00Z');
    expect(localSlot(at, 'UTC')).toEqual({ day: 1, time: '23:30' });
    expect(localSlot(at, 'Asia/Tokyo')).toEqual({ day: 2, time: '08:30' });
    expect(localSlot(new Date('2026-10-05T00:05:00Z'), 'UTC').time).toBe('00:05'); // never "24:05"
  });

  it('fires for a matching slot inside (from, to] only', () => {
    const cfg = { days: [1], time: '09:00', timeZone: 'UTC' };
    const slot = new Date('2026-10-05T09:00:00Z'); // Monday
    expect(
      scheduleSlotDue(cfg, new Date(slot.getTime() - 30_000), new Date(slot.getTime() + 5_000)),
    ).toBe(true);
    // `from` exactly at the slot excludes it (already handled).
    expect(scheduleSlotDue(cfg, slot, new Date(slot.getTime() + 50_000))).toBe(false);
    // Window ends before the slot.
    expect(
      scheduleSlotDue(cfg, new Date(slot.getTime() - 120_000), new Date(slot.getTime() - 1_000)),
    ).toBe(false);
    // Wrong weekday.
    expect(scheduleSlotDue({ ...cfg, days: [2] }, new Date(slot.getTime() - 30_000), slot)).toBe(
      false,
    );
  });

  it('respects the time zone', () => {
    const cfg = { days: [1], time: '09:00', timeZone: 'America/New_York' };
    const nineNY = new Date('2026-10-05T13:00:00Z'); // EDT = UTC-4
    expect(scheduleSlotDue(cfg, new Date(nineNY.getTime() - 60_000), nineNY)).toBe(true);
    const nineUTC = new Date('2026-10-05T09:00:00Z');
    expect(scheduleSlotDue(cfg, new Date(nineUTC.getTime() - 60_000), nineUTC)).toBe(false);
  });
});

describe('severityMeets', () => {
  it('treats SEV1 as most severe', () => {
    expect(severityMeets('SEV1', 'SEV2')).toBe(true);
    expect(severityMeets('SEV2', 'SEV2')).toBe(true);
    expect(severityMeets('SEV3', 'SEV2')).toBe(false);
    expect(severityMeets('SEV9', 'SEV3')).toBe(false);
  });
});

describe('WorkflowInputSchema', () => {
  it('lifts the legacy single-action message_posted shape', () => {
    const parsed = WorkflowInputSchema.parse({
      name: 'Old',
      trigger: 'message_posted',
      config: { channelId: 'c1', keyword: 'deploy', actionChannelId: 'c2', actionText: 'shipped' },
    });
    expect(parsed.config).toEqual({
      channelId: 'c1',
      keyword: 'deploy',
      actions: [{ type: 'post_message', channelId: 'c2', text: 'shipped' }],
    });
    expect(parsed.enabled).toBe(true);
  });

  it('rejects bad schedules, unknown actions and too many actions', () => {
    const action = { type: 'post_message', channelId: 'c', text: 'x' };
    const sched = (cfg: object) =>
      WorkflowInputSchema.safeParse({ name: 'S', trigger: 'schedule', config: cfg }).success;
    expect(sched({ days: [1], time: '09:00', timeZone: 'Europe/Berlin', actions: [action] })).toBe(
      true,
    );
    expect(sched({ days: [1], time: '9:00', timeZone: 'UTC', actions: [action] })).toBe(false);
    expect(sched({ days: [1], time: '24:00', timeZone: 'UTC', actions: [action] })).toBe(false);
    expect(sched({ days: [], time: '09:00', timeZone: 'UTC', actions: [action] })).toBe(false);
    expect(sched({ days: [1], time: '09:00', timeZone: 'Mars/Olympus', actions: [action] })).toBe(
      false,
    );
    expect(
      sched({
        days: [1],
        time: '09:00',
        timeZone: 'UTC',
        actions: [{ type: 'call_webhook', url: 'x' }],
      }),
    ).toBe(false);
    expect(
      sched({ days: [1], time: '09:00', timeZone: 'UTC', actions: Array(6).fill(action) }),
    ).toBe(false);
    expect(sched({ days: [1], time: '09:00', timeZone: 'UTC', actions: [] })).toBe(false);
  });
});
