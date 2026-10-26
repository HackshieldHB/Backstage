import { Global, Injectable, Logger, Module, type OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UsersModule } from '../users/users.module';
import { UsersService } from '../users/users.service';

/**
 * Automatic statuses. Backstages fills in what you're doing so teammates know
 * before they ping you:
 *   🎧 "In a huddle"  — while you're in any huddle;
 *   🗓️ "In a meeting" — during a meeting on your calendar (Backstages meetings
 *                        you organise or accepted, and a linked Google/ICS calendar).
 * Rules: an automatic status only ever replaces *no* status or another
 * automatic one (a huddle outranks a meeting), and only its own status is ever
 * cleared — a status someone set by hand is never touched.
 */
export const HUDDLE_STATUS = { emoji: '🎧', text: 'In a huddle' } as const;
export const MEETING_STATUS = { emoji: '🗓️', text: 'In a meeting' } as const;

/** A huddle status outlives a crash by at most this long. */
const HUDDLE_MAX_MS = 8 * 3600_000;
/** A meeting with no known end keeps its status for this long (refreshed while it runs). */
const MEETING_DEFAULT_MS = 60 * 60_000;

type Kind = 'huddle' | 'meeting';

/** Pure decision: what an automatic status change should do to the current status. */
export function decideAutoStatus(
  current: { emoji: string | null; expiresAt: Date | null },
  kind: Kind,
  on: boolean,
  now = Date.now(),
): 'set' | 'clear' | 'keep' {
  const live = !!current.emoji && (!current.expiresAt || current.expiresAt.getTime() > now);
  const mine = kind === 'huddle' ? HUDDLE_STATUS.emoji : MEETING_STATUS.emoji;
  if (!on) return live && current.emoji === mine ? 'clear' : 'keep';
  if (!live) return 'set';
  if (current.emoji === mine) return 'set'; // refresh the expiry
  // A huddle may take over from a calendar meeting status, never the other way round.
  if (kind === 'huddle' && current.emoji === MEETING_STATUS.emoji) return 'set';
  return 'keep';
}

@Injectable()
export class AutoStatusService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AutoStatusService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
  ) {}

  /** Huddles live in this process: after a restart nobody is in one yet, so a
   *  leftover 🎧 is stale (people who reconnect to a huddle get it back). */
  async onApplicationBootstrap(): Promise<void> {
    if (process.env.NODE_ENV === 'test') return;
    try {
      const stale = await this.prisma.user.findMany({
        where: { statusEmoji: HUDDLE_STATUS.emoji },
        select: { id: true },
        take: 5000,
      });
      for (const u of stale)
        await this.users.updateStatus(u.id, {
          statusEmoji: null,
          statusText: null,
          statusExpiresAt: null,
        });
      if (stale.length)
        this.logger.log(`Cleared ${stale.length} stale huddle status(es) after start-up`);
    } catch (err) {
      this.logger.warn(`start-up huddle status cleanup failed: ${String(err)}`);
    }
  }

  /**
   * Clear every status whose "clear after" time has passed — automatic or set
   * by hand — so teammates never see an outdated one. Run every minute.
   */
  async clearExpired(now = new Date()): Promise<number> {
    const expired = await this.prisma.user.findMany({
      where: {
        statusExpiresAt: { lte: now },
        OR: [{ statusEmoji: { not: null } }, { statusText: { not: null } }],
      },
      select: { id: true },
      take: 500,
    });
    for (const u of expired) {
      try {
        await this.users.updateStatus(u.id, {
          statusEmoji: null,
          statusText: null,
          statusExpiresAt: null,
        });
      } catch (err) {
        this.logger.warn(`clearing expired status for ${u.id} failed: ${String(err)}`);
      }
    }
    return expired.length;
  }

  /** Joined (true) or fully left (false) every huddle. */
  async huddle(userId: string, inHuddle: boolean): Promise<void> {
    await this.apply(userId, 'huddle', inHuddle, new Date(Date.now() + HUDDLE_MAX_MS));
  }

  /** In a calendar meeting right now (true, optionally until when) or not (false). */
  async meeting(userId: string, inMeeting: boolean, until?: Date | null): Promise<void> {
    const end =
      until && until.getTime() > Date.now() ? until : new Date(Date.now() + MEETING_DEFAULT_MS);
    await this.apply(userId, 'meeting', inMeeting, end);
  }

  private async apply(userId: string, kind: Kind, on: boolean, expiresAt: Date): Promise<void> {
    try {
      const me = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { statusEmoji: true, statusExpiresAt: true },
      });
      if (!me) return;
      const action = decideAutoStatus(
        { emoji: me.statusEmoji, expiresAt: me.statusExpiresAt },
        kind,
        on,
      );
      if (action === 'set') {
        const s = kind === 'huddle' ? HUDDLE_STATUS : MEETING_STATUS;
        // Skip a no-op write (and its broadcast) when only the expiry would move a little.
        if (
          me.statusEmoji === s.emoji &&
          me.statusExpiresAt &&
          Math.abs(me.statusExpiresAt.getTime() - expiresAt.getTime()) < 60_000
        ) {
          return;
        }
        await this.users.updateStatus(userId, {
          statusEmoji: s.emoji,
          statusText: s.text,
          statusExpiresAt: expiresAt.toISOString(),
        });
      } else if (action === 'clear') {
        await this.users.updateStatus(userId, {
          statusEmoji: null,
          statusText: null,
          statusExpiresAt: null,
        });
      }
    } catch (err) {
      // A status hint must never break joining a huddle or a sync run.
      this.logger.warn(`auto status (${kind}) for ${userId} failed: ${String(err)}`);
    }
  }
}

@Global()
@Module({
  imports: [UsersModule],
  providers: [AutoStatusService],
  exports: [AutoStatusService],
})
export class AutoStatusModule {}
