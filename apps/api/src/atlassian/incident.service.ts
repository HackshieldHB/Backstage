import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  AppRegistry,
  type IntegrationApp,
  type SlashCommand,
} from '../integrations/app-registry';
import type { DeclareIncidentInput, IncidentResult } from '@backstages/shared';
import { PrismaService } from '../prisma/prisma.service';
import { PolicyService } from '../authz/policy.service';
import { ChannelsService } from '../channels/channels.service';
import { AtlassianService } from './atlassian.service';
import { AtlassianApiService } from './atlassian-api.service';
import { ConfluenceApiService } from './confluence-api.service';
import { hasGranularConfluence } from './scopes';
import { IntegrationMessagesService } from '../messages/integration-messages.service';
import { channelContainer } from '../messages/messages.service';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Turns a title into a valid channel name: lowercase, dashes, no leading digit
 * problems. ChannelNameSchema allows [a-z0-9][a-z0-9-_]*.
 */
function incidentChannelName(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
  // A title of only punctuation would slug to nothing.
  return `inc-${slug || 'incident'}`;
}

/** Skeleton the responders fill in — an empty page never gets written up. */
function postmortemBody(input: {
  title: string;
  severity: string;
  issueKey: string;
  issueUrl: string;
  channelName: string;
}): string {
  return (
    `<p><strong>Severity:</strong> ${esc(input.severity.toUpperCase())} · ` +
    `<strong>Tracking issue:</strong> <a href="${esc(input.issueUrl)}">${esc(input.issueKey)}</a> · ` +
    `<strong>Channel:</strong> #${esc(input.channelName)}</p>` +
    `<h2>Summary</h2><p></p>` +
    `<h2>Impact</h2><p></p>` +
    `<h2>Timeline</h2><p></p>` +
    `<h2>Root cause</h2><p></p>` +
    `<h2>Action items</h2><p></p>`
  );
}

/**
 * The incident flow: one command creates the coordination channel, the tracking
 * Jira issue, and the postmortem page, each linking to the others.
 *
 * Ordering matters. The channel and issue are the parts responders need during
 * an incident, so they are created first and a Confluence failure is reported
 * as a warning rather than rolling everything back — losing a live incident
 * channel because the wiki was down would be the worse outcome.
 */
@Injectable()
export class IncidentService implements IntegrationApp, OnModuleInit {
  readonly id = 'incident';
  private readonly logger = new Logger(IncidentService.name);

  constructor(
    private readonly registry: AppRegistry,
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
    private readonly channels: ChannelsService,
    private readonly atlassian: AtlassianService,
    private readonly api: AtlassianApiService,
    private readonly confluenceApi: ConfluenceApiService,
    private readonly integrationMessages: IntegrationMessagesService,
  ) {}

  onModuleInit() {
    this.registry.register(this);
  }

  commands(): SlashCommand[] {
    return [
      {
        name: 'incident',
        usage: '/incident <title>',
        description: 'Spin up an incident channel, tracking issue and postmortem',
        dialog: 'incident',
      },
    ];
  }

  async declare(
    userId: string,
    workspaceId: string,
    input: DeclareIncidentInput,
  ): Promise<IncidentResult> {
    await this.policy.requireWorkspaceMember(userId, workspaceId);
    const connection = await this.atlassian.connectionForWorkspace(workspaceId);
    const warnings: string[] = [];

    const channel = await this.channels.create(userId, workspaceId, {
      name: await this.uniqueChannelName(workspaceId, incidentChannelName(input.title)),
      topic: `${input.severity.toUpperCase()}: ${input.title}`.slice(0, 250),
      isPrivate: false,
      groupKey: 'jira',
    });

    const userToken = await this.atlassian.userAccessTokenFor(userId);
    const token = userToken ?? (await this.atlassian.accessTokenFor(connection));
    const link = await this.prisma.atlassianAccountLink.findUnique({ where: { userId } });

    const issue = await this.api.createIssue(token, connection.siteId, {
      projectKey: input.projectKey,
      summary: `[${input.severity.toUpperCase()}] ${input.title}`,
      description: `Incident declared from Backstages #${channel.name}.`,
      reporterAccountId: link?.atlassianAccountId,
    });
    const issueUrl = `${connection.siteUrl}/browse/${issue.key}`;

    let pageId: string | null = null;
    let pageUrl: string | null = null;
    if (input.spaceKey) {
      if (!hasGranularConfluence(connection.scopes)) {
        warnings.push(
          'Postmortem page skipped: the Atlassian connection is missing Confluence access.',
        );
      } else {
        try {
          const page = await this.confluenceApi.createPage(token, connection.siteId, {
            spaceKey: input.spaceKey,
            title: `Postmortem: ${input.title}`,
            body: postmortemBody({
              title: input.title,
              severity: input.severity,
              issueKey: issue.key,
              issueUrl,
              channelName: channel.name,
            }),
          });
          pageId = page.id;
          pageUrl = page.webui
            ? `${connection.siteUrl}/wiki${page.webui}`
            : `${connection.siteUrl}/wiki/pages/viewpage.action?pageId=${page.id}`;
        } catch (err) {
          // The channel and issue already exist and are what responders need.
          this.logger.error(`Postmortem page failed for ${issue.key}: ${String(err)}`);
          warnings.push('Postmortem page could not be created.');
        }
      }
    }

    await this.postKickoff(channel.id, workspaceId, {
      title: input.title,
      severity: input.severity,
      issueKey: issue.key,
      issueUrl,
      pageUrl,
    });

    return {
      channelId: channel.id,
      channelName: channel.name,
      issueKey: issue.key,
      issueUrl,
      pageId,
      pageUrl,
      warnings,
    };
  }

  /** Appends -2, -3, … when a same-named incident channel already exists. */
  private async uniqueChannelName(workspaceId: string, base: string): Promise<string> {
    for (let n = 1; n < 50; n++) {
      const name = n === 1 ? base : `${base}-${n}`;
      const clash = await this.prisma.channel.findUnique({
        where: { workspaceId_name: { workspaceId, name } },
      });
      if (!clash) return name;
    }
    return `${base}-${Date.now()}`;
  }

  private async postKickoff(
    channelId: string,
    workspaceId: string,
    info: {
      title: string;
      severity: string;
      issueKey: string;
      issueUrl: string;
      pageUrl: string | null;
    },
  ) {
    const lines = [
      `${info.severity.toUpperCase()} incident: ${info.title}`,
      `Tracking: ${info.issueKey}`,
      ...(info.pageUrl ? ['Postmortem: draft page created'] : []),
    ];
    await this.integrationMessages.post(channelContainer(channelId), {
      workspaceId,
      contentText: lines.join('\n'),
      contentJson: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: lines[0], marks: [{ type: 'bold' }] }],
          },
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: `Tracking: ${info.issueKey}`,
                marks: [{ type: 'link', attrs: { href: info.issueUrl } }],
              },
            ],
          },
          ...(info.pageUrl
            ? [
                {
                  type: 'paragraph',
                  content: [
                    {
                      type: 'text',
                      text: 'Postmortem draft',
                      marks: [{ type: 'link', attrs: { href: info.pageUrl } }],
                    },
                  ],
                },
              ]
            : []),
        ],
      },
      unfurls: [
        { type: 'jira', url: info.issueUrl, key: info.issueKey, title: info.title },
        ...(info.pageUrl
          ? [{ type: 'confluence', url: info.pageUrl, title: `Postmortem: ${info.title}` }]
          : []),
      ],
    });
  }
}
