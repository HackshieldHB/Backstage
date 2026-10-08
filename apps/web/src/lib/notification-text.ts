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
  if (pl.source === 'workflow_request') {
    const what = pl.action === 'form' ? 'needs you to fill in a form' : 'needs your approval';
    return `${pl.title ?? 'A workflow'} ${what}`;
  }
  // A workflow DM addressed to its own creator arrives as a notification.
  if (pl.source === 'workflow') return `${pl.title ?? 'Workflow'}: ${pl.text ?? ''}`.trim();
  if (pl.source !== 'task') return null;
  const title = `“${pl.title ?? 'a task'}”`;
  const who = actorName ?? 'Someone';
  if (pl.action === 'assigned') return `${who} assigned you ${title}`;
  if (pl.action === 'completed') return `${who} completed ${title}`;
  if (pl.action === 'due') return `Task due: ${title}`;
  return `Task updated: ${title}`;
}
