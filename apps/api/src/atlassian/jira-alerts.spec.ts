import { alertDue } from './jira-alerts.service';

// 2026-08-07T02:30:00Z (a Friday). alertDue derives the rule-local clock from
// tzOffsetMin via UTC math, so these assertions are timezone-independent.
const FRI_0230_UTC = Date.UTC(2026, 7, 7, 2, 30, 0);

describe('alertDue', () => {
  const base = { active: true, timeOfDay: '09:00', tzOffsetMin: 420, lastRunOn: null }; // +07:00 → 09:30 local

  it('fires once the rule-local clock passes the scheduled time', () => {
    expect(alertDue(base, FRI_0230_UTC)).toEqual({ due: true, onDate: '2026-08-07' });
  });

  it('does not fire before the scheduled time', () => {
    expect(alertDue({ ...base, timeOfDay: '10:00' }, FRI_0230_UTC).due).toBe(false);
  });

  it('does not fire twice on the same rule-local day', () => {
    expect(alertDue({ ...base, lastRunOn: '2026-08-07' }, FRI_0230_UTC).due).toBe(false);
  });

  it('fires again the next local day', () => {
    expect(alertDue({ ...base, lastRunOn: '2026-08-06' }, FRI_0230_UTC).due).toBe(true);
  });

  it('does not fire when paused', () => {
    expect(alertDue({ ...base, active: false }, FRI_0230_UTC).due).toBe(false);
  });

  it('stamps the rule-local date across a UTC-midnight offset', () => {
    // −05:00 at 02:30 UTC → 21:30 previous day, past 09:00, so due on the local date.
    expect(alertDue({ ...base, tzOffsetMin: -300 }, FRI_0230_UTC)).toEqual({ due: true, onDate: '2026-08-06' });
  });
});
