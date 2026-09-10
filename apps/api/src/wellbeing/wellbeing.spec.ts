import {
  buildTeamReport,
  computeSignals,
  nudgeFor,
  type Seg,
} from './wellbeing.service';
import type { WellbeingSignalDto } from '@backstages/shared';

// Dates are built with the local Date constructor and read back with local
// getHours()/getDay(), so these tests are deterministic regardless of the
// machine timezone. Aug 1 2026 is a Saturday, so Aug 5 is a Wednesday.
const WED = 5;
const SAT = 8;
function seg(kind: string, day: number, hour: number, hours: number): Seg {
  return {
    kind,
    durationSec: Math.round(hours * 3600),
    startedAt: new Date(2026, 7, day, hour, 0, 0),
    endedAt: null,
  };
}
const level = (signals: WellbeingSignalDto[], key: string) =>
  signals.find((s) => s.key === key)!.level;

describe('computeSignals', () => {
  it('reports all-ok for an empty week', () => {
    const s = computeSignals([]);
    expect(level(s, 'meeting')).toBe('ok');
    expect(level(s, 'after_hours')).toBe('ok');
    expect(level(s, 'weekend')).toBe('ok');
    expect(level(s, 'fragmentation')).toBe('ok');
  });

  it('bands meeting load at the 8h/15h thresholds', () => {
    expect(level(computeSignals([seg('MEETING', WED, 10, 7)]), 'meeting')).toBe('ok');
    expect(level(computeSignals([seg('MEETING', WED, 10, 9)]), 'meeting')).toBe('watch');
    expect(level(computeSignals([seg('MEETING', WED, 10, 16)]), 'meeting')).toBe('high');
  });

  it('counts activity before 7am / after 8pm as after-hours', () => {
    // 6h of implementation starting 22:00 on a weekday → after-hours high.
    const s = computeSignals([seg('IMPLEMENTATION', WED, 22, 6)]);
    expect(level(s, 'after_hours')).toBe('high');
    expect(level(s, 'meeting')).toBe('ok'); // non-meeting kind
    expect(level(s, 'weekend')).toBe('ok'); // weekday
  });

  it('counts Saturday/Sunday activity as weekend work', () => {
    const s = computeSignals([seg('IMPLEMENTATION', SAT, 10, 5)]);
    expect(level(s, 'weekend')).toBe('high'); // 5h ≥ 4h
    expect(level(s, 'after_hours')).toBe('ok'); // 10:00 is daytime
  });

  it('treats many short sessions as fragmentation', () => {
    const many = Array.from({ length: 80 }, () => seg('COLLABORATION', WED, 10, 0.1));
    expect(level(computeSignals(many), 'fragmentation')).toBe('high');
    const few = Array.from({ length: 10 }, () => seg('COLLABORATION', WED, 10, 0.1));
    expect(level(computeSignals(few), 'fragmentation')).toBe('ok');
  });
});

describe('nudgeFor', () => {
  const sig = (key: string, lvl: 'ok' | 'watch' | 'high'): WellbeingSignalDto => ({
    key,
    level: lvl,
    label: key,
    detail: '',
  });

  it('returns null when nothing is elevated', () => {
    expect(nudgeFor([sig('meeting', 'ok'), sig('after_hours', 'watch')])).toBeNull();
  });

  it('surfaces the first elevated signal in priority order', () => {
    const nudge = nudgeFor([sig('meeting', 'high'), sig('weekend', 'high')]);
    expect(nudge).toMatch(/meeting load/i);
  });

  it('nudges on after-hours when it is the only high signal', () => {
    expect(nudgeFor([sig('meeting', 'ok'), sig('after_hours', 'high')])).toMatch(/evenings/i);
  });
});

describe('buildTeamReport', () => {
  const high = computeSignals([seg('MEETING', WED, 10, 16)]); // meeting=high
  const calm = computeSignals([]); // all ok

  it('suppresses the aggregate below the minimum cohort', () => {
    const r = buildTeamReport([high, calm], 2);
    expect(r.available).toBe(false);
    expect(r.signals).toEqual([]);
    expect(r.optedInCount).toBe(2);
  });

  it('tallies levels per signal once the cohort is large enough', () => {
    const r = buildTeamReport([high, calm, calm], 3);
    expect(r.available).toBe(true);
    const meeting = r.signals.find((s) => s.key === 'meeting')!;
    expect(meeting.high).toBe(1);
    expect(meeting.ok).toBe(2);
    expect(meeting.high + meeting.watch + meeting.ok).toBe(3); // never leaks a name, only counts
  });
});
