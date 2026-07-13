import { BadRequestException, Injectable, NotFoundException, type OnModuleInit } from '@nestjs/common';
import type { AtlassianConnection, Message } from '@prisma/client';
import type { JiraActionInput, JiraAssignableUser, JiraTransition, JiraUnfurl } from '@backstages/shared';
import { PrismaService } from '../prisma/prisma.service';
import { PolicyService } from '../authz/policy.service';
import { AtlassianApiService } from './atlassian-api.service';
import { AtlassianService } from './atlassian.service';
import { IntegrationMessagesService } from '../messages/integration-messages.service';
import { channelContainer } from '../messages/messages.service';
import { AppRegistry, type IntegrationApp } from '../integrations/app-registry';

const ISSUE_KEY_RE = /^[A-Z][A-Z0-9]+-\d+$/;

function cardDoc(text: string, href: string) {
  return {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'text', text, marks: [{ type: 'link', attrs: { href } }] }],
      },
    ],
  };
}

/** The 'jira' integration app: unfurling, `/jira PROJ-123`, create-issue, and card actions. */
@Injectable()
export class JiraActionsService implements IntegrationApp, OnModuleInit {
  readonly id = 'jira';

  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
    private readonly api: AtlassianApiService,
    private readonly atlassian: AtlassianService,
    private readonly integrationMessages: IntegrationMessagesService,
    private readonly registry: AppRegistry,
  ) {}

  onModuleInit() {
    this.registry.register(this);
  }

  // ---------- link unfurling (IntegrationApp) ----------

  async unfurl(workspaceId: string, contentText: string): Promise<JiraUnfurl[] | null> {
    const connection = await this.prisma.atlassianConnection.findUnique({ where: { workspaceId } });
    if (!connection) return null;

    const site = connection.siteUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const issueRe = new RegExp(`${site}/browse/([A-Z][A-Z0-9]+-\\d+)`, 'g');
    const wikiRe = new RegExp(`${site}/wiki/[^\\s)>]+`, 'g');

    const unfurls: JiraUnfurl[] = [];
    const seen = new Set<string>();

    for (const match of contentText.matchAll(issueRe)) {
      const key = match[1];
      if (seen.has(key)) continue;
      seen.add(key);
      try {
        const token = await this.atlassian.accessTokenFor(connection);
        const issue = await this.api.getIssue(token, connection.siteId, key);
        if (issue) {
          unfurls.push({
            type: 'jira',
            url: `${connection.siteUrl}/browse/${key}`,
            key,
            title: issue.summary,
            status: issue.status,
            issueType: issue.issueType,
            priority: issue.priority,
            assigneeAccountId: issue.assigneeAccountId,
          });
        }
      } catch {
        // Skip unfurl on API failure — never break message delivery.
      }
      if (unfurls.length >= 5) break;
    }

    for (const match of contentText.matchAll(wikiRe)) {
      const url = match[0];
      if (seen.has(url) || unfurls.length >= 5) continue;
      seen.add(url);
      unfurls.push({ type: 'confluence', url, title: 'Confluence page' });
    }

    return unfurls.length > 0 ? unfurls : null;
  }

  // ---------- /jira PROJ-123 ----------

  async jiraCommand(userId: string, channelId: string, issueKey: string) {
    const { channel } = await this.policy.requireChannelMember(userId, channelId);
    if (!ISSUE_KEY_RE.test(issueKey)) throw new BadRequestException('Invalid issue key');
    const connection = await this.atlassian.connectionForWorkspace(channel.workspaceId);
    const token = await this.atlassian.accessTokenFor(connection);
    const issue = await this.api.getIssue(token, connection.siteId, issueKey);
    if (!issue) throw new NotFoundException(`Issue ${issueKey} not found`);

    const text = `${issue.key} · ${issue.summary} — ${issue.status}${issue.priority ? ` · ${issue.priority}` : ''}`;
    const url = `${connection.siteUrl}/browse/${issue.key}`;
    return this.integrationMessages.post(channelContainer(channelId), {
      workspaceId: channel.workspaceId,
      contentText: text,
      contentJson: cardDoc(text, url),
      unfurls: [
        {
          type: 'jira',
          url,
          key: issue.key,
          title: issue.summary,
          status: issue.status,
          issueType: issue.issueType,
          priority: issue.priority,
          assigneeAccountId: issue.assigneeAccountId,
        } satisfies JiraUnfurl,
      ],
    });
  }

  // ---------- create Jira issue from message ----------

  async createIssueFromMessage(
    userId: string,
    messageId: string,
    input: { projectKey: string; summary?: string },
  ) {
    const message = await this.prisma.message.findUnique({ where: { id: messageId } });
    if (!message || message.deletedAt || !message.channelId) {
      throw new NotFoundException('Message not found');
    }
    const { channel } = await this.policy.requireChannelMember(userId, message.channelId);
    const connection = await this.atlassian.connectionForWorkspace(channel.workspaceId);
    const token = await this.atlassian.accessTokenFor(connection);

    const summary = input.summary?.trim() || message.contentText.slice(0, 100);
    const created = await this.api.createIssue(token, connection.siteId, {
      projectKey: input.projectKey,
      summary,
      description: `From Backstages #${channel.name}: ${message.contentText.slice(0, 500)}`,
    });

    const url = `${connection.siteUrl}/browse/${created.key}`;
    const text = `Created ${created.key} from this message: ${summary}`;
    // Confirmation lands as a thread reply under the source message.
    await this.integrationMessages.post(channelContainer(message.channelId), {
      workspaceId: channel.workspaceId,
      contentText: text,
      contentJson: cardDoc(text, url),
      parentId: message.parentId ?? message.id,
    });
    return { key: created.key, url };
  }

  // ---------- interactive actions (Assign / Move / Comment) ----------

  /**
   * Loads a channel-posted message and asserts the caller may act on it AND
   * that `issueKey` really belongs to one of the message's own Jira unfurls
   * (prevents driving arbitrary issues through someone else's card).
   */
  private async loadActionable(userId: string, messageId: string, issueKey: string) {
    if (!ISSUE_KEY_RE.test(issueKey)) throw new BadRequestException('Invalid issue key');
    const message = await this.prisma.message.findUnique({ where: { id: messageId } });
    if (!message || message.deletedAt || !message.channelId) {
      throw new NotFoundException('Message not found');
    }
    const { channel } = await this.policy.requireChannelMember(userId, message.channelId);
    const unfurls = (message.unfurls as JiraUnfurl[] | null) ?? [];
    if (!unfurls.some((u) => u.type === 'jira' && u.key === issueKey)) {
      throw new BadRequestException('Issue is not attached to this message');
    }
    const connection = await this.atlassian.connectionForWorkspace(channel.workspaceId);
    return { message, channel, connection };
  }

  async listTransitions(
    userId: string,
    messageId: string,
    issueKey: string,
  ): Promise<JiraTransition[]> {
    const { connection } = await this.loadActionable(userId, messageId, issueKey);
    const token = await this.atlassian.accessTokenFor(connection);
    return this.api.getTransitions(token, connection.siteId, issueKey);
  }

  /** Workspace members that map to a Jira account — candidates for "Assign". */
  async listAssignable(
    userId: string,
    messageId: string,
    issueKey: string,
  ): Promise<JiraAssignableUser[]> {
    const { channel } = await this.loadActionable(userId, messageId, issueKey);
    const members = await this.prisma.workspaceMember.findMany({
      where: { workspaceId: channel.workspaceId, deactivatedAt: null },
      include: { user: { include: { atlassianLink: true } } },
      orderBy: { user: { displayName: 'asc' } },
    });
    return members
      .filter((m) => m.user.atlassianLink?.atlassianAccountId)
      .map((m) => ({
        userId: m.user.id,
        displayName: m.user.displayName,
        avatarUrl: m.user.avatarUrl,
        accountId: m.user.atlassianLink!.atlassianAccountId,
      }));
  }

  async performAction(userId: string, messageId: string, input: JiraActionInput) {
    const { message, channel, connection } = await this.loadActionable(
      userId,
      messageId,
      input.issueKey,
    );
    // Prefer the caller's personal token (correct Jira attribution); fall back
    // to the shared workspace connection when they haven't connected.
    const userToken = await this.atlassian.userAccessTokenFor(userId);
    const token = userToken ?? (await this.atlassian.accessTokenFor(connection));
    const { issueKey } = input;
    let summary = `updated ${issueKey}`;

    switch (input.action) {
      case 'assign_me': {
        const link = await this.prisma.atlassianAccountLink.findUnique({ where: { userId } });
        if (!link) {
          throw new BadRequestException('Hubungkan akun Atlassian kamu dulu untuk assign issue');
        }
        await this.api.assignIssue(token, connection.siteId, issueKey, link.atlassianAccountId);
        summary = `assigned ${issueKey} to themselves`;
        break;
      }
      case 'assign': {
        if (!input.assigneeAccountId) throw new BadRequestException('assigneeAccountId is required');
        await this.api.assignIssue(token, connection.siteId, issueKey, input.assigneeAccountId);
        const target = await this.prisma.atlassianAccountLink.findUnique({
          where: { atlassianAccountId: input.assigneeAccountId },
          include: { user: true },
        });
        summary = `assigned ${issueKey} to ${target?.user.displayName ?? 'a teammate'}`;
        break;
      }
      case 'transition': {
        if (!input.transitionId) throw new BadRequestException('transitionId is required');
        await this.api.transitionIssue(token, connection.siteId, issueKey, input.transitionId);
        summary = `moved ${issueKey}`;
        break;
      }
      case 'comment': {
        if (!input.text?.trim()) throw new BadRequestException('text is required');
        const author = await this.prisma.user.findUnique({ where: { id: userId } });
        const name = author?.displayName ?? 'Someone';
        await this.api.addComment(
          token,
          connection.siteId,
          issueKey,
          `${name} (via Backstages): ${input.text.trim()}`,
        );
        summary = `commented on ${issueKey}`;
        break;
      }
    }

    const refreshed = await this.refreshCardUnfurl(message, connection, token, issueKey);

    const url = `${connection.siteUrl}/browse/${issueKey}`;
    const statusSuffix = refreshed ? ` — ${refreshed.status}` : '';
    const text = `${summary}${statusSuffix}`;
    await this.integrationMessages.post(channelContainer(message.channelId!), {
      workspaceId: channel.workspaceId,
      contentText: text,
      contentJson: cardDoc(text, url),
      parentId: message.parentId ?? message.id,
    });

    return { ok: true, issueKey, status: refreshed?.status ?? null };
  }

  /**
   * Re-fetches the issue and rewrites the matching unfurl on the source
   * message in place, pushing MESSAGE_UPDATED so open cards refresh live.
   */
  private async refreshCardUnfurl(
    message: Message,
    connection: AtlassianConnection,
    token: string,
    issueKey: string,
  ): Promise<JiraUnfurl | null> {
    const issue = await this.api.getIssue(token, connection.siteId, issueKey);
    if (!issue) return null;
    const fresh: JiraUnfurl = {
      type: 'jira',
      url: `${connection.siteUrl}/browse/${issue.key}`,
      key: issue.key,
      title: issue.summary,
      status: issue.status,
      issueType: issue.issueType,
      priority: issue.priority,
      assigneeAccountId: issue.assigneeAccountId,
    };
    const unfurls = (message.unfurls as JiraUnfurl[] | null) ?? [];
    const next = unfurls.map((u) => (u.type === 'jira' && u.key === issueKey ? fresh : u));
    await this.integrationMessages.updateUnfurls(message.id, next);
    return fresh;
  }
}
