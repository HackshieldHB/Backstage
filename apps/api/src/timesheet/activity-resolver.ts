import { ACTIVITY_PRIORITY, type ActivityKind } from '@backstages/shared';

/** A raw activity block. `end` may be null for an ongoing segment. */
export interface RawSegment {
  kind: ActivityKind;
  start: number; // epoch ms
  end: number | null; // epoch ms, null = ongoing
}

export interface ResolvedInterval {
  kind: ActivityKind;
  start: number;
  end: number;
}

/**
 * Sweep-line resolver: collapses overlapping activity blocks into a single
 * non-overlapping timeline where, at every instant, the highest-priority active
 * kind wins (see ACTIVITY_PRIORITY). Ongoing segments (end === null) are clipped
 * to `now`. Everything is clipped to [windowStart, windowEnd]. Adjacent slices
 * of the same kind are coalesced.
 *
 * This is the one place that decides "what was this person doing at time T", so
 * it stays pure and side-effect-free for straightforward testing.
 */
export function resolveSegments(
  segments: RawSegment[],
  windowStart: number,
  windowEnd: number,
  now: number = Date.now(),
): ResolvedInterval[] {
  const clipEnd = Math.min(windowEnd, now);
  // Clip to the window; drop empty/degenerate blocks.
  const clipped = segments
    .map((s) => ({
      kind: s.kind,
      start: Math.max(s.start, windowStart),
      end: Math.min(s.end ?? clipEnd, clipEnd),
    }))
    .filter((s) => s.end > s.start);
  if (clipped.length === 0) return [];

  // Elementary intervals between every distinct boundary.
  const bounds = Array.from(
    new Set(clipped.flatMap((s) => [s.start, s.end])),
  ).sort((a, b) => a - b);

  const out: ResolvedInterval[] = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const t0 = bounds[i];
    const t1 = bounds[i + 1];
    if (t1 <= t0) continue;
    let winner: ActivityKind | null = null;
    for (const s of clipped) {
      if (s.start <= t0 && s.end >= t1) {
        if (winner === null || ACTIVITY_PRIORITY[s.kind] > ACTIVITY_PRIORITY[winner]) {
          winner = s.kind;
        }
      }
    }
    if (winner === null) continue;
    const last = out[out.length - 1];
    if (last && last.kind === winner && last.end === t0) {
      last.end = t1; // coalesce
    } else {
      out.push({ kind: winner, start: t0, end: t1 });
    }
  }
  return out;
}

/** Total seconds per kind across resolved (non-overlapping) intervals. */
export function sumByKind(intervals: ResolvedInterval[]): Record<ActivityKind, number> {
  const totals = Object.fromEntries(
    Object.keys(ACTIVITY_PRIORITY).map((k) => [k, 0]),
  ) as Record<ActivityKind, number>;
  for (const iv of intervals) {
    totals[iv.kind] += Math.round((iv.end - iv.start) / 1000);
  }
  return totals;
}
