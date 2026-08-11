/**
 * Pure scheduling helpers for standups. Kept side-effect-free so the "should it
 * fire now?" decision — the fiddly, timezone-sensitive part — is unit-testable
 * without a database or a running clock.
 */

export interface LocalTime {
  /** yyyy-mm-dd in the schedule's local time. */
  date: string;
  /** 0 = Sunday … 6 = Saturday, in local time. */
  weekday: number;
  /** Minutes since local midnight. */
  minutes: number;
}

/** Read the local wall clock for a UTC instant shifted by `tzOffsetMin`. */
export function localTime(nowMs: number, tzOffsetMin: number): LocalTime {
  const local = new Date(nowMs + tzOffsetMin * 60_000);
  const y = local.getUTCFullYear();
  const m = String(local.getUTCMonth() + 1).padStart(2, '0');
  const d = String(local.getUTCDate()).padStart(2, '0');
  return {
    date: `${y}-${m}-${d}`,
    weekday: local.getUTCDay(),
    minutes: local.getUTCHours() * 60 + local.getUTCMinutes(),
  };
}

export function parseHHMM(s: string): number {
  const [h, m] = s.split(':').map(Number);
  return h * 60 + m;
}

export function parseDays(csv: string): number[] {
  return csv
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map(Number)
    .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
}

export interface DueInput {
  timeOfDay: string;
  days: string;
  tzOffsetMin: number;
  lastRunOn: string | null;
  active: boolean;
}

/**
 * Should this standup's prompt fire at `nowMs`? True only when it is active,
 * today is a scheduled weekday, the local clock has reached `timeOfDay`, and it
 * has not already fired today. `onDate` is the schedule-local date to stamp.
 */
export function isDue(s: DueInput, nowMs: number): { due: boolean; onDate: string } {
  const lt = localTime(nowMs, s.tzOffsetMin);
  const onDate = lt.date;
  if (!s.active) return { due: false, onDate };
  if (!parseDays(s.days).includes(lt.weekday)) return { due: false, onDate };
  if (lt.minutes < parseHHMM(s.timeOfDay)) return { due: false, onDate };
  if (s.lastRunOn === onDate) return { due: false, onDate };
  return { due: true, onDate };
}

/** The schedule-local date ("today") for reading/writing responses. */
export function scheduleDate(nowMs: number, tzOffsetMin: number): string {
  return localTime(nowMs, tzOffsetMin).date;
}
