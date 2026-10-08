import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { CalendarLinkDto } from '@backstages/shared';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { safeGetText, validatePublicUrl } from '../common/safe-http';

const MEETING_EMOJI = '🗓️';

const ICS_SCHEMES = ['https:', 'http:'];

/** Calendar apps hand out webcal:// links; they're plain HTTP(S) underneath. */
export function normalizeIcsUrl(url: string): string {
  return url.replace(/^webcals?:\/\//i, 'https://');
}

export interface IcsEvent {
  start: number;
  end: number;
  /** SUMMARY, unescaped (empty when the event has none). */
  title: string;
}

/** Unfold RFC-5545 folded lines (continuations start with space/tab). */
function unfold(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    if ((raw.startsWith(' ') || raw.startsWith('\t')) && out.length) out[out.length - 1] += raw.slice(1);
    else out.push(raw);
  }
  return out;
}

/** Parse an ICS datetime. Handles UTC (…Z) and floating (treated as UTC); skips
 *  date-only all-day values. Returns epoch ms or null. */
function parseIcsDate(value: string): number | null {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/.exec(value.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  return Date.UTC(+y, +mo - 1, +d, +h, +mi, +s);
}

/** Undo RFC-5545 TEXT escaping: backslash-n becomes a space; escaped , ; and backslash are kept literally. */
export function unescapeIcs(value: string): string {
  return value.replace(/\\([nN,;\\])/g, (_m, c: string) => (c === 'n' || c === 'N' ? ' ' : c)).trim();
}

export function parseIcs(text: string): IcsEvent[] {
  const events: IcsEvent[] = [];
  let cur: Partial<IcsEvent> | null = null;
  for (const line of unfold(text)) {
    if (line === 'BEGIN:VEVENT') cur = {};
    else if (line === 'END:VEVENT') {
      if (cur && cur.start != null && cur.end != null) {
        events.push({ start: cur.start, end: cur.end, title: cur.title ?? '' });
      }
      cur = null;
    } else if (cur) {
      const idx = line.indexOf(':');
      if (idx < 0) continue;
      const name = line.slice(0, idx).split(';')[0];
      const val = line.slice(idx + 1);
      if (name === 'DTSTART') cur.start = parseIcsDate(val) ?? undefined;
      else if (name === 'DTEND') cur.end = parseIcsDate(val) ?? undefined;
      else if (name === 'SUMMARY') cur.title = unescapeIcs(val);
    }
  }
  return events;
}

@Injectable()
export class CalendarService {
  private readonly logger = new Logger(CalendarService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
  ) {}

  async get(userId: string): Promise<CalendarLinkDto> {
    const link = await this.prisma.calendarLink.findUnique({ where: { userId } });
    if (!link) return { linked: false, icsUrl: null, lastSyncAt: null, inMeeting: false };
    const me = await this.prisma.user.findUnique({ where: { id: userId }, select: { statusEmoji: true } });
    return {
      linked: true,
      icsUrl: link.icsUrl,
      lastSyncAt: link.lastSyncAt?.toISOString() ?? null,
      inMeeting: me?.statusEmoji === MEETING_EMOJI,
    };
  }

  async set(userId: string, rawUrl: string): Promise<CalendarLinkDto> {
    const icsUrl = normalizeIcsUrl(rawUrl.trim());
    const problem = validatePublicUrl(icsUrl, ICS_SCHEMES);
    if (problem) throw new BadRequestException(problem);
    await this.prisma.calendarLink.upsert({
      where: { userId },
      create: { userId, icsUrl },
      update: { icsUrl, lastSyncAt: null },
    });
    await this.syncUser(userId, icsUrl).catch((e) => this.logger.warn(`initial sync failed: ${String(e)}`));
    return this.get(userId);
  }

  async unlink(userId: string): Promise<{ ok: boolean }> {
    await this.prisma.calendarLink.deleteMany({ where: { userId } });
    // Clear any lingering "in a meeting" status we set.
    const me = await this.prisma.user.findUnique({ where: { id: userId }, select: { statusEmoji: true } });
    if (me?.statusEmoji === MEETING_EMOJI) {
      await this.users.updateStatus(userId, { statusEmoji: null, statusText: null, statusExpiresAt: null });
    }
    return { ok: true };
  }

  /** Scheduler entrypoint: sync every linked calendar. */
  async runDue(): Promise<number> {
    const links = await this.prisma.calendarLink.findMany({ select: { userId: true, icsUrl: true } });
    let synced = 0;
    for (const l of links) {
      try {
        await this.syncUser(l.userId, l.icsUrl);
        synced++;
      } catch (e) {
        this.logger.warn(`calendar sync for ${l.userId} failed: ${String(e)}`);
      }
    }
    return synced;
  }

  /**
   * The user's calendar events overlapping [from, to), for planning views.
   * `state` is 'none' when no calendar is linked and 'error' when the feed
   * couldn't be fetched (the caller shows a hint instead of failing).
   */
  async eventsBetween(
    userId: string,
    from: Date,
    to: Date,
  ): Promise<{ state: 'ok' | 'none' | 'error'; events: IcsEvent[] }> {
    const link = await this.prisma.calendarLink.findUnique({ where: { userId } });
    if (!link) return { state: 'none', events: [] };
    try {
      const events = parseIcs(await this.fetchIcs(link.icsUrl))
        .filter((e) => e.start < to.getTime() && e.end > from.getTime())
        .sort((a, b) => a.start - b.start)
        .slice(0, 50);
      return { state: 'ok', events };
    } catch (err) {
      this.logger.warn(`Calendar fetch for ${userId} failed: ${err instanceof Error ? err.message : err}`);
      return { state: 'error', events: [] };
    }
  }

  /**
   * Fetch the ICS, decide if the user is currently in an event, and reflect it in
   * their status. Only ever touches the calendar-owned status (marked with a
   * 🗓️ emoji) so a manual status or focus block is never clobbered.
   */
  async syncUser(userId: string, icsUrl: string): Promise<void> {
    const text = await this.fetchIcs(icsUrl);
    const now = Date.now();
    const inMeeting = parseIcs(text).some((e) => e.start <= now && e.end > now);
    const me = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { statusEmoji: true, dndUntil: true },
    });
    const hasCalendarStatus = me?.statusEmoji === MEETING_EMOJI;

    if (inMeeting && !hasCalendarStatus && !me?.statusEmoji) {
      // Only set if the user has no other status (respect manual/focus statuses).
      const endsSoon = new Date(now + 60 * 60_000).toISOString();
      await this.users.updateStatus(userId, {
        statusEmoji: MEETING_EMOJI,
        statusText: 'In a meeting',
        statusExpiresAt: endsSoon,
      });
    } else if (!inMeeting && hasCalendarStatus) {
      await this.users.updateStatus(userId, { statusEmoji: null, statusText: null, statusExpiresAt: null });
    }
    await this.prisma.calendarLink.update({ where: { userId }, data: { lastSyncAt: new Date() } }).catch(() => undefined);
  }

  /** Fetch the ICS with a timeout + size cap. */
  private async fetchIcs(url: string): Promise<string> {
    // The URL is user-supplied: fetch it through the SSRF guard (public
    // addresses only, every redirect hop re-checked, 8s timeout, ~2MB cap).
    return safeGetText(normalizeIcsUrl(url), {
      schemes: ICS_SCHEMES,
      timeoutMs: 8000,
      maxBytes: 2_000_000,
      maxRedirects: 3,
    });
  }
}
