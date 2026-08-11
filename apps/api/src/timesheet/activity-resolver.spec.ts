import { resolveSegments, sumByKind, type RawSegment } from './activity-resolver';

const H = 3600 * 1000; // one hour in ms
const base = Date.UTC(2026, 0, 1, 9, 0, 0); // 09:00
const at = (hoursFromBase: number) => base + hoursFromBase * H;

describe('resolveSegments', () => {
  const windowStart = at(0);
  const windowEnd = at(8);
  const now = at(8);

  it('passes non-overlapping segments through unchanged', () => {
    const segs: RawSegment[] = [
      { kind: 'MEETING', start: at(0), end: at(1) },
      { kind: 'IMPLEMENTATION', start: at(2), end: at(3) },
    ];
    const out = resolveSegments(segs, windowStart, windowEnd, now);
    expect(out).toEqual([
      { kind: 'MEETING', start: at(0), end: at(1) },
      { kind: 'IMPLEMENTATION', start: at(2), end: at(3) },
    ]);
  });

  it('lets the higher-priority kind win in an overlap', () => {
    // Implementation 0–4h, meeting 1–2h in the middle.
    const segs: RawSegment[] = [
      { kind: 'IMPLEMENTATION', start: at(0), end: at(4) },
      { kind: 'MEETING', start: at(1), end: at(2) },
    ];
    const out = resolveSegments(segs, windowStart, windowEnd, now);
    expect(out).toEqual([
      { kind: 'IMPLEMENTATION', start: at(0), end: at(1) },
      { kind: 'MEETING', start: at(1), end: at(2) },
      { kind: 'IMPLEMENTATION', start: at(2), end: at(4) },
    ]);
  });

  it('treats ONLINE as a baseline that positive activity carves into', () => {
    const segs: RawSegment[] = [
      { kind: 'ONLINE', start: at(0), end: at(4) },
      { kind: 'MEETING', start: at(1), end: at(2) },
    ];
    const out = resolveSegments(segs, windowStart, windowEnd, now);
    const totals = sumByKind(out);
    expect(totals.MEETING).toBe(3600);
    expect(totals.ONLINE).toBe(3 * 3600); // 4h online minus the 1h meeting
  });

  it('clips ongoing segments to now and to the window', () => {
    const segs: RawSegment[] = [{ kind: 'ONLINE', start: at(6), end: null }];
    const out = resolveSegments(segs, windowStart, windowEnd, at(7));
    expect(out).toEqual([{ kind: 'ONLINE', start: at(6), end: at(7) }]);
  });

  it('coalesces adjacent slices of the same kind', () => {
    const segs: RawSegment[] = [
      { kind: 'IMPLEMENTATION', start: at(0), end: at(1) },
      { kind: 'IMPLEMENTATION', start: at(1), end: at(2) },
    ];
    const out = resolveSegments(segs, windowStart, windowEnd, now);
    expect(out).toEqual([{ kind: 'IMPLEMENTATION', start: at(0), end: at(2) }]);
  });

  it('returns nothing for an empty input', () => {
    expect(resolveSegments([], windowStart, windowEnd, now)).toEqual([]);
  });
});
