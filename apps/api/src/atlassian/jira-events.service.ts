import { Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'crypto';
import { SOCKET_EVENTS } from '@backstages/shared';
import type { AtlassianConnection } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { UnreadService } from '../messages/unread.service';
import {
  IntegrationMessagesService,
} from '../messages/integration-messages.service';
import { channelContainer, conversationContainer } from '../messages/messages.service';

/** Normalized Jira webhook event. */
export type JiraEventType = 'issue_created' | 'issue_assigned' | 'status_changed' | 'comment_created';

export interface JiraWebhookBody {
  webhookEvent: string;
  issue?: {
    key: string;
    fields?: {
      summary?: string;
      status?: { name: string };
      project?: { key: string };
      assignee?: { accountId: string; displayName?: string } | null;
    };
  };
  changelog?: { items?: Array<{ field: string; fromString?: string | null; toString?: string | null; to?: string | null }> };
  comment?: { body?: unknown; author?: { accountId: string; displayName?: string } };
}

function doc(text: string, href?: string) {
  return {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: href
          ? [{ type: 'text', text, marks: [{ type: 'link', attrs: { href } }] }]
          : [{ type: 'text', text }],
      },
    ],
  };
}

function adfToText(body: unknown): string {
  if (typeof body === 'string') return body;
  const parts: string[] = [];
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(walk);
    const rec = node as Record<string, unknown>;
    if (typeof rec.text === 'string') parts.push(rec.text);
    if (rec.content) walk(rec.content);
  };
  walk(body);
  return parts.join(' ').trim();
}

@Injectable()
export class JiraEventsService {
  private readonly logger = new Logger(JiraEventsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly integrationMessages: IntegrationMessagesService,
    private readonly realtime: RealtimeService,
    private readonly unread: UnreadService,
  ) {}

  async handleWebhook(connectionId: string, secret: string | undefined, body: JiraWebhookBody) {
    const connection = await this.prisma.atlassianConnection.findUnique({
      where: { id: connectionId },
    });
    if (!connection) throw new NotFoundException('Unknown connection');
    if (
      !secret ||
      secret.length !== connection.webhookSecret.length ||
      !timingSafeEqual(Buffer.from(secret), Buffer.from(connection.webhookSecret))
    ) {
      throw new UnauthorizedException('Invalid webhook secret');
    }

    const events = this.normalize(body);
    const results: Array<{ event: JiraEventType; dm: boolean; cards: number }> = [];
    for (const event of events) {
      results.push(await this.dispatch(connection, event, body));
    }
    return { ok: true, handled: results };
  }

  private normalize(body: JiraWebhookBody): JiraEventType[] {
    const events: JiraEventType[] = [];
    if (body.webhookEvent === 'jira:issue_created') events.push('issue_created');
    if (body.webhookEvent === 'comment_created') events.push('comment_created');
    if (body.webhookEvent === 'jira:issue_updated') {
      for (const item of body.changelog?.items ?? []) {
        if (item.field === 'assignee' && item.to) events.push('issue_assigned');
        if (item.field === 'status') events.push('status_changed');
      }
    }
    return events;
  }

  private describe(event: JiraEventType, body: JiraWebhookBody): string {
    const key = body.issue?.key ?? '???';
    const summary = body.issue?.fields?.summary ?? '';
    const status = body.issue?.fields?.status?.name;
    switch (event) {
      case 'issue_created':
        return `${key} created: ${summary}`;
      case 'issue_assigned': {
        const assignee = body.issue?.fields?.assignee?.displayName ?? 'someone';
        return `${key} assigned to ${assignee}: ${summary}`;
      }
      case 'status_changed': {
        const change = body.changelog?.items?.find((i) => i.field === 'status');
        return `${key} moved ${change?.fromString ?? '?'} → ${change?.toString ?? status ?? '?'}: ${summary}`;
      }
      case 'comment_created': {
        const author = body.comment?.author?.displayName ?? 'Someone';
        const text = adfToText(body.comment?.body).slice(0, 200);
        return `${author} commented on ${key}: ${text}`;
      }
    }
  }

  private async dispatch(
    connection: AtlassianConnection,
    event: JiraEventType,
    body: JiraWebhookBody,
  ) {
    const issueKey = body.issue?.key;
    const projectKey = body.issue?.fields?.project?.key ?? issueKey?.split('-')[0];
    const text = this.describe(event, body);
    const issueUrl = issueKey ? `${connection.siteUrl}/browse/${issueKey}` : undefined;

    // 1) Personal DM for assignment events.
    let dmUserId: string | null = null;
    if (event === 'issue_assigned') {
      const accountId =
        body.issue?.fields?.assignee?.accountId ??
        body.changelog?.items?.find((i) => i.field === 'assignee')?.to ??
        null;
      if (accountId) {
        const link = await this.prisma.atlassianAccountLink.findUnique({
          where: { atlassianAccountId: String(accountId) },
        });
        if (link) {
          dmUserId = link.userId;
          await this.sendJiraDm(connection, link.userId, text, issueUrl, issueKey);
        }
      }
    }

    // 2) Cards in subscribed channels.
    let cards = 0;
    if (issueKey && projectKey) {
      const subscriptions = await this.prisma.channelJiraSubscription.findMany({
        where: { connectionId: connection.id, projectKey, events: { has: event } },
      });
      for (const sub of subscriptions) {
        await this.postChannelCard(connection, sub.channelId, issueKey, text, issueUrl, dmUserId);
        cards++;
      }
    }

    return { event, dm: dmUserId !== null, cards };
  }

  /** Personal "Jira" inbox conversation (single-member, integration-titled). */
  private async sendJiraDm(
    connection: AtlassianConnection,
    userId: string,
    text: string,
    issueUrl: string | undefined,
    issueKey: string | undefined,
  ) {
    const memberKey = `jira:${userId}`;
    const conversation = await this.prisma.conversation.upsert({
      where: { workspaceId_memberKey: { workspaceId: connection.workspaceId, memberKey } },
      create: {
        workspaceId: connection.workspaceId,
        memberKey,
        title: 'Jira',
        members: { create: [{ userId }] },
      },
      update: {},
    });
    // Make sure the user's open sockets receive events for this conversation.
    await this.realtime
      .subscribeUserToRoom(userId, `conversation:${conversation.id}`)
      .catch(() => undefined);

    await this.integrationMessages.post(conversationContainer(conversation.id), {
      workspaceId: connection.workspaceId,
      contentText: text,
      contentJson: doc(text, issueUrl),
    });

    const notification = await this.prisma.notification.create({
      data: {
        userId,
        type: 'SYSTEM',
        conversationId: conversation.id,
        payload: { source: 'jira', issueKey: issueKey ?? null },
      },
    });
    this.realtime.emitToUser(userId, SOCKET_EVENTS.NOTIFICATION_NEW, {
      id: notification.id,
      type: notification.type,
      actor: null,
      messageId: null,
      channelId: null,
      conversationId: conversation.id,
      payload: notification.payload,
      createdAt: notification.createdAt.toISOString(),
    });
  }

  /**
   * Posts the event into a subscribed channel. The FIRST event for an issue
   * creates a card; follow-ups thread under that card. A user who already got
   * a personal DM for this event must not gain a badge from the card (dedup).
   */
  private async postChannelCard(
    connection: AtlassianConnection,
    channelId: string,
    issueKey: string,
    text: string,
    issueUrl: string | undefined,
    dmUserId: string | null,
  ) {
    const existing = await this.prisma.jiraIssueCard.findUnique({
      where: { channelId_issueKey: { channelId, issueKey } },
    });

    if (!existing) {
      const message = await this.integrationMessages.post(channelContainer(channelId), {
        workspaceId: connection.workspaceId,
        contentText: text,
        contentJson: doc(text, issueUrl),
        suppressUnreadFor: dmUserId ? [dmUserId] : [],
      });
      await this.prisma.jiraIssueCard.create({
        data: { connectionId: connection.id, channelId, issueKey, messageId: message.id },
      });
    } else {
      await this.integrationMessages.post(channelContainer(channelId), {
        workspaceId: connection.workspaceId,
        contentText: text,
        contentJson: doc(text, issueUrl),
        parentId: existing.messageId,
        suppressUnreadFor: dmUserId ? [dmUserId] : [],
      });
    }
  }
}
