/** Payload fields carried by task / reminder SYSTEM notifications. */
export interface TaskReminderPayload {
  source?: string;
  action?: string;
  title?: string;
  text?: string;
}

/**
 * One-line text for a task or reminder notification, shared by the Activity
 * panel and desktop pop-ups. Returns null for any other notification.
 */
export function taskOrReminderText(
  pl: TaskReminderPayload,
  actorName?: string | null,
): string | null {
  if (pl.source === 'reminder') return `⏰ Reminder: ${pl.text ?? ''}`.trim();
  if (pl.source !== 'task') return null;
  const title = `“${pl.title ?? 'a task'}”`;
  const who = actorName ?? 'Someone';
  if (pl.action === 'assigned') return `${who} assigned you ${title}`;
  if (pl.action === 'completed') return `${who} completed ${title}`;
  if (pl.action === 'due') return `Task due: ${title}`;
  return `Task updated: ${title}`;
}
