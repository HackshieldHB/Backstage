import { Injectable, Logger } from '@nestjs/common';
import type { HuddleSettings } from '@backstages/shared';

/**
 * What the media layer (the LiveKit SFU) needs to hear about huddle membership
 * so it can enforce it server-side: in mesh mode peers simply hang up on
 * non-members, but SFU media flows through the server, so leaving, removal and
 * breakout moves must be applied there too.
 */
export interface HuddleMediaListener {
  /** A user left/dropped out of the huddle, or (`removed`) a moderator removed them. */
  memberLeft?(key: string, userId: string, removed: boolean): Promise<void> | void;
  /** Breakout assignments changed (opened, moved, closed). */
  breakoutsChanged?(key: string): Promise<void> | void;
  /** Recording started/stopped (`settings` is the state after the change). */
  recordingChanged?(key: string, settings: HuddleSettings): Promise<void> | void;
  /** The last participant left. */
  huddleEnded?(key: string): Promise<void> | void;
}

/** Fire-and-forget fan-out: a slow or failing media server never blocks the gateway. */
@Injectable()
export class HuddleMediaHooks {
  private readonly logger = new Logger(HuddleMediaHooks.name);
  private readonly listeners: HuddleMediaListener[] = [];

  register(listener: HuddleMediaListener) {
    this.listeners.push(listener);
  }

  memberLeft(key: string, userId: string, removed = false) {
    this.each('memberLeft', (l) => l.memberLeft?.(key, userId, removed));
  }
  breakoutsChanged(key: string) {
    this.each('breakoutsChanged', (l) => l.breakoutsChanged?.(key));
  }
  recordingChanged(key: string, settings: HuddleSettings) {
    this.each('recordingChanged', (l) => l.recordingChanged?.(key, settings));
  }
  huddleEnded(key: string) {
    this.each('huddleEnded', (l) => l.huddleEnded?.(key));
  }

  private each(what: string, fn: (l: HuddleMediaListener) => Promise<void> | void) {
    for (const l of this.listeners) {
      try {
        void Promise.resolve(fn(l)).catch((err) => this.logger.warn(`${what} hook failed: ${String(err)}`));
      } catch (err) {
        this.logger.warn(`${what} hook failed: ${String(err)}`);
      }
    }
  }
}
