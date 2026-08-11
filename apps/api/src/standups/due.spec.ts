import { isDue, localTime, parseDays, parseHHMM, scheduleDate } from './due';

// A fixed reference instant: 2026-08-07 is a Friday (weekday 5) in UTC.
// 2026-08-07T02:30:00Z.
const FRI_0230_UTC = Date.UTC(2026, 7, 7, 2, 30, 0);

describe('localTime', () => {
  it('reads the local wall clock for a positive offset (Jakarta +420)', () => {
    // 02:30 UTC + 7h = 09:30 local, still Friday.
    const lt = localTime(FRI_0230_UTC, 420);
    expect(lt.date).toBe('2026-08-07');
    expect(lt.weekday).toBe(5);
    expect(lt.minutes).toBe(9 * 60 + 30);
  });

  it('rolls the local date back across UTC midnight for a negative offset', () => {
    // 2026-08-07T02:30Z − 5h = 2026-08-06 21:30 local (Thursday, weekday 4).
    const lt = localTime(FRI_0230_UTC, -300);
    expect(lt.date).toBe('2026-08-06');
    expect(lt.weekday).toBe(4);
    expect(lt.minutes).toBe(21 * 60 + 30);
  });
});

describe('parseHHMM / parseDays', () => {
  it('parses time and weekday lists', () => {
    expect(parseHHMM('09:30')).toBe(570);
    expect(parseDays('1,2,3,4,5')).toEqual([1, 2, 3, 4, 5]);
    expect(parseDays('0, 6')).toEqual([0, 6]);
    expect(parseDays('7,x,')).toEqual([]); // out-of-range / junk dropped
  });
});

describe('isDue', () => {
  const base = { timeOfDay: '09:00', days: '1,2,3,4,5', tzOffsetMin: 420, lastRunOn: null, active: true };

  it('fires once the local time reaches the scheduled minute on a scheduled day', () => {
    // Local Friday 09:30, weekday included, past 09:00, not run yet.
    expect(isDue(base, FRI_0230_UTC)).toEqual({ due: true, onDate: '2026-08-07' });
  });

  it('does not fire before the scheduled time', () => {
    expect(isDue({ ...base, timeOfDay: '10:00' }, FRI_0230_UTC)).toEqual({
      due: false,
      onDate: '2026-08-07',
    });
  });

  it('does not fire twice on the same local day', () => {
    expect(isDue({ ...base, lastRunOn: '2026-08-07' }, FRI_0230_UTC).due).toBe(false);
  });

  it('does not fire on an unscheduled weekday', () => {
    // Weekend-only schedule; local day is Friday.
    expect(isDue({ ...base, days: '0,6' }, FRI_0230_UTC).due).toBe(false);
  });

  it('does not fire when inactive', () => {
    expect(isDue({ ...base, active: false }, FRI_0230_UTC).due).toBe(false);
  });
});

describe('scheduleDate', () => {
  it('returns the schedule-local date', () => {
    expect(scheduleDate(FRI_0230_UTC, 420)).toBe('2026-08-07');
    expect(scheduleDate(FRI_0230_UTC, -300)).toBe('2026-08-06');
  });
});
