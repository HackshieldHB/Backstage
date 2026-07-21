import { Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'crypto';
import type { BitbucketSubscription } from '@prisma/client';
import type { JiraUnfurl } from '@backstages/shared';
import { PrismaService } from '../prisma/prisma.service';
import { IntegrationMessagesService } from '../messages/integration-messages.service';
import { channelContainer } from '../messages/messages.service';

/** Events we translate into chat. Mirrors the Jira subscription vocabulary. */
export type BitbucketEventType =
  | 'pr_created'
  | 'pr_updated'
  | 'pr_approved'
  | 'pr_merged'
  | 'pr_declined'
  | 'pr_comment';

export const BITBUCKET_EVENTS: BitbucketEventType[] = [
  'pr_created',
  'pr_updated',
  'pr_approved',
  'pr_merged',
  'pr_declined',
  'pr_comment',
];

/** The slice of Bitbucket's pull request webhook payload we rely on. */
export interface BitbucketWebhookBody {
  repository?: { full_name?: string };
  pullrequest?: {
    id?: number | string;
    title?: string;
    state?: string;
    links?: { html?: { href?: string } };
    author?: { display_name?: string };
    source?: { branch?: { name?: string } };
    destination?: { branch?: { name?: string } };
  };
  approval?: { user?: { display_name?: string } };
  comment?: { content?: { raw?: string }; user?: { display_name?: string } };
  actor?: { display_name?: string };
}

function doc(text: string, href?: string) {
  return {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'text', text, ...(href ? { marks: [{ type: 'link', attrs: { href } }] } : {}) }],
      },
    ],
  };
}

/**
 * Bitbucket pull request events → channel cards, reusing the Jira card model:
 * the first event for a PR posts a card, later ones thread under it so a busy
 * PR stays one entry in the channel.
 */
@Injectable()
export class BitbucketEventsService {
  private readonly logger = new Logger(BitbucketEventsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly integrationMessages: IntegrationMessagesService,
  ) {}

  async handleWebhook(
    subscriptionId: string,
    secret: string | undefined,
    eventKey: string | undefined,
    body: BitbucketWebhookBody,
  ) {
    const sub = await this.prisma.bitbucketSubscription.findUnique({
      where: { id: subscriptionId },
    });
    if (!sub) throw new NotFoundException('Unknown subscription');
    // Constant-time compare, and length-check first so the compare never throws
    // on mismatched buffer sizes.
    if (
      !secret ||
      secret.length !== sub.webhookSecret.length ||
      !timingSafeEqual(Buffer.from(secret), Buffer.from(sub.webhookSecret))
    ) {
      throw new UnauthorizedException('Invalid webhook secret');
    }

    const event = this.normalize(eventKey);
    if (!event) return { ok: true, handled: null as BitbucketEventType | null, posted: false };

    // The repo is pinned per subscription: a secret leaked from one repo's hook
    // must not let another repo post into that channel.
    const repo = body.repository?.full_name;
    if (repo && repo !== sub.repoFullName) {
      this.logger.warn(`Bitbucket payload for ${repo} sent to subscription for ${sub.repoFullName}`);
      return { ok: true, handled: event, posted: false };
    }

    if (!sub.events.includes(event)) return { ok: true, handled: event, posted: false };

    const prId = body.pullrequest?.id;
    if (prId === undefined || prId === null) return { ok: true, handled: event, posted: false };

    await this.postCard(sub, String(prId), event, body);
    return { ok: true, handled: event, posted: true };
  }

  private normalize(eventKey: string | undefined): BitbucketEventType | null {
    switch (eventKey) {
      case 'pullrequest:created':
        return 'pr_created';
      case 'pullrequest:updated':
        return 'pr_updated';
      case 'pullrequest:approved':
        return 'pr_approved';
      // Bitbucket calls a merge "fulfilled" and a decline "rejected".
      case 'pullrequest:fulfilled':
        return 'pr_merged';
      case 'pullrequest:rejected':
        return 'pr_declined';
      case 'pullrequest:comment_created':
        return 'pr_comment';
      default:
        return null;
    }
  }

  private describe(event: BitbucketEventType, body: BitbucketWebhookBody): string {
    const pr = body.pullrequest;
    const label = `PR #${pr?.id ?? '?'}`;
    const title = pr?.title ?? '';
    const actor = body.actor?.display_name ?? 'Someone';
    switch (event) {
      case 'pr_created': {
        const from = pr?.source?.branch?.name;
        const to = pr?.destination?.branch?.name;
        const branches = from && to ? ` (${from} → ${to})` : '';
        return `${label} opened by ${pr?.author?.display_name ?? actor}${branches}: ${title}`;
      }
      case 'pr_updated':
        return `${label} updated by ${actor}: ${title}`;
      case 'pr_approved':
        return `${label} approved by ${body.approval?.user?.display_name ?? actor}: ${title}`;
      case 'pr_merged':
        return `${label} merged: ${title}`;
      case 'pr_declined':
        return `${label} declined: ${title}`;
      case 'pr_comment': {
        const who = body.comment?.user?.display_name ?? actor;
        const text = (body.comment?.content?.raw ?? '').slice(0, 200);
        return `${who} commented on ${label}: ${text}`;
      }
    }
  }

  private async postCard(
    sub: BitbucketSubscription,
    prId: string,
    event: BitbucketEventType,
    body: BitbucketWebhookBody,
  ) {
    const text = this.describe(event, body);
    const url = body.pullrequest?.links?.html?.href;
    const unfurl: JiraUnfurl | undefined = url
      ? {
          type: 'bitbucket',
          url,
          key: `PR #${prId}`,
          title: body.pullrequest?.title ?? `Pull request ${prId}`,
          status: body.pullrequest?.state ?? undefined,
        }
      : undefined;

    const existing = await this.prisma.bitbucketPrCard.findUnique({
      where: { channelId_prId: { channelId: sub.channelId, prId } },
    });

    if (!existing) {
      const message = await this.integrationMessages.post(channelContainer(sub.channelId), {
        workspaceId: sub.workspaceId,
        contentText: text,
        contentJson: doc(text, url),
        unfurls: unfurl ? [unfurl] : undefined,
      });
      await this.prisma.bitbucketPrCard.create({
        data: {
          subscriptionId: sub.id,
          channelId: sub.channelId,
          prId,
          messageId: message.id,
        },
      });
    } else {
      await this.integrationMessages.post(channelContainer(sub.channelId), {
        workspaceId: sub.workspaceId,
        contentText: text,
        contentJson: doc(text, url),
        parentId: existing.messageId,
      });
      // Keep the top card's state badge current as the PR progresses.
      if (unfurl) {
        await this.integrationMessages
          .updateUnfurls(existing.messageId, [unfurl])
          .catch(() => undefined);
      }
    }
  }
}
