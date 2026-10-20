import { Injectable, Logger } from '@nestjs/common';

/** Something about meetings in a channel/DM changed (or one person's answer did). */
export interface MeetingChange {
  channelId: string | null;
  conversationId: string | null;
  /** Only these people are affected (e.g. an RSVP); otherwise everyone in the container. */
  userIds?: string[];
}

/**
 * A tiny in-process bus so other features (Google Calendar sync) can react to
 * meeting changes without ScheduledHuddlesService depending on them — the same
 * seam AppRegistry gives integrations. Listeners run in the background and can
 * never break the meeting operation itself.
 */
@Injectable()
export class MeetingHooks {
  private readonly logger = new Logger(MeetingHooks.name);
  private readonly listeners: ((change: MeetingChange) => Promise<void> | void)[] = [];

  on(listener: (change: MeetingChange) => Promise<void> | void): void {
    this.listeners.push(listener);
  }

  emit(change: MeetingChange): void {
    for (const listener of this.listeners) {
      void Promise.resolve()
        .then(() => listener(change))
        .catch((err) => this.logger.warn(`Meeting listener failed: ${String(err)}`));
    }
  }
}
