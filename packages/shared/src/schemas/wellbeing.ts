export type WellbeingLevel = 'ok' | 'watch' | 'high';

export interface WellbeingSignalDto {
  /** Stable key so the UI can map signals without matching on the label. */
  key: string;
  level: WellbeingLevel;
  label: string;
  detail: string;
}

/** Private, per-member workload snapshot derived from activity data. */
export interface WellbeingReportDto {
  optIn: boolean;
  signals: WellbeingSignalDto[];
  /** A gentle, actionable suggestion when any signal is elevated; null otherwise. */
  nudge: string | null;
}

/** One signal's distribution across opted-in members (never names anyone). */
export interface WellbeingTeamSignalDto {
  key: string;
  label: string;
  ok: number;
  watch: number;
  high: number;
}

/**
 * Anonymised, manager-facing rollup. Only counts members who opted in, and is
 * suppressed entirely below a minimum cohort size to protect individuals.
 */
export interface WellbeingTeamDto {
  /** True when enough members opted in to show aggregates without deanonymising. */
  available: boolean;
  optedInCount: number;
  signals: WellbeingTeamSignalDto[];
}
