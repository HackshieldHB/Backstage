import { Injectable, Logger } from '@nestjs/common';
import type { CalendarLinkDto } from '@backstages/shared';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';

const MEETING_EMOJI = '🗓️';

interface IcsEvent {
  start: number;
  end: number;
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

export function parseIcs(text: string): IcsEvent[] {
  const events: IcsEvent[] = [];
  let cur: Partial<IcsEvent> | null = null;
  for (const line of unfold(text)) {
    if (line === 'BEGIN:VEVENT') cur = {};
    else if (line === 'END:VEVENT') {
      if (cur && cur.start != null && cur.end != null) events.push({ start: cur.start, end: cur.end });
      cur = null;
    } else if (cur) {
      const idx = line.indexOf(':');
      if (idx < 0) continue;
      const name = line.slice(0, idx).split(';')[0];
      const val = line.slice(idx + 1);
      if (name === 'DTSTART') cur.start = parseIcsDate(val) ?? undefined;
      else if (name === 'DTEND') cur.end = parseIcsDate(val) ?? undefined;
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

  async set(userId: string, icsUrl: string): Promise<CalendarLinkDto> {
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
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(url, { signal: controller.signal, redirect: 'follow' });
      if (!res.ok) throw new Error(`ICS fetch ${res.status}`);
      const text = await res.text();
      return text.slice(0, 2_000_000); // cap ~2MB
    } finally {
      clearTimeout(timer);
    }
  }
}
