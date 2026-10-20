import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Prisma } from '@prisma/client';
import { meetingNoticeText, type EmailPreferencesDto, type MeetingNoticePayload } from '@backstages/shared';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { RealtimeService } from '../realtime/realtime.service';
import { RedisClient } from '../redis/redis.module';

/** Only email about things unread for at least this long (they may still see it). */
const QUIET_MS = 15 * 60_000;
/** At most one missed-activity email per person per this window. */
const MIN_GAP_MS = 60 * 60_000;
/** Never dig further back than this. */
const LOOKBACK_MS = 24 * 60 * 60_000;
const MAX_ITEMS = 5;

const unsubSecret = () => `${process.env.JWT_ACCESS_SECRET ?? ''}:email-unsub`;
const webBase = () => (process.env.WEB_ORIGIN ?? process.env.PUBLIC_WEB_URL ?? 'http://localhost:3000').replace(/\/+$/, '');

/** Notification kinds worth an email: things aimed at *you*. */
const DIRECT_TYPES = ['MENTION', 'DM', 'THREAD_REPLY'] as const;
const SYSTEM_SOURCES = new Set(['scheduled-huddle', 'task', 'workflow_request']);

export interface MissedItem {
  type: string;
  actorName: string | null;
  channelName: string | null;
  preview: string | null;
  payload: Record<string, unknown> | null;
}

export interface UpcomingMeeting {
  title: string;
  scheduledFor: Date;
  timeZone: string | null;
}

/** Is this notification worth an email? */
export function emailWorthy(type: string, payload: unknown): boolean {
  if ((DIRECT_TYPES as readonly string[]).includes(type)) return true;
  if (type !== 'SYSTEM') return false;
  const pl = (payload ?? {}) as { source?: string; kind?: string; action?: string };
  if (!pl.source || !SYSTEM_SOURCES.has(pl.source)) return false;
  // Meeting reminders already reach people in time; the invite/changes are what you'd miss.
  if (pl.source === 'scheduled-huddle') return pl.kind === 'invite' || pl.kind === 'updated' || pl.kind === 'cancelled';
  if (pl.source === 'task') return pl.action === 'assigned';
  return true;
}

function clip(text: string | null | undefined, max = 140): string | null {
  if (!text) return null;
  const one = text.replace(/\s+/g, ' ').trim();
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
}

function lineFor(item: MissedItem): string {
  const who = item.actorName ?? 'Someone';
  const where = item.channelName ? ` in #${item.channelName}` : '';
  const quote = item.preview ? ` — “${item.preview}”` : '';
  switch (item.type) {
    case 'MENTION':
      return `${who} mentioned you${where}${quote}`;
    case 'DM':
      return `New message from ${who}${quote}`;
    case 'THREAD_REPLY':
      return `${who} replied in a thread${where}${quote}`;
    default: {
      const pl = (item.payload ?? {}) as Record<string, string | undefined>;
      if (pl.source === 'scheduled-huddle') return meetingNoticeText(pl as MeetingNoticePayload, item.actorName);
      if (pl.source === 'task') return `${who} assigned you a task: “${pl.title ?? ''}”`;
      if (pl.source === 'workflow_request') return `${pl.title ?? 'A workflow'} needs your input`;
      return 'New activity';
    }
  }
}

function formatWhen(d: Date, timeZone: string | null): string {
  const tz = (() => {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: timeZone ?? 'UTC' });
      return timeZone ?? 'UTC';
    } catch {
      return 'UTC';
    }
  })();
  const text = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(d);
  return `${text} (${tz})`;
}

/** The email for one person — pure, so it's easy to test and review. */
export function composeMissedEmail(input: {
  displayName: string;
  items: MissedItem[];
  total: number;
  upcoming: UpcomingMeeting[];
  unsubscribeUrl: string;
}): { subject: string; body: string } {
  const { items, total } = input;
  const subject =
    total === 1
      ? lineFor(items[0]).replace(/ — “.*$/, '')
      : `You have ${total} unread updates in Backstages`;
  const lines = [`Hi ${input.displayName},`, '', 'While you were away:'];
  for (const item of items) lines.push(`• ${lineFor(item)}`);
  if (total > items.length) lines.push(`• …and ${total - items.length} more`);
  if (input.upcoming.length) {
    lines.push('', 'Coming up in the next 24 hours:');
    for (const m of input.upcoming) lines.push(`• ${m.title} — ${formatWhen(m.scheduledFor, m.timeZone)}`);
  }
  lines.push(
    '',
    `Open Backstages: ${webBase()}/app`,
    '',
    '—',
    `You get these when you have unread mentions or messages while away. Turn them off: ${input.unsubscribeUrl}`,
  );
  return { subject, body: lines.join('\n') };
}

/**
 * Emails people about direct activity they missed — mentions, DMs, thread
 * replies, meeting invites, assigned tasks — when it has been unread for a
 * while and they're not online. One email per hour at most, only to verified
 * addresses (message previews must never go to an address nobody proved), and
 * never while out of office. On by default; one click to turn off.
 */
@Injectable()
export class MissedActivityService {
  private readonly logger = new Logger(MissedActivityService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly realtime: RealtimeService,
    private readonly redis: RedisClient,
    private readonly jwt: JwtService,
  ) {}

  // ---------- preferences ----------

  async get(userId: string): Promise<EmailPreferencesDto> {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { missedActivityEmails: true } });
    return { missedActivity: u.missedActivityEmails };
  }

  async set(userId: string, missedActivity: boolean): Promise<EmailPreferencesDto> {
    await this.prisma.user.update({ where: { id: userId }, data: { missedActivityEmails: missedActivity } });
    return { missedActivity };
  }

  unsubscribeToken(userId: string): string {
    return this.jwt.sign({ sub: userId, typ: 'email-unsub' }, { secret: unsubSecret(), expiresIn: '365d' });
  }

  /** One-click unsubscribe from an email link. */
  async unsubscribe(token: string): Promise<{ ok: true }> {
    let userId: string;
    try {
      const payload = this.jwt.verify<{ sub: string; typ?: string }>(token, { secret: unsubSecret() });
      if (payload.typ !== 'email-unsub') throw new Error('wrong token type');
      userId = payload.sub;
    } catch {
      throw new UnauthorizedException('This unsubscribe link is not valid');
    }
    await this.prisma.user.updateMany({ where: { id: userId }, data: { missedActivityEmails: false } });
    return { ok: true };
  }

  // ---------- delivery ----------

  /** Scheduler entrypoint. Returns the number of emails sent. */
  async runDue(now = new Date()): Promise<number> {
    const since = new Date(now.getTime() - LOOKBACK_MS);
    const settled = new Date(now.getTime() - QUIET_MS);
    const candidates = await this.prisma.notification.findMany({
      where: {
        readAt: null,
        createdAt: { gte: since, lte: settled },
        OR: [{ type: { in: [...DIRECT_TYPES] } }, { type: 'SYSTEM' }],
        user: { missedActivityEmails: true, emailVerifiedAt: { not: null }, isBot: false },
      },
      select: { userId: true },
      distinct: ['userId'],
      take: 500,
    });

    let sent = 0;
    for (const { userId } of candidates) {
      try {
        if (await this.sendFor(userId, now)) sent++;
      } catch (err) {
        this.logger.warn(`Missed-activity email for ${userId} failed: ${String(err)}`);
      }
    }
    return sent;
  }

  /** Decide and send for one person. Returns true when an email went out. */
  async sendFor(userId: string, now = new Date()): Promise<boolean> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.missedActivityEmails || !user.emailVerifiedAt || user.isBot) return false;
    if (user.lastMissedEmailAt && now.getTime() - user.lastMissedEmailAt.getTime() < MIN_GAP_MS) return false;
    // Online (any tab, any instance) → they'll see it in the app.
    if ((await this.redis.exists(`presence:online:${userId}`)) || (await this.realtime.isUserConnected(userId))) return false;
    const ooo = await this.prisma.workspaceMember.count({ where: { userId, oooUntil: { gt: now } } });
    if (ooo) return false;

    const from = new Date(Math.max(now.getTime() - LOOKBACK_MS, user.lastMissedEmailAt?.getTime() ?? 0));
    const rows = await this.prisma.notification.findMany({
      where: { userId, readAt: null, createdAt: { gt: from, lte: new Date(now.getTime() - QUIET_MS) } },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        actor: { select: { displayName: true } },
        channel: { select: { name: true } },
        message: { select: { contentText: true, deletedAt: true } },
      },
    });
    const worthy = rows.filter((n) => emailWorthy(n.type, n.payload));
    if (!worthy.length) return false;

    // Claim the send (CAS on lastMissedEmailAt) so two workers can't both email.
    const { count } = await this.prisma.user.updateMany({
      where: { id: userId, lastMissedEmailAt: user.lastMissedEmailAt },
      data: { lastMissedEmailAt: now },
    });
    if (!count) return false;

    // Quote a message only if they can still read where it was posted (they may
    // have left the channel/DM since).
    const shown = worthy.slice(0, MAX_ITEMS);
    const channelIds = [...new Set(shown.map((n) => n.channelId).filter((x): x is string => !!x))];
    const conversationIds = [...new Set(shown.map((n) => n.conversationId).filter((x): x is string => !!x))];
    const [inChannels, inConversations] = await Promise.all([
      channelIds.length
        ? this.prisma.channelMember.findMany({ where: { userId, channelId: { in: channelIds } }, select: { channelId: true } })
        : Promise.resolve([]),
      conversationIds.length
        ? this.prisma.conversationMember.findMany({
            where: { userId, conversationId: { in: conversationIds } },
            select: { conversationId: true },
          })
        : Promise.resolve([]),
    ]);
    const readable = new Set([...inChannels.map((c) => c.channelId), ...inConversations.map((c) => c.conversationId)]);
    const items: MissedItem[] = shown.map((n) => {
      const where = n.channelId ?? n.conversationId;
      const canRead = !where || readable.has(where);
      return {
        type: n.type,
        actorName: n.actor?.displayName ?? null,
        channelName: canRead ? (n.channel?.name ?? null) : null,
        preview: canRead && n.message && !n.message.deletedAt ? clip(n.message.contentText) : null,
        payload: (n.payload as Record<string, unknown> | null) ?? null,
      };
    });
    const upcoming = await this.upcomingMeetings(userId, now);
    const { subject, body } = composeMissedEmail({
      displayName: user.displayName,
      items,
      total: worthy.length,
      upcoming,
      unsubscribeUrl: `${webBase()}/unsubscribe#token=${encodeURIComponent(this.unsubscribeToken(userId))}`,
    });
    try {
      await this.email.send({ to: user.email, subject, body });
    } catch (err) {
      // Give the slot back so the next run retries.
      await this.prisma.user
        .updateMany({ where: { id: userId, lastMissedEmailAt: now }, data: { lastMissedEmailAt: user.lastMissedEmailAt } })
        .catch(() => undefined);
      throw err;
    }
    return true;
  }

  /** Meetings in the next 24h the person is a guest of and hasn't declined. */
  private async upcomingMeetings(userId: string, now: Date): Promise<UpcomingMeeting[]> {
    const where: Prisma.ScheduledHuddleWhereInput = {
      scheduledFor: { gt: now, lte: new Date(now.getTime() + 24 * 60 * 60_000) },
      OR: [{ channel: { members: { some: { userId } } } }, { conversation: { members: { some: { userId } } } }],
      responses: { none: { userId, response: 'DECLINED' } },
    };
    const rows = await this.prisma.scheduledHuddle.findMany({
      where,
      orderBy: { scheduledFor: 'asc' },
      take: 5,
      select: { title: true, scheduledFor: true, timeZone: true },
    });
    return rows;
  }
}
