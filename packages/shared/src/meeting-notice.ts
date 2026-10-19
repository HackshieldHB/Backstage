/**
 * One-line text for a scheduled-meeting notification (`payload.source ===
 * 'scheduled-huddle'`). Shared so the Activity feed, in-app toasts, desktop
 * pop-ups and server-sent Web Push all say the same thing.
 */
export interface MeetingNoticePayload {
  source?: string;
  /** Absent on notifications created before meeting reminders existed. */
  kind?: 'invite' | 'reminder' | 'starting' | 'updated' | 'cancelled' | 'response';
  title?: string;
  startedBy?: string;
  minutes?: number;
  timeChanged?: boolean;
  scope?: 'series' | 'occurrence';
  response?: 'ACCEPTED' | 'TENTATIVE' | 'DECLINED';
}

/** Plain boolean (not a type guard): callers' payload types overlap with
 *  MeetingNoticePayload, and narrowing would make their other branches `never`. */
export function isMeetingNotice(pl: { source?: unknown } | null | undefined): boolean {
  return pl?.source === 'scheduled-huddle';
}

export function meetingNoticeText(pl: MeetingNoticePayload, actorName?: string | null): string {
  const title = `“${pl.title ?? 'Meeting'}”`;
  const organizer = pl.startedBy ?? actorName ?? 'Someone';
  switch (pl.kind) {
    case 'invite':
      return `📅 ${organizer} invited you to ${title}`;
    case 'reminder':
      return `⏰ ${title} starts in ${pl.minutes ?? 'a few'} min`;
    case 'updated':
      return pl.timeChanged ? `🔁 ${title} was rescheduled` : `✏️ ${title} was updated`;
    case 'cancelled':
      return pl.scope === 'occurrence' ? `🚫 The next ${title} was cancelled` : `🚫 ${title} was cancelled`;
    case 'response': {
      const who = actorName ?? 'Someone';
      const verb = pl.response === 'ACCEPTED' ? 'accepted' : pl.response === 'DECLINED' ? 'declined' : 'might join';
      return `${who} ${verb} ${title}`;
    }
    case 'starting':
    default:
      return `🎧 ${title} is starting now`;
  }
}
