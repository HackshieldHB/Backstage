import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { JiraUnfurl } from '@backstages/shared';
import { PrismaService } from '../prisma/prisma.service';
import { PolicyService } from '../authz/policy.service';
import { AtlassianApiService } from './atlassian-api.service';
import { AtlassianService } from './atlassian.service';
import { IntegrationMessagesService, type UnfurlProvider } from '../messages/integration-messages.service';
import { channelContainer } from '../messages/messages.service';

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

/** Unfurling, `/jira PROJ-123`, and "create Jira issue from message". */
@Injectable()
export class JiraActionsService implements UnfurlProvider {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
    private readonly api: AtlassianApiService,
    private readonly atlassian: AtlassianService,
    private readonly integrationMessages: IntegrationMessagesService,
  ) {}

  // ---------- link unfurling (UnfurlProvider) ----------

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
}
