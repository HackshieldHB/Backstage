/** Persisted meeting record (captured transcript + AI minutes). Read + light actions. */

export interface MeetingTranscriptLine {
  userId: string;
  name: string;
  text: string;
  /** ISO timestamp. */
  at: string;
  kind: 'caption' | 'chat';
}

/** Compact row for the meeting-history list. */
export interface MeetingRecordSummaryDto {
  id: string;
  channelId: string | null;
  conversationId: string | null;
  startedAt: string;
  endedAt: string;
  /** Number of captured transcript lines. */
  lineCount: number;
  /** True once AI minutes have been generated. */
  hasMinutes: boolean;
  /** First line of the AI summary, if generated. */
  summaryPreview: string | null;
  actionItemCount: number;
}

/** Full meeting record with transcript + minutes. */
export interface MeetingRecordDto extends MeetingRecordSummaryDto {
  transcript: MeetingTranscriptLine[];
  notes: string | null;
  summary: string | null;
  decisions: string[];
  actionItems: string[];
}
