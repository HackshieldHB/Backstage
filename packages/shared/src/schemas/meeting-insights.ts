/** Meeting-load analytics derived from persisted huddle sessions. Read-only. */

export interface MeetingInsightsMember {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  /** Distinct huddle sessions this member joined in the range. */
  meetings: number;
  /** Total minutes spent in huddles in the range. */
  minutes: number;
}

export interface MeetingInsightsDay {
  /** yyyy-mm-dd (UTC). */
  date: string;
  minutes: number;
  meetings: number;
}

export interface MeetingInsightsDto {
  /** Size of the window analysed, in days. */
  rangeDays: number;
  /** Distinct huddle sessions in the range. */
  totalMeetings: number;
  /** Total participant-minutes across everyone (sum of per-member minutes). */
  totalMinutes: number;
  /** Average meeting length in minutes (per session, wall-clock). */
  avgMeetingMinutes: number;
  /** Per-member breakdown, busiest first. */
  byMember: MeetingInsightsMember[];
  /** Daily totals (participant-minutes), oldest first. */
  byDay: MeetingInsightsDay[];
}
