import type { MeetingRecurrence } from '@backstages/shared';

/**
 * Recurrence maths for scheduled meetings. Occurrences keep the organiser's local
 * wall-clock time in their IANA zone (so a 09:00 Jakarta stand-up stays at 09:00
 * there, and "weekdays" means Mon–Fri in that zone, not in UTC).
 */

/** The zone if the runtime knows it, else null (callers fall back to UTC). */
export function validTimeZone(tz: string | null | undefined): string | null {
  if (!tz) return null;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return null;
  }
}

interface WallTime {
  y: number;
  m: number; // 0-based
  d: number;
  h: number;
  mi: number;
  s: number;
}

function wallTime(t: number, tz: string): WallTime {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(t));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { y: get('year'), m: get('month') - 1, d: get('day'), h: get('hour'), mi: get('minute'), s: get('second') };
}

/** Offset (ms) of `tz` from UTC at instant `t`. */
function offsetAt(t: number, tz: string): number {
  const w = wallTime(t, tz);
  return Date.UTC(w.y, w.m, w.d, w.h, w.mi, w.s) - Math.floor(t / 1000) * 1000;
}

/** The UTC instant at which the wall clock in `tz` reads `w`. */
function fromWallTime(w: WallTime, tz: string): number {
  const guess = Date.UTC(w.y, w.m, w.d, w.h, w.mi, w.s);
  const first = guess - offsetAt(guess, tz);
  // Re-check once at the candidate instant so a DST change between the guess
  // and the result is accounted for.
  return guess - offsetAt(first, tz);
}

/** Day of week (0 = Sunday) of the local calendar date in `w`. */
function weekday(w: WallTime): number {
  return new Date(Date.UTC(w.y, w.m, w.d)).getUTCDay();
}

/** The occurrence after `start` for a rule, or null for a one-off meeting. */
export function nextOccurrence(start: Date, rule: MeetingRecurrence, timeZone: string | null): Date | null {
  if (rule === 'NONE') return null;
  const tz = validTimeZone(timeZone) ?? 'UTC';
  const w = wallTime(start.getTime(), tz);
  let step = rule === 'WEEKLY' ? 7 : 1;
  for (;;) {
    const candidate: WallTime = { ...w, d: w.d + step };
    // Normalise the calendar date (e.g. Jan 32 → Feb 1) before reading its weekday.
    const norm = new Date(Date.UTC(candidate.y, candidate.m, candidate.d));
    const next: WallTime = {
      ...w,
      y: norm.getUTCFullYear(),
      m: norm.getUTCMonth(),
      d: norm.getUTCDate(),
    };
    if (rule === 'WEEKDAYS') {
      const wd = weekday(next);
      if (wd === 0 || wd === 6) {
        step++;
        continue;
      }
    }
    return new Date(fromWallTime(next, tz) + (start.getTime() % 1000));
  }
}

/** The first occurrence strictly after `after`, walking forward from `start`
 *  (used when the server was down across one or more occurrences). Returns null
 *  for a one-off meeting. */
export function nextOccurrenceAfter(
  start: Date,
  rule: MeetingRecurrence,
  timeZone: string | null,
  after: Date,
): Date | null {
  let cur: Date | null = start;
  // A daily meeting missed for a year is ~365 steps; cap well above that.
  for (let i = 0; i < 1000 && cur; i++) {
    cur = nextOccurrence(cur, rule, timeZone);
    if (cur && cur.getTime() > after.getTime()) return cur;
  }
  return null;
}

/** Future occurrences after `start` (exclusive) that begin before `to`, at most
 *  `max` of them. Used to project a recurring meeting onto the calendar. */
export function projectOccurrences(
  start: Date,
  rule: MeetingRecurrence,
  timeZone: string | null,
  to: Date,
  max = 100,
): Date[] {
  const out: Date[] = [];
  let cur: Date | null = start;
  while (out.length < max) {
    cur = nextOccurrence(cur, rule, timeZone);
    if (!cur || cur.getTime() >= to.getTime()) break;
    out.push(cur);
  }
  return out;
}
