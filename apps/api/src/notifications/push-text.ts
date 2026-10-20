import { isMeetingNotice, meetingNoticeText, type MeetingNoticePayload } from '@backstages/shared';

type Payload = Record<string, unknown> | null | undefined;

/** Title/body for the Web Push copy of a notification (the app shows richer UI). */
export function pushText(
  type: string,
  payload: Payload,
  actorName: string | null,
  channelName: string | null,
): { title: string; body?: string } {
  const pl = (payload ?? {}) as Record<string, string | undefined>;
  const who = actorName ?? 'Someone';
  const where = channelName ? ` in #${channelName}` : '';

  if (isMeetingNotice(payload)) {
    const meeting = payload as MeetingNoticePayload;
    const title = meetingNoticeText(meeting, actorName);
    const body =
      meeting.kind === 'starting' || meeting.kind === 'reminder' || meeting.kind === undefined
        ? 'Open Backstages to join'
        : meeting.kind === 'invite'
          ? 'Open the calendar in Backstages to RSVP'
          : undefined;
    return { title, body };
  }
  if (pl.source === 'reminder') return { title: '⏰ Reminder', body: pl.text };
  if (pl.source === 'join_request') {
    if (pl.action === 'approved') return { title: `🎉 You're in: ${pl.workspaceName ?? 'workspace'}`, body: 'Your join request was approved' };
    if (pl.action === 'denied') return { title: 'Join request declined', body: pl.workspaceName };
    return { title: `🙋 ${who} asked to join`, body: 'Open Workspace settings → Members to approve' };
  }
  if (pl.source === 'feedback') return { title: `💬 Feedback from ${who}`, body: pl.text };
  if (pl.source === 'task') return { title: `Task: ${pl.title ?? ''}`.trim(), body: pl.action ? `${who} · ${pl.action}` : undefined };

  switch (type) {
    case 'MENTION':
      return { title: `${who} mentioned you${where}` };
    case 'DM':
      return { title: `New message from ${who}` };
    case 'THREAD_REPLY':
      return { title: `${who} replied in a thread${where}` };
    case 'REACTION':
      return { title: `${who} reacted to your message` };
    default:
      return { title: 'New activity in Backstages' };
  }
}
