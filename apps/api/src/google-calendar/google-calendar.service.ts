import { BadRequestException, Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import type { GoogleCalendarLink, Prisma } from '@prisma/client';
import type { GoogleCalendarStatusDto } from '@backstages/shared';
import { PrismaService } from '../prisma/prisma.service';
import { RedisClient } from '../redis/redis.module';
import { decryptToken, encryptToken } from '../atlassian/crypto';
import { SocialLoginService } from '../auth/social-login.service';
import { GoogleGrantError, googleRefresh, providerCredentials } from '../auth/oauth-providers';
import { MeetingHooks, type MeetingChange } from '../scheduled-huddles/meeting-hooks';
import {
  deleteEvent,
  eventBodyFor,
  GoogleApiError,
  hashEvent,
  insertEvent,
  listEvents,
  listOurEventIds,
  patchEvent,
  type CalendarEvent,
} from './google-calendar-api';

/** How far ahead meetings are copied into Google Calendar. */
const HORIZON_MS = 60 * 24 * 60 * 60_000;
const RECONCILE_EVERY_MS = 15 * 60_000;
const webBase = () => (process.env.WEB_ORIGIN ?? 'http://localhost:3000').replace(/\/+$/, '');

/**
 * Two-way Google Calendar sync.
 *
 *  - Backstages → Google: every meeting a person is invited to (and hasn't
 *    declined) gets a copy in their own Google Calendar. One routine,
 *    reconcileUser(), makes the calendar match: it runs on every meeting change
 *    and every 15 minutes, so a missed update heals itself. Copies are keyed in
 *    GoogleCalendarEvent and only rewritten when their content changed.
 *  - Google → Backstages: eventsBetween() reads the person's calendar
 *    (recurring events expanded), skipping our own copies, for their calendar
 *    view, teammates' free/busy and "in a meeting" status.
 *
 * Revoked access marks the link broken (no retry storm); the person reconnects.
 */
@Injectable()
export class GoogleCalendarService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(GoogleCalendarService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisClient,
    private readonly social: SocialLoginService,
    private readonly hooks: MeetingHooks,
  ) {}

  onModuleInit() {
    this.hooks.on((change) => this.onMeetingChange(change));
    if (process.env.DISABLE_SYNC_QUEUE === '1') return; // tests drive reconcile directly
    this.timer = setInterval(() => void this.reconcileAll(), RECONCILE_EVERY_MS);
    this.timer.unref();
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }

  // ---------- connection ----------

  async status(userId: string): Promise<GoogleCalendarStatusDto> {
    const link = await this.prisma.googleCalendarLink.findUnique({ where: { userId } });
    return {
      available: !!providerCredentials('google'),
      connected: !!link,
      email: link?.email ?? null,
      pushMeetings: link?.pushMeetings ?? true,
      broken: !!link?.brokenAt,
      lastSyncedAt: link?.lastSyncedAt?.toISOString() ?? null,
    };
  }

  async startConnect(userId: string): Promise<{ url: string }> {
    if (!providerCredentials('google')) throw new BadRequestException('Google is not set up on this server');
    return this.social.startGoogleCalendarConnect(userId);
  }

  async confirmConnect(userId: string, code: string): Promise<GoogleCalendarStatusDto> {
    const c = await this.social.takeGoogleCalendarConnect(userId, code);
    const data = {
      googleSub: c.googleSub,
      email: c.email,
      refreshTokenEnc: c.refreshTokenEnc,
      accessTokenEnc: c.accessTokenEnc,
      accessTokenExpiresAt: new Date(c.accessTokenExpiresAt),
      scopes: c.scopes,
      brokenAt: null,
    };
    const existing = await this.prisma.googleCalendarLink.findUnique({ where: { userId } });
    if (existing && existing.googleSub !== c.googleSub) {
      // A different Google account: its calendar doesn't have our copies.
      await this.prisma.googleCalendarEvent.deleteMany({ where: { userId } });
    }
    await this.prisma.googleCalendarLink.upsert({ where: { userId }, create: { userId, ...data }, update: data });
    void this.reconcileUser(userId).catch((err) => this.logger.warn(`Initial Google sync for ${userId}: ${String(err)}`));
    return this.status(userId);
  }

  async setPush(userId: string, pushMeetings: boolean): Promise<GoogleCalendarStatusDto> {
    const { count } = await this.prisma.googleCalendarLink.updateMany({ where: { userId }, data: { pushMeetings } });
    if (!count) throw new BadRequestException('Connect Google Calendar first');
    void this.reconcileUser(userId).catch((err) => this.logger.warn(`Google sync for ${userId}: ${String(err)}`));
    return this.status(userId);
  }

  /** Remove our copies from Google (best effort), then forget the link. */
  async disconnect(userId: string): Promise<GoogleCalendarStatusDto> {
    const link = await this.prisma.googleCalendarLink.findUnique({ where: { userId } });
    if (link && !link.brokenAt) {
      try {
        const token = await this.accessToken(link);
        const maps = await this.prisma.googleCalendarEvent.findMany({ where: { userId } });
        for (const m of maps) await deleteEvent(token, link.calendarId, m.googleEventId).catch(() => undefined);
      } catch {
        /* revoked already — nothing we can remove */
      }
    }
    await this.prisma.googleCalendarEvent.deleteMany({ where: { userId } });
    await this.prisma.googleCalendarLink.deleteMany({ where: { userId } });
    return this.status(userId);
  }

  // ---------- reading (Google → Backstages) ----------

  /** The person's Google events in [from, to), or null when no usable link. */
  async eventsBetween(userId: string, from: Date, to: Date): Promise<CalendarEvent[] | null> {
    const link = await this.prisma.googleCalendarLink.findUnique({ where: { userId } });
    if (!link || link.brokenAt) return null;
    return this.withToken(link, (token) => listEvents(token, link.calendarId, from, to));
  }

  async hasUsableLink(userId: string): Promise<boolean> {
    return (await this.prisma.googleCalendarLink.count({ where: { userId, brokenAt: null } })) > 0;
  }

  /** Users with a working Google link (for presence "in a meeting" sync). */
  async linkedUserIds(): Promise<string[]> {
    return (await this.prisma.googleCalendarLink.findMany({ where: { brokenAt: null }, select: { userId: true } })).map((l) => l.userId);
  }

  // ---------- writing (Backstages → Google) ----------

  private async onMeetingChange(change: MeetingChange): Promise<void> {
    let userIds = change.userIds;
    if (!userIds) {
      const members = change.channelId
        ? await this.prisma.channelMember.findMany({ where: { channelId: change.channelId }, select: { userId: true } })
        : change.conversationId
          ? await this.prisma.conversationMember.findMany({ where: { conversationId: change.conversationId }, select: { userId: true } })
          : [];
      userIds = members.map((m) => m.userId);
    }
    if (!userIds.length) return;
    const linked = await this.prisma.googleCalendarLink.findMany({
      where: { userId: { in: userIds }, brokenAt: null },
      select: { userId: true },
    });
    for (const { userId } of linked) {
      await this.reconcileUser(userId).catch((err) => this.logger.warn(`Google sync for ${userId}: ${String(err)}`));
    }
  }

  async reconcileAll(): Promise<number> {
    let n = 0;
    for (const userId of await this.linkedUserIds()) {
      try {
        await this.reconcileUser(userId);
        n++;
      } catch (err) {
        this.logger.warn(`Google sync for ${userId}: ${String(err)}`);
      }
    }
    return n;
  }

  /**
   * Make the person's Google Calendar hold exactly the upcoming Backstages
   * meetings they're invited to and haven't declined. Serialised per person
   * (Redis lock); a change arriving mid-run triggers one more pass.
   */
  async reconcileUser(userId: string): Promise<void> {
    const lockKey = `gcal:lock:${userId}`;
    const dirtyKey = `gcal:dirty:${userId}`;
    if ((await this.redis.set(lockKey, '1', 'EX', 120, 'NX')) !== 'OK') {
      await this.redis.set(dirtyKey, '1', 'EX', 300);
      return;
    }
    try {
      for (let pass = 0; pass < 3; pass++) {
        await this.redis.del(dirtyKey);
        try {
          await this.reconcileOnce(userId);
        } catch (err) {
          // A 401 before the token's expiry means it was revoked: refresh once (which
          // marks the link broken if the grant itself is gone), then try again.
          if (!(err instanceof GoogleApiError && err.status === 401)) throw err;
          await this.prisma.googleCalendarLink.updateMany({ where: { userId }, data: { accessTokenExpiresAt: null } });
          await this.reconcileOnce(userId);
        }
        if (!(await this.redis.exists(dirtyKey))) break;
      }
    } finally {
      await this.redis.del(lockKey);
    }
  }

  private async reconcileOnce(userId: string): Promise<void> {
    const link = await this.prisma.googleCalendarLink.findUnique({ where: { userId } });
    if (!link || link.brokenAt) return;
    const token = await this.accessToken(link);
    const now = new Date();

    const desired = link.pushMeetings ? await this.upcomingMeetingsFor(userId, now) : [];
    const desiredIds = new Set(desired.map((m) => m.id));
    const maps = await this.prisma.googleCalendarEvent.findMany({ where: { userId } });
    const mapByMeeting = new Map(maps.map((m) => [m.scheduledHuddleId, m]));
    // Which of our copies still exist in Google (the person may have deleted one).
    // Doubles as a cheap check that our access still works.
    const present = await listOurEventIds(token, link.calendarId, new Date(now.getTime() - 24 * 3600_000), new Date(now.getTime() + HORIZON_MS + 24 * 3600_000));

    for (const meeting of desired) {
      const body = eventBodyFor(meeting);
      const hash = hashEvent(body);
      const existing = mapByMeeting.get(meeting.id);
      if (existing && existing.contentHash === hash && present.has(existing.googleEventId)) continue;
      if (existing) {
        try {
          await patchEvent(token, link.calendarId, existing.googleEventId, body);
          await this.prisma.googleCalendarEvent.update({ where: { id: existing.id }, data: { contentHash: hash } });
          continue;
        } catch (err) {
          // Deleted in Google by the person: put it back.
          if (!(err instanceof GoogleApiError && (err.status === 404 || err.status === 410))) throw err;
        }
      }
      const created = await insertEvent(token, link.calendarId, body);
      await this.prisma.googleCalendarEvent.upsert({
        where: { userId_scheduledHuddleId: { userId, scheduledHuddleId: meeting.id } },
        create: { userId, scheduledHuddleId: meeting.id, googleEventId: created.id, contentHash: hash },
        update: { googleEventId: created.id, contentHash: hash },
      });
    }

    // Copies whose meeting is gone, declined, no longer theirs, or push turned off.
    // Past meetings that simply aged out of the window are left in place.
    const stale = maps.filter((m) => !desiredIds.has(m.scheduledHuddleId));
    if (stale.length) {
      const still = await this.prisma.scheduledHuddle.findMany({
        where: { id: { in: stale.map((m) => m.scheduledHuddleId) } },
        select: { id: true, scheduledFor: true, durationMins: true },
      });
      const endedById = new Map(still.map((s) => [s.id, s.scheduledFor.getTime() + (s.durationMins ?? 30) * 60_000 < now.getTime()]));
      for (const m of stale) {
        const ended = endedById.get(m.scheduledHuddleId);
        if (ended && link.pushMeetings) continue; // history: keep
        await deleteEvent(token, link.calendarId, m.googleEventId);
        await this.prisma.googleCalendarEvent.delete({ where: { id: m.id } }).catch(() => undefined);
      }
    }
    await this.prisma.googleCalendarLink.update({ where: { id: link.id }, data: { lastSyncedAt: new Date() } });
  }

  /** Meetings in [now, now+horizon) where the person is a guest and hasn't declined. */
  private async upcomingMeetingsFor(userId: string, now: Date) {
    const where: Prisma.ScheduledHuddleWhereInput = {
      scheduledFor: { gte: new Date(now.getTime() - 10 * 60 * 60_000), lt: new Date(now.getTime() + HORIZON_MS) },
      OR: [{ channel: { members: { some: { userId } } } }, { conversation: { members: { some: { userId } } } }],
      responses: { none: { userId, response: 'DECLINED' } },
    };
    const rows = await this.prisma.scheduledHuddle.findMany({
      where,
      orderBy: { scheduledFor: 'asc' },
      take: 500,
      include: {
        channel: { select: { name: true } },
        conversation: { select: { members: { select: { user: { select: { id: true, displayName: true } } } } } },
      },
    });
    return rows
      // Only meetings that haven't ended yet.
      .filter((r) => r.scheduledFor.getTime() + (r.durationMins ?? 30) * 60_000 > now.getTime())
      .map((r) => {
        const others = r.conversation?.members.map((m) => m.user).filter((u) => u.id !== userId) ?? [];
        const locationName = r.channel ? `#${r.channel.name}` : others.map((u) => u.displayName).join(', ');
        const c = r.channelId ?? r.conversationId ?? '';
        return {
          id: r.id,
          title: r.title,
          description: r.description,
          scheduledFor: r.scheduledFor,
          durationMins: r.durationMins,
          reminderMins: r.reminderMins,
          timeZone: r.timeZone,
          locationName,
          link: `${webBase()}/app?ws=${r.workspaceId}&c=${c}&t=${r.channelId ? 'ch' : 'dm'}`,
        };
      });
  }

  // ---------- tokens ----------

  /** Run a Google call; on 401, refresh the token once and retry. */
  private async withToken<T>(link: GoogleCalendarLink, fn: (token: string) => Promise<T>): Promise<T> {
    try {
      return await fn(await this.accessToken(link));
    } catch (err) {
      if (!(err instanceof GoogleApiError && err.status === 401)) throw err;
      return fn(await this.accessToken({ ...link, accessTokenExpiresAt: null }));
    }
  }

  /** A valid access token, refreshing (and saving) it when it's about to expire. */
  private async accessToken(link: GoogleCalendarLink): Promise<string> {
    if (link.accessTokenEnc && link.accessTokenExpiresAt && link.accessTokenExpiresAt.getTime() > Date.now() + 60_000) {
      return decryptToken(link.accessTokenEnc);
    }
    const creds = providerCredentials('google');
    if (!creds) throw new Error('Google is not configured');
    try {
      const fresh = await googleRefresh(creds, decryptToken(link.refreshTokenEnc));
      await this.prisma.googleCalendarLink.update({
        where: { id: link.id },
        data: {
          accessTokenEnc: encryptToken(fresh.accessToken),
          accessTokenExpiresAt: new Date(Date.now() + fresh.expiresInSeconds * 1000),
        },
      });
      return fresh.accessToken;
    } catch (err) {
      if (err instanceof GoogleGrantError) {
        await this.prisma.googleCalendarLink.update({ where: { id: link.id }, data: { brokenAt: new Date() } });
      }
      throw err;
    }
  }
}
