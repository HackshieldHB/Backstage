import { digestDue } from './digest.service';

// A fixed reference instant: 2026-08-07T02:30:00Z (a Friday).
// digestDue derives the member-local clock from tzOffsetMin via UTC math, so
// these assertions are independent of the machine timezone.
const FRI_0230_UTC = Date.UTC(2026, 7, 7, 2, 30, 0);

describe('digestDue', () => {
  const base = { optIn: true, tzOffsetMin: 420, lastOn: null }; // +07:00 → local 09:30

  it('fires once the member-local clock passes the morning send hour', () => {
    expect(digestDue(base, FRI_0230_UTC)).toEqual({ due: true, onDate: '2026-08-07' });
  });

  it('does not fire before the local morning send hour', () => {
    // tzOffset 0 → 02:30 local, before 08:00.
    expect(digestDue({ ...base, tzOffsetMin: 0 }, FRI_0230_UTC)).toEqual({
      due: false,
      onDate: '2026-08-07',
    });
  });

  it('does not fire twice on the same member-local day', () => {
    expect(digestDue({ ...base, lastOn: '2026-08-07' }, FRI_0230_UTC).due).toBe(false);
  });

  it('does fire again the next local day', () => {
    // Yesterday's stamp no longer matches today's local date.
    expect(digestDue({ ...base, lastOn: '2026-08-06' }, FRI_0230_UTC).due).toBe(true);
  });

  it('does not fire when the member has not opted in', () => {
    expect(digestDue({ ...base, optIn: false }, FRI_0230_UTC).due).toBe(false);
  });

  it('stamps the member-local date, which can differ from the UTC date', () => {
    // −05:00 at 02:30 UTC is still 21:30 on the previous day, and past 08:00,
    // so it is due and stamped with the local (previous) date.
    const r = digestDue({ ...base, tzOffsetMin: -300 }, FRI_0230_UTC);
    expect(r).toEqual({ due: true, onDate: '2026-08-06' });
  });
});
