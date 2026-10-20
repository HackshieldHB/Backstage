import { Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import type { GithubSubscription } from '@prisma/client';
import type { GithubEvent, JiraUnfurl } from '@backstages/shared';
import { PrismaService } from '../prisma/prisma.service';
import { RedisClient } from '../redis/redis.module';
import { IntegrationMessagesService } from '../messages/integration-messages.service';
import { channelContainer } from '../messages/messages.service';

/** The parts of GitHub webhook payloads we read. */
interface GhUser {
  login?: string;
}
interface GhItem {
  number?: number;
  title?: string;
  html_url?: string;
  state?: string;
  draft?: boolean;
  merged?: boolean;
  user?: GhUser;
  head?: { ref?: string };
  base?: { ref?: string };
  state_reason?: string | null;
  pull_request?: unknown;
}
export interface GithubWebhookBody {
  action?: string;
  repository?: { full_name?: string };
  sender?: GhUser;
  pull_request?: GhItem;
  issue?: GhItem;
  review?: { state?: string; user?: GhUser; html_url?: string };
  comment?: { body?: string; user?: GhUser; html_url?: string };
  workflow_run?: {
    name?: string;
    conclusion?: string | null;
    head_branch?: string;
    html_url?: string;
    head_commit?: { message?: string };
    pull_requests?: { number?: number }[];
  };
  release?: { tag_name?: string; name?: string | null; html_url?: string; prerelease?: boolean };
}

/** What one delivery means for the channel. */
export interface GithubChange {
  event: GithubEvent;
  /** Set when it belongs to a PR/issue (its card); null = standalone message. */
  item: { kind: 'pr' | 'issue'; number: number; title: string; url: string; state: string } | null;
  text: string;
  url?: string;
}

const firstLine = (s: string | undefined, max = 120) => {
  const line = (s ?? '').split('\n')[0].trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
};

function itemOf(kind: 'pr' | 'issue', it: GhItem | undefined) {
  if (!it || typeof it.number !== 'number') return null;
  const state = kind === 'pr' ? (it.merged ? 'merged' : it.draft && it.state === 'open' ? 'draft' : (it.state ?? 'open')) : (it.state ?? 'open');
  return { kind, number: it.number, title: it.title ?? '', url: it.html_url ?? '', state };
}

/**
 * Translate a GitHub delivery into a channel change, or null when it isn't
 * something we post (unsupported event, draft PR opened, comment-only review…).
 * Pure: easy to test against real payload shapes.
 */
export function describeGithubEvent(eventName: string, body: GithubWebhookBody): GithubChange | null {
  const actor = body.sender?.login ?? 'someone';
  switch (eventName) {
    case 'pull_request': {
      const pr = body.pull_request;
      const item = itemOf('pr', pr);
      if (!item) return null;
      const label = `PR #${item.number}`;
      const branches = pr?.head?.ref && pr?.base?.ref ? ` (${pr.head.ref} → ${pr.base.ref})` : '';
      switch (body.action) {
        case 'opened':
          // Drafts announce themselves when they're ready for review.
          if (pr?.draft) return null;
          return { event: 'pr_opened', item, text: `${label} opened by ${pr?.user?.login ?? actor}${branches}: ${item.title}`, url: item.url };
        case 'ready_for_review':
          return { event: 'pr_ready', item, text: `${label} is ready for review: ${item.title}`, url: item.url };
        case 'closed':
          return pr?.merged
            ? { event: 'pr_merged', item, text: `${label} merged by ${actor}: ${item.title}`, url: item.url }
            : { event: 'pr_closed', item, text: `${label} closed by ${actor}: ${item.title}`, url: item.url };
        case 'reopened':
          return { event: 'pr_reopened', item, text: `${label} reopened by ${actor}: ${item.title}`, url: item.url };
        default:
          return null;
      }
    }
    case 'pull_request_review': {
      if (body.action !== 'submitted') return null;
      const item = itemOf('pr', body.pull_request);
      const state = body.review?.state?.toLowerCase();
      if (!item || (state !== 'approved' && state !== 'changes_requested')) return null;
      const who = body.review?.user?.login ?? actor;
      const verb = state === 'approved' ? '✅ approved' : '🔁 requested changes on';
      return { event: 'pr_review', item, text: `${who} ${verb} PR #${item.number}: ${item.title}`, url: body.review?.html_url ?? item.url };
    }
    case 'issues': {
      const item = itemOf('issue', body.issue);
      if (!item) return null;
      const label = `Issue #${item.number}`;
      switch (body.action) {
        case 'opened':
          return { event: 'issue_opened', item, text: `${label} opened by ${body.issue?.user?.login ?? actor}: ${item.title}`, url: item.url };
        case 'closed': {
          const how = body.issue?.state_reason === 'not_planned' ? ' as not planned' : '';
          return { event: 'issue_closed', item, text: `${label} closed${how} by ${actor}: ${item.title}`, url: item.url };
        }
        case 'reopened':
          return { event: 'issue_reopened', item, text: `${label} reopened by ${actor}: ${item.title}`, url: item.url };
        default:
          return null;
      }
    }
    case 'issue_comment':
    case 'pull_request_review_comment': {
      if (body.action !== 'created') return null;
      const isPr = eventName === 'pull_request_review_comment' || !!body.issue?.pull_request;
      const item = itemOf(isPr ? 'pr' : 'issue', isPr ? (body.pull_request ?? body.issue) : body.issue);
      if (!item) return null;
      const who = body.comment?.user?.login ?? actor;
      return {
        event: 'comment',
        item,
        text: `${who} commented on ${isPr ? 'PR' : 'issue'} #${item.number}: ${firstLine(body.comment?.body, 200)}`,
        url: body.comment?.html_url ?? item.url,
      };
    }
    case 'workflow_run': {
      const run = body.workflow_run;
      if (body.action !== 'completed' || !run) return null;
      if (run.conclusion !== 'failure' && run.conclusion !== 'timed_out') return null;
      const pr = run.pull_requests?.find((p) => typeof p.number === 'number');
      const commit = firstLine(run.head_commit?.message, 80);
      return {
        event: 'ci_failed',
        // Threads under the PR's card when there is one.
        item: pr ? { kind: 'pr', number: pr.number!, title: '', url: '', state: '' } : null,
        text: `❌ ${run.name ?? 'CI'} ${run.conclusion === 'timed_out' ? 'timed out' : 'failed'} on ${run.head_branch ?? 'a branch'}${commit ? ` — ${commit}` : ''}`,
        url: run.html_url,
      };
    }
    case 'release': {
      const rel = body.release;
      if (body.action !== 'published' || !rel) return null;
      const name = rel.name && rel.name !== rel.tag_name ? ` — ${rel.name}` : '';
      return {
        event: 'release',
        item: null,
        text: `🚀 ${rel.prerelease ? 'Pre-release' : 'Release'} ${rel.tag_name ?? ''}${name} published by ${actor}`,
        url: rel.html_url,
      };
    }
    default:
      return null;
  }
}

function doc(text: string, href?: string) {
  return {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text, ...(href ? { marks: [{ type: 'link', attrs: { href } }] } : {}) }] },
    ],
  };
}

/** Verify GitHub's X-Hub-Signature-256 over the exact raw request body. */
export function verifyGithubSignature(secret: string, rawBody: Buffer | undefined, header: string | undefined): boolean {
  if (!rawBody || !header || !header.startsWith('sha256=')) return false;
  const expected = Buffer.from(`sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`);
  const given = Buffer.from(header);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * GitHub repo webhooks → channel messages. The first event for a PR/issue posts
 * a card; later ones (reviews, comments, CI failures, merge) thread under it and
 * keep the card's state badge current. Releases and CI failures without a PR
 * post on their own.
 */
@Injectable()
export class GithubEventsService {
  private readonly logger = new Logger(GithubEventsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisClient,
    private readonly integrationMessages: IntegrationMessagesService,
  ) {}

  async handleWebhook(
    subscriptionId: string,
    input: { rawBody: Buffer | undefined; signature: string | undefined; event: string | undefined; delivery: string | undefined },
    body: GithubWebhookBody,
  ): Promise<{ ok: true; posted: boolean; handled: GithubEvent | null }> {
    const sub = await this.prisma.githubSubscription.findUnique({ where: { id: subscriptionId } });
    if (!sub) throw new NotFoundException('Unknown subscription');
    if (!verifyGithubSignature(sub.webhookSecret, input.rawBody, input.signature)) {
      throw new UnauthorizedException('Invalid signature');
    }
    if (input.event === 'ping') return { ok: true, posted: false, handled: null };

    // The repo is pinned per subscription: a secret leaked from one repo's hook
    // must not let another repo post into this channel.
    const repo = body.repository?.full_name?.toLowerCase();
    if (!repo || repo !== sub.repoFullName) {
      this.logger.warn(`GitHub payload for ${repo ?? '?'} sent to subscription for ${sub.repoFullName}`);
      return { ok: true, posted: false, handled: null };
    }

    const change = describeGithubEvent(input.event ?? '', body);
    if (!change || !sub.events.includes(change.event)) return { ok: true, posted: false, handled: change?.event ?? null };

    // GitHub retries deliveries; post each one once.
    if (input.delivery) {
      const fresh = await this.redis.set(`gh:delivery:${sub.id}:${input.delivery}`, '1', 'EX', 86400, 'NX');
      if (fresh !== 'OK') return { ok: true, posted: false, handled: change.event };
    }

    await this.post(sub, change);
    return { ok: true, posted: true, handled: change.event };
  }

  private async post(sub: GithubSubscription, change: GithubChange) {
    const base = { workspaceId: sub.workspaceId, appName: 'GitHub', contentText: change.text, contentJson: doc(change.text, change.url) };
    const item = change.item;
    if (!item) {
      await this.integrationMessages.post(channelContainer(sub.channelId), base);
      return;
    }
    const card = await this.prisma.githubCard.findUnique({
      where: { subscriptionId_kind_number: { subscriptionId: sub.id, kind: item.kind, number: item.number } },
    });
    const unfurl: JiraUnfurl | null =
      item.url && item.title
        ? { type: 'github', url: item.url, key: `${sub.repoFullName}#${item.number}`, title: item.title, status: item.state }
        : null;

    if (card) {
      await this.integrationMessages.post(channelContainer(sub.channelId), { ...base, parentId: card.messageId });
      if (unfurl) await this.integrationMessages.updateUnfurls(card.messageId, [unfurl]).catch(() => undefined);
      return;
    }
    // A CI failure for a PR we've never posted about: post it on its own.
    if (!unfurl) {
      await this.integrationMessages.post(channelContainer(sub.channelId), base);
      return;
    }
    const message = await this.integrationMessages.post(channelContainer(sub.channelId), { ...base, unfurls: [unfurl] });
    await this.prisma.githubCard
      .create({ data: { subscriptionId: sub.id, channelId: sub.channelId, kind: item.kind, number: item.number, messageId: message.id } })
      // Two deliveries racing for the same new PR: the card already exists; fine.
      .catch(() => undefined);
  }
}
