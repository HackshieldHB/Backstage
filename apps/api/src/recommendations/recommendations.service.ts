import { Injectable, NotFoundException } from '@nestjs/common';
import type {
  BestTimeDto,
  CatchupPickDto,
  CatchupPicksDto,
  ChannelRecommendationDto,
  DiscoverDto,
  ExpertDto,
  ExpertsResponseDto,
  FocusRecommendationDto,
  FocusReportDto,
  FollowupItemDto,
  FollowupsDto,
  KnowledgeItemDto,
  KnowledgeResponseDto,
  PersonRecommendationDto,
  PriorityInboxDto,
  PriorityItemDto,
  RecommendationFeedbackInput,
  RecommendationKind,
} from '@backstages/shared';
import { PrismaService } from '../prisma/prisma.service';
import { PolicyService } from '../authz/policy.service';
import { PresenceService } from '../presence/presence.service';

const DAY = 24 * 60 * 60 * 1000;
/** How long a dismissed suggestion stays hidden before it can resurface. */
const SUPPRESS_MS = 14 * DAY;

/** Split a free-text query into distinct search terms, mirroring AiService.ask. */
function terms(text: string): string[] {
  return [...new Set((text.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []))].slice(0, 8);
}

/** Divide safely; returns 0 rather than NaN/Infinity when the divisor is 0. */
function ratio(n: number, d: number): number {
  return d > 0 ? n / d : 0;
}

/**
 * The recommendation engine. One stateless scoring service over the signal layer
 * (messages, reactions, mentions, huddles, activity segments, decisions,
 * presence). Deterministic and cheap — no LLM calls — so every endpoint works
 * whether or not AI is configured. The only persisted state is per-user feedback
 * (dismiss / act), used to suppress and, later, to train ranking.
 */
@Injectable()
export class RecommendationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
    private readonly presence: PresenceService,
  ) {}

  /** Target refIds the user dismissed recently for a given kind. */
  private async suppressed(
    userId: string,
    workspaceId: string,
    kind: RecommendationKind,
  ): Promise<Set<string>> {
    const rows = await this.prisma.recommendationFeedback.findMany({
      where: {
        userId,
        workspaceId,
        kind,
        action: 'DISMISSED',
        createdAt: { gte: new Date(Date.now() - SUPPRESS_MS) },
      },
      select: { refId: true },
    });
    return new Set(rows.map((r) => r.refId));
  }

  /** Channel ids the caller belongs to in this workspace. */
  private async myChannelIds(userId: string, workspaceId: string): Promise<string[]> {
    const rows = await this.prisma.channelMember.findMany({
      where: { userId, channel: { workspaceId } },
      select: { channelId: true },
    });
    return rows.map((r) => r.channelId);
  }

  // ---------------------------------------------------------------- R1: people
  async people(
    userId: string,
    workspaceId: string,
    limit = 8,
  ): Promise<PersonRecommendationDto[]> {
    await this.policy.requireWorkspaceMember(userId, workspaceId);
    const myChannels = await this.myChannelIds(userId, workspaceId);

    // Signals, gathered in parallel.
    const [sharedRows, reactionsToMe, myReactions, mySessions, myConvos] = await Promise.all([
      myChannels.length
        ? this.prisma.channelMember.groupBy({
            by: ['userId'],
            where: { channelId: { in: myChannels }, userId: { not: userId } },
            _count: { channelId: true },
          })
        : Promise.resolve([] as { userId: string; _count: { channelId: number } }[]),
      this.prisma.reaction.groupBy({
        by: ['userId'],
        where: { message: { workspaceId, userId }, userId: { not: userId } },
        _count: { _all: true },
      }),
      this.prisma.reaction.findMany({
        where: { userId, message: { workspaceId, userId: { not: userId } } },
        select: { message: { select: { userId: true } } },
        take: 500,
      }),
      this.prisma.huddleParticipant.findMany({
        where: { userId, session: { workspaceId } },
        select: { sessionId: true },
        take: 500,
      }),
      this.prisma.conversationMember.findMany({
        where: { userId, conversation: { workspaceId, isGroup: false } },
        select: { conversationId: true },
      }),
    ]);

    const sessionIds = mySessions.map((s) => s.sessionId);
    const [coHuddles, dmOthers] = await Promise.all([
      sessionIds.length
        ? this.prisma.huddleParticipant.groupBy({
            by: ['userId'],
            where: { sessionId: { in: sessionIds }, userId: { not: userId } },
            _count: { _all: true },
          })
        : Promise.resolve([] as { userId: string; _count: { _all: number } }[]),
      myConvos.length
        ? this.prisma.conversationMember.findMany({
            where: {
              conversationId: { in: myConvos.map((c) => c.conversationId) },
              userId: { not: userId },
            },
            select: { userId: true },
          })
        : Promise.resolve([] as { userId: string }[]),
    ]);

    const dmSet = new Set(dmOthers.map((d) => d.userId));

    // Merge signals into a per-candidate tally.
    type Sig = { shared: number; reactTo: number; reactBy: number; huddle: number };
    const sig = new Map<string, Sig>();
    const bump = (id: string, patch: Partial<Sig>) => {
      const cur = sig.get(id) ?? { shared: 0, reactTo: 0, reactBy: 0, huddle: 0 };
      sig.set(id, {
        shared: cur.shared + (patch.shared ?? 0),
        reactTo: cur.reactTo + (patch.reactTo ?? 0),
        reactBy: cur.reactBy + (patch.reactBy ?? 0),
        huddle: cur.huddle + (patch.huddle ?? 0),
      });
    };
    for (const r of sharedRows) bump(r.userId, { shared: r._count.channelId });
    for (const r of reactionsToMe) bump(r.userId, { reactTo: r._count._all });
    for (const r of myReactions) if (r.message.userId) bump(r.message.userId, { reactBy: 1 });
    for (const r of coHuddles) bump(r.userId, { huddle: r._count._all });

    const suppressed = await this.suppressed(userId, workspaceId, 'PERSON');
    const candidateIds = [...sig.keys()].filter((id) => !dmSet.has(id) && !suppressed.has(id));
    if (candidateIds.length === 0) return [];

    const members = await this.prisma.workspaceMember.findMany({
      where: { workspaceId, userId: { in: candidateIds }, deactivatedAt: null },
      select: {
        userId: true,
        user: { select: { displayName: true, avatarUrl: true, isProvisional: true } },
      },
    });

    const raw = members.map((m) => {
      const s = sig.get(m.userId)!;
      const score = s.shared * 1 + s.reactTo * 0.6 + s.reactBy * 0.4 + s.huddle * 1.5;
      return { m, s, score };
    });
    const max = Math.max(...raw.map((r) => r.score), 1);

    return raw
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(({ m, s, score }) => ({
        userId: m.userId,
        displayName: m.user.displayName,
        avatarUrl: m.user.avatarUrl,
        isProvisional: m.user.isProvisional,
        score: Math.round(ratio(score, max) * 100) / 100,
        sharedChannels: s.shared,
        reason: this.personReason(s),
      }));
  }

  private personReason(s: { shared: number; reactTo: number; reactBy: number; huddle: number }): string {
    if (s.huddle > 0) return `You've been in ${s.huddle} huddle${s.huddle > 1 ? 's' : ''} together`;
    if (s.shared > 0)
      return `${s.shared} shared channel${s.shared > 1 ? 's' : ''}${
        s.reactTo + s.reactBy > 0 ? ' · you react to each other' : ''
      }`;
    if (s.reactTo + s.reactBy > 0) return 'You react to each other often';
    return 'Someone you work near';
  }

  // -------------------------------------------------------------- R2: channels
  async channels(
    userId: string,
    workspaceId: string,
    limit = 8,
  ): Promise<ChannelRecommendationDto[]> {
    await this.policy.requireWorkspaceMember(userId, workspaceId);
    const myChannels = await this.myChannelIds(userId, workspaceId);

    // My collaborators = everyone who shares a channel with me.
    const collaboratorRows = myChannels.length
      ? await this.prisma.channelMember.findMany({
          where: { channelId: { in: myChannels }, userId: { not: userId } },
          select: { userId: true },
          distinct: ['userId'],
        })
      : [];
    const collaboratorIds = collaboratorRows.map((r) => r.userId);

    const candidates = await this.prisma.channel.findMany({
      where: {
        workspaceId,
        isPrivate: false,
        isArchived: false,
        groupKey: null,
        id: myChannels.length ? { notIn: myChannels } : undefined,
      },
      select: { id: true, name: true, _count: { select: { members: true } } },
      take: 100,
    });
    if (candidates.length === 0) return [];
    const candidateIds = candidates.map((c) => c.id);
    const weekAgo = new Date(Date.now() - 7 * DAY);

    const [collabPresent, activity] = await Promise.all([
      collaboratorIds.length
        ? this.prisma.channelMember.groupBy({
            by: ['channelId'],
            where: { channelId: { in: candidateIds }, userId: { in: collaboratorIds } },
            _count: { userId: true },
          })
        : Promise.resolve([] as { channelId: string; _count: { userId: number } }[]),
      this.prisma.message.groupBy({
        by: ['channelId'],
        where: { channelId: { in: candidateIds }, deletedAt: null, createdAt: { gte: weekAgo } },
        _count: { _all: true },
      }),
    ]);

    const collabByCh = new Map(collabPresent.map((r) => [r.channelId, r._count.userId]));
    const actByCh = new Map(activity.map((r) => [r.channelId!, r._count._all]));
    const suppressed = await this.suppressed(userId, workspaceId, 'CHANNEL');

    const raw = candidates
      .filter((c) => !suppressed.has(c.id))
      .map((c) => {
        const collab = collabByCh.get(c.id) ?? 0;
        const act = actByCh.get(c.id) ?? 0;
        return { c, collab, act, score: collab * 1 + Math.min(act, 50) * 0.06 };
      })
      .filter((r) => r.score > 0);
    if (raw.length === 0) return [];
    const max = Math.max(...raw.map((r) => r.score), 1);

    return raw
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(({ c, collab, act, score }) => ({
        channelId: c.id,
        name: c.name,
        memberCount: c._count.members,
        score: Math.round(ratio(score, max) * 100) / 100,
        reason:
          collab > 0
            ? `${collab} of your collaborator${collab > 1 ? 's are' : ' is'} here${
                act > 0 ? ` · ${act} messages this week` : ''
              }`
            : `${act} messages this week`,
      }));
  }

  // -------------------------------------------------------------- R3: priority
  async priorityInbox(
    userId: string,
    workspaceId: string,
    limit = 12,
  ): Promise<PriorityInboxDto> {
    await this.policy.requireWorkspaceMember(userId, workspaceId);
    const myChannels = await this.myChannelIds(userId, workspaceId);

    const [notifs, decisions, topCollab] = await Promise.all([
      this.prisma.notification.findMany({
        where: { userId, readAt: null },
        orderBy: { createdAt: 'desc' },
        take: 60,
        include: {
          actor: { select: { displayName: true } },
          channel: { select: { id: true, name: true } },
          message: {
            select: { id: true, contentText: true, channelId: true, conversationId: true },
          },
        },
      }),
      this.prisma.decision.findMany({
        where: { workspaceId, ownerId: userId, status: 'OPEN', dueAt: { not: null } },
        take: 20,
      }),
      myChannels.length
        ? this.prisma.channelMember.groupBy({
            by: ['userId'],
            where: { channelId: { in: myChannels }, userId: { not: userId } },
            _count: { channelId: true },
            orderBy: { _count: { channelId: 'desc' } },
            take: 10,
          })
        : Promise.resolve([] as { userId: string }[]),
    ]);
    const collabSet = new Set(topCollab.map((c) => c.userId));

    const base: Record<string, number> = {
      DM: 0.9,
      MENTION: 0.85,
      THREAD_REPLY: 0.6,
      CHANNEL_MESSAGE: 0.4,
      REACTION: 0.3,
      SYSTEM: 0.2,
    };
    const now = Date.now();
    const items: PriorityItemDto[] = [];

    for (const n of notifs) {
      const ageH = (now - n.createdAt.getTime()) / 3_600_000;
      const recency = Math.max(0, 1 - ageH / 72); // decays over 3 days
      const collabBoost = n.actorId && collabSet.has(n.actorId) ? 0.12 : 0;
      const score = Math.min(1, (base[n.type] ?? 0.3) + recency * 0.15 + collabBoost);
      const source =
        n.type === 'DM'
          ? 'dm'
          : n.type === 'MENTION'
            ? 'mention'
            : n.type === 'THREAD_REPLY'
              ? 'thread'
              : n.type === 'REACTION'
                ? 'reaction'
                : n.type === 'SYSTEM'
                  ? 'system'
                  : 'mention';
      const who = n.actor?.displayName ?? 'Someone';
      const where = n.channel?.name ? `#${n.channel.name}` : n.type === 'DM' ? 'a DM' : '';
      items.push({
        id: n.id,
        source: source as PriorityItemDto['source'],
        score: Math.round(score * 100) / 100,
        reason:
          n.type === 'DM'
            ? `Direct message from ${who}`
            : n.type === 'MENTION'
              ? `${who} mentioned you${where ? ` in ${where}` : ''}`
              : n.type === 'THREAD_REPLY'
                ? `${who} replied in a thread`
                : n.type === 'REACTION'
                  ? `${who} reacted to your message`
                  : `${who}${where ? ` in ${where}` : ''}`,
        title: where || who,
        preview: n.message?.contentText?.slice(0, 140) ?? null,
        actorName: n.actor?.displayName ?? null,
        channelId: n.channel?.id ?? n.message?.channelId ?? null,
        conversationId: n.message?.conversationId ?? null,
        messageId: n.message?.id ?? null,
        createdAt: n.createdAt.toISOString(),
      });
    }

    for (const d of decisions) {
      const due = d.dueAt!.getTime();
      const overdue = due < now;
      const daysToDue = (due - now) / DAY;
      const score = overdue ? 0.95 : daysToDue <= 2 ? 0.8 : 0.5;
      items.push({
        id: d.id,
        source: 'decision',
        score,
        reason: overdue
          ? `Decision you own is overdue`
          : `Decision you own is due ${daysToDue <= 1 ? 'today' : `in ${Math.ceil(daysToDue)} days`}`,
        title: d.title,
        preview: d.detail ? d.detail.slice(0, 140) : null,
        actorName: null,
        channelId: d.channelId,
        conversationId: null,
        messageId: d.messageId,
        createdAt: d.createdAt.toISOString(),
      });
    }

    items.sort((a, b) => b.score - a.score || (a.createdAt < b.createdAt ? 1 : -1));
    return { items: items.slice(0, limit) };
  }

  // ----------------------------------------------------------------- R4: focus
  async focus(userId: string, workspaceId: string): Promise<FocusReportDto> {
    await this.policy.requireWorkspaceMember(userId, workspaceId);
    const since = new Date(Date.now() - 14 * DAY);

    const [util, segs] = await Promise.all([
      this.prisma.utilizationDaily.findMany({
        where: { workspaceId, userId, day: { gte: since } },
      }),
      this.prisma.activitySegment.findMany({
        where: {
          workspaceId,
          userId,
          startedAt: { gte: since },
          kind: { in: ['MEETING', 'IMPLEMENTATION'] },
        },
        select: { kind: true, durationSec: true },
      }),
    ]);

    const daysCovered = util.length;
    if (daysCovered < 3) {
      return {
        available: false,
        daysCovered,
        meetingHoursPerDay: 0,
        focusHoursPerDay: 0,
        meetingsPerDay: 0,
        longestFocusBlockMin: 0,
        recommendations: [],
      };
    }

    const meetingSec = util.reduce((a, r) => a + r.meetingSec, 0);
    const focusSec = util.reduce((a, r) => a + r.implementationSec, 0);
    const meetingHoursPerDay = Math.round(ratio(meetingSec, daysCovered) / 360) / 10;
    const focusHoursPerDay = Math.round(ratio(focusSec, daysCovered) / 360) / 10;
    const meetingCount = segs.filter((s) => s.kind === 'MEETING').length;
    const meetingsPerDay = Math.round(ratio(meetingCount, daysCovered) * 10) / 10;
    const longestFocusBlockMin = Math.round(
      Math.max(0, ...segs.filter((s) => s.kind === 'IMPLEMENTATION').map((s) => s.durationSec ?? 0)) /
        60,
    );

    const recs: FocusRecommendationDto[] = [];
    if (meetingHoursPerDay >= 4) {
      recs.push({
        key: 'meeting_heavy',
        level: 'high',
        title: 'Meeting-heavy schedule',
        detail: `You're averaging ${meetingHoursPerDay}h/day in meetings. That leaves little room for focused work.`,
        action: 'Block a no-meeting focus window',
      });
    } else if (meetingHoursPerDay >= 2.5) {
      recs.push({
        key: 'meeting_watch',
        level: 'watch',
        title: 'Meetings are creeping up',
        detail: `About ${meetingHoursPerDay}h/day in meetings over the last ${daysCovered} days.`,
        action: 'Audit recurring meetings',
      });
    }
    if (focusHoursPerDay > 0 && longestFocusBlockMin > 0 && longestFocusBlockMin < 45) {
      recs.push({
        key: 'fragmented',
        level: meetingsPerDay >= 5 ? 'high' : 'watch',
        title: 'Fragmented focus time',
        detail: `Your longest uninterrupted focus block is only ~${longestFocusBlockMin} min${
          meetingsPerDay >= 5 ? ` across ~${meetingsPerDay} meetings/day` : ''
        }.`,
        action: 'Batch meetings into one part of the day',
      });
    }
    if (recs.length === 0) {
      recs.push({
        key: 'balanced',
        level: 'ok',
        title: 'Healthy balance',
        detail: `~${focusHoursPerDay}h/day focus vs ~${meetingHoursPerDay}h/day meetings. Keep it up.`,
        action: null,
      });
    }

    return {
      available: true,
      daysCovered,
      meetingHoursPerDay,
      focusHoursPerDay,
      meetingsPerDay,
      longestFocusBlockMin,
      recommendations: recs,
    };
  }

  // ------------------------------------------------------------- R5: best time
  async bestTime(
    userId: string,
    workspaceId: string,
    targetUserId: string,
  ): Promise<BestTimeDto> {
    await this.policy.requireWorkspaceMember(userId, workspaceId);
    // Target must be a member of the same workspace.
    const member = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: targetUserId } },
      select: { user: { select: { displayName: true, dndUntil: true } } },
    });
    if (!member) throw new NotFoundException('User not found');

    const status = await this.presence.effectiveState(targetUserId);
    const dnd = member.user.dndUntil && member.user.dndUntil.getTime() > Date.now();
    const reachableNow = status === 'ACTIVE' && !dnd;
    if (reachableNow) {
      return {
        userId: targetUserId,
        displayName: member.user.displayName,
        status,
        reachableNow: true,
        suggestedAt: null,
        reason: 'Active now',
      };
    }

    // Usual online hours from the last 30 days of presence segments (UTC).
    const segs = await this.prisma.activitySegment.findMany({
      where: {
        workspaceId,
        userId: targetUserId,
        source: 'PRESENCE',
        kind: 'ONLINE',
        startedAt: { gte: new Date(Date.now() - 30 * DAY) },
      },
      select: { startedAt: true },
      take: 2000,
    });

    let suggestedAt: string | null = null;
    let hourReason = '';
    if (segs.length >= 5) {
      const hist = new Array(24).fill(0);
      for (const s of segs) hist[s.startedAt.getUTCHours()]++;
      // Find the next upcoming hour (within 24h) with above-average activity.
      const avg = segs.length / 24;
      const now = new Date();
      for (let i = 1; i <= 24; i++) {
        const cand = new Date(now.getTime() + i * 3_600_000);
        const h = cand.getUTCHours();
        if (hist[h] >= avg * 1.2) {
          cand.setUTCMinutes(0, 0, 0);
          suggestedAt = cand.toISOString();
          hourReason = ` — usually online around then`;
          break;
        }
      }
    }

    const reason = dnd
      ? `In Do Not Disturb${suggestedAt ? '; try later' : ''}${hourReason}`
      : status === 'AWAY'
        ? `Away right now${hourReason || (suggestedAt ? '; try later' : '')}`
        : `Offline right now${hourReason || (suggestedAt ? '; try later' : '')}`;

    return {
      userId: targetUserId,
      displayName: member.user.displayName,
      status,
      reachableNow: false,
      suggestedAt,
      reason,
    };
  }

  // --------------------------------------------------------------- R6: experts
  async experts(
    userId: string,
    workspaceId: string,
    query: string,
    limit = 5,
  ): Promise<ExpertsResponseDto> {
    await this.policy.requireWorkspaceMember(userId, workspaceId);
    const t = terms(query);
    if (t.length === 0) return { experts: [] };
    const { channelIds } = await this.policy.accessibleContainers(userId, workspaceId);

    const [decisions, messages] = await Promise.all([
      this.prisma.decision.findMany({
        where: {
          workspaceId,
          OR: t.flatMap((term) => [
            { title: { contains: term, mode: 'insensitive' as const } },
            { detail: { contains: term, mode: 'insensitive' as const } },
            { outcome: { contains: term, mode: 'insensitive' as const } },
          ]),
        },
        select: { createdById: true, decidedById: true },
        take: 60,
      }),
      channelIds.length
        ? this.prisma.message.findMany({
            where: {
              workspaceId,
              deletedAt: null,
              channelId: { in: channelIds },
              userId: { not: null },
              OR: t.map((term) => ({ contentText: { contains: term, mode: 'insensitive' as const } })),
            },
            select: { userId: true },
            take: 300,
          })
        : Promise.resolve([] as { userId: string | null }[]),
    ]);

    type Tally = { msgs: number; decisions: number };
    const tally = new Map<string, Tally>();
    const add = (id: string | null | undefined, patch: Partial<Tally>) => {
      if (!id || id === userId) return;
      const cur = tally.get(id) ?? { msgs: 0, decisions: 0 };
      tally.set(id, { msgs: cur.msgs + (patch.msgs ?? 0), decisions: cur.decisions + (patch.decisions ?? 0) });
    };
    for (const d of decisions) {
      add(d.createdById, { decisions: 1 });
      add(d.decidedById, { decisions: 1 });
    }
    for (const m of messages) add(m.userId, { msgs: 1 });

    const ids = [...tally.keys()];
    if (ids.length === 0) return { experts: [] };
    const members = await this.prisma.workspaceMember.findMany({
      where: { workspaceId, userId: { in: ids }, deactivatedAt: null },
      select: { userId: true, user: { select: { displayName: true, avatarUrl: true } } },
    });

    const raw = members.map((m) => {
      const tl = tally.get(m.userId)!;
      return { m, tl, score: tl.decisions * 3 + tl.msgs };
    });
    const max = Math.max(...raw.map((r) => r.score), 1);

    const experts: ExpertDto[] = raw
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(({ m, tl, score }) => ({
        userId: m.userId,
        displayName: m.user.displayName,
        avatarUrl: m.user.avatarUrl,
        score: Math.round(ratio(score, max) * 100) / 100,
        reason: [
          tl.msgs > 0 ? `${tl.msgs} message${tl.msgs > 1 ? 's' : ''}` : null,
          tl.decisions > 0 ? `${tl.decisions} decision${tl.decisions > 1 ? 's' : ''}` : null,
        ]
          .filter(Boolean)
          .join(' & ') + ' on this topic',
      }));
    return { experts };
  }

  // --------------------------------------------------------------- R7: catchup
  async catchup(userId: string, workspaceId: string, limit = 6): Promise<CatchupPicksDto> {
    await this.policy.requireWorkspaceMember(userId, workspaceId);

    const [chMembers, convMembers, topCollab] = await Promise.all([
      this.prisma.channelMember.findMany({
        where: { userId, channel: { workspaceId, isArchived: false } },
        select: {
          channelId: true,
          channel: { select: { name: true } },
          lastReadMessage: { select: { createdAt: true } },
        },
        take: 60,
      }),
      this.prisma.conversationMember.findMany({
        where: { userId, conversation: { workspaceId } },
        select: {
          conversationId: true,
          conversation: { select: { isGroup: true, title: true } },
          lastReadMessage: { select: { createdAt: true } },
        },
        take: 40,
      }),
      this.prisma.channelMember
        .findMany({
          where: { userId, channel: { workspaceId } },
          select: { channelId: true },
        })
        .then((rows) => rows.map((r) => r.channelId)),
    ]);

    const epoch = new Date(0);
    const picks: CatchupPickDto[] = [];

    await Promise.all([
      ...chMembers.map(async (cm) => {
        const cutoff = cm.lastReadMessage?.createdAt ?? epoch;
        const [unread, mentions] = await Promise.all([
          this.prisma.message.count({
            where: {
              channelId: cm.channelId,
              deletedAt: null,
              userId: { not: userId },
              createdAt: { gt: cutoff },
            },
          }),
          this.prisma.mention.count({
            where: {
              userId,
              message: { channelId: cm.channelId, createdAt: { gt: cutoff }, deletedAt: null },
            },
          }),
        ]);
        if (unread === 0) return;
        const latest = await this.prisma.message.findFirst({
          where: { channelId: cm.channelId, deletedAt: null, createdAt: { gt: cutoff } },
          orderBy: { createdAt: 'desc' },
          select: { id: true },
        });
        picks.push({
          channelId: cm.channelId,
          conversationId: null,
          label: `#${cm.channel.name}`,
          unread,
          mentions,
          score: 0,
          reason: mentions > 0 ? `${mentions} mention${mentions > 1 ? 's' : ''} · ${unread} unread` : `${unread} unread`,
          latestMessageId: latest?.id ?? null,
        });
      }),
      ...convMembers.map(async (cm) => {
        const cutoff = cm.lastReadMessage?.createdAt ?? epoch;
        const unread = await this.prisma.message.count({
          where: {
            conversationId: cm.conversationId,
            deletedAt: null,
            userId: { not: userId },
            createdAt: { gt: cutoff },
          },
        });
        if (unread === 0) return;
        const latest = await this.prisma.message.findFirst({
          where: { conversationId: cm.conversationId, deletedAt: null, createdAt: { gt: cutoff } },
          orderBy: { createdAt: 'desc' },
          select: { id: true },
        });
        picks.push({
          channelId: null,
          conversationId: cm.conversationId,
          label: cm.conversation.title ?? 'Direct message',
          unread,
          mentions: cm.conversation.isGroup ? 0 : unread, // a 1:1 DM is inherently "for you"
          score: 0,
          reason: `${unread} unread`,
          latestMessageId: latest?.id ?? null,
        });
      }),
    ]);

    void topCollab; // reserved for future collaboration weighting
    const maxUnread = Math.max(...picks.map((p) => p.unread), 1);
    for (const p of picks) {
      p.score =
        Math.round((ratio(p.unread, maxUnread) * 0.6 + Math.min(p.mentions, 3) * 0.15 + (p.conversationId ? 0.1 : 0)) * 100) /
        100;
    }
    picks.sort((a, b) => b.score - a.score);
    return { picks: picks.slice(0, limit) };
  }

  // ------------------------------------------------------------- R8: knowledge
  async knowledge(userId: string, messageId: string, limit = 5): Promise<KnowledgeResponseDto> {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      select: {
        contentText: true,
        workspaceId: true,
        channelId: true,
        conversationId: true,
      },
    });
    if (!message) throw new NotFoundException('Message not found');
    if (message.channelId) await this.policy.requireChannelMember(userId, message.channelId);
    else if (message.conversationId)
      await this.policy.requireConversationMember(userId, message.conversationId);
    else await this.policy.requireWorkspaceMember(userId, message.workspaceId);

    const t = terms(message.contentText);
    if (t.length === 0) return { items: [] };

    const decisions = await this.prisma.decision.findMany({
      where: {
        workspaceId: message.workspaceId,
        OR: t.flatMap((term) => [
          { title: { contains: term, mode: 'insensitive' as const } },
          { detail: { contains: term, mode: 'insensitive' as const } },
          { outcome: { contains: term, mode: 'insensitive' as const } },
        ]),
      },
      select: { id: true, title: true, channelId: true, status: true, outcome: true },
      take: 20,
    });

    const scored = decisions
      .map((d) => {
        const hay = `${d.title} ${d.outcome ?? ''}`.toLowerCase();
        const hits = t.filter((term) => hay.includes(term)).length;
        return { d, hits };
      })
      .sort((a, b) => b.hits - a.hits)
      .slice(0, limit);
    const max = Math.max(...scored.map((s) => s.hits), 1);

    const items: KnowledgeItemDto[] = scored.map(({ d, hits }) => ({
      kind: 'decision',
      id: d.id,
      title: d.title,
      channelId: d.channelId,
      score: Math.round(ratio(hits, max) * 100) / 100,
      reason:
        d.status === 'DECIDED' || d.outcome
          ? 'A related decision was already made'
          : 'A related open decision',
    }));

    // Include the channel's canvas if it exists — the shared doc for this space.
    if (message.channelId && items.length < limit) {
      const canvas = await this.prisma.canvas.findUnique({
        where: { channelId: message.channelId },
        select: { id: true },
      });
      if (canvas) {
        items.push({
          kind: 'canvas',
          id: canvas.id,
          title: 'Channel canvas',
          channelId: message.channelId,
          score: 0.3,
          reason: 'The shared canvas for this channel',
        });
      }
    }
    return { items };
  }

  // -------------------------------------------------------------- R9: followups
  async followups(userId: string, workspaceId: string, limit = 10): Promise<FollowupsDto> {
    await this.policy.requireWorkspaceMember(userId, workspaceId);
    const decisions = await this.prisma.decision.findMany({
      where: {
        workspaceId,
        status: 'OPEN',
        OR: [{ ownerId: userId }, { createdById: userId }],
      },
      select: { id: true, title: true, dueAt: true, channelId: true, ownerId: true },
      take: 40,
    });
    const now = Date.now();

    const items: FollowupItemDto[] = decisions
      .map((d) => {
        const overdue = !!d.dueAt && d.dueAt.getTime() < now;
        const days = d.dueAt ? Math.ceil((d.dueAt.getTime() - now) / DAY) : null;
        return {
          d,
          overdue,
          days,
          sort: overdue ? 0 : d.dueAt ? 1 : 2,
        };
      })
      .sort((a, b) => a.sort - b.sort || (a.d.dueAt?.getTime() ?? Infinity) - (b.d.dueAt?.getTime() ?? Infinity))
      .slice(0, limit)
      .map(({ d, overdue, days }) => ({
        kind: 'decision' as const,
        id: d.id,
        title: d.title,
        dueAt: d.dueAt ? d.dueAt.toISOString() : null,
        overdue,
        channelId: d.channelId,
        reason: overdue
          ? `Overdue by ${Math.abs(days ?? 0)} day${Math.abs(days ?? 0) === 1 ? '' : 's'}`
          : days !== null
            ? days <= 0
              ? 'Due today'
              : `Due in ${days} day${days === 1 ? '' : 's'}`
            : d.ownerId === userId
              ? 'Open — you own this'
              : 'Open — you raised this',
      }));
    return { items };
  }

  // ------------------------------------------------------------ combined + fb
  async discover(userId: string, workspaceId: string): Promise<DiscoverDto> {
    const [people, channels, followups] = await Promise.all([
      this.people(userId, workspaceId, 6),
      this.channels(userId, workspaceId, 6),
      this.followups(userId, workspaceId, 6),
    ]);
    return { people, channels, followups: followups.items };
  }

  async recordFeedback(
    userId: string,
    workspaceId: string,
    input: RecommendationFeedbackInput,
  ): Promise<{ ok: true }> {
    await this.policy.requireWorkspaceMember(userId, workspaceId);
    await this.prisma.recommendationFeedback.upsert({
      where: { userId_kind_refId: { userId, kind: input.kind, refId: input.refId } },
      create: {
        userId,
        workspaceId,
        kind: input.kind,
        refId: input.refId,
        action: input.action,
      },
      update: { action: input.action, createdAt: new Date() },
    });
    return { ok: true };
  }
}
