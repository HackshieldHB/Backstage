import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PolicyService } from '../authz/policy.service';
import { AtlassianService } from './atlassian.service';
import { AtlassianApiService, type JiraSearchRow } from './atlassian-api.service';
import { IntegrationMessagesService } from '../messages/integration-messages.service';
import { channelContainer } from '../messages/messages.service';

/** A single project's slice of a digest. */
interface ProjectDigest {
  projectKey: string;
  moved: JiraSearchRow[];
  overdue: JiraSearchRow[];
}

/**
 * Daily standup digest: for every channel subscribed to a Jira project, post
 * what moved since yesterday and what is past its due date.
 *
 * Both slices are deliberately expressed with fields every Jira site has
 * (`updated`, `duedate`, `statusCategory`). An earlier shape keyed off a
 * status literally named "Blocked", which only exists on some workflows and
 * silently returned nothing everywhere else.
 */
@Injectable()
export class StandupService {
  private readonly logger = new Logger(StandupService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
    private readonly atlassian: AtlassianService,
    private readonly api: AtlassianApiService,
    private readonly integrationMessages: IntegrationMessagesService,
  ) {}

  /** Posts a digest into every channel that subscribes to a Jira project. */
  async runAll(): Promise<{ posted: number }> {
    const subs = await this.prisma.channelJiraSubscription.findMany({
      include: { channel: { select: { id: true, workspaceId: true } } },
    });
    let posted = 0;
    for (const sub of subs) {
      try {
        const sent = await this.postForChannel(sub.channelId);
        if (sent) posted++;
      } catch (err) {
        // One broken connection must not stop the rest of the workspaces.
        this.logger.error(`Standup digest failed for channel ${sub.channelId}: ${String(err)}`);
      }
    }
    return { posted };
  }

  /** Manual trigger — same output as the scheduled run, for one channel. */
  async postForChannelAsUser(userId: string, channelId: string) {
    await this.policy.requireChannelMember(userId, channelId);
    const sent = await this.postForChannel(channelId);
    return { posted: sent };
  }

  private async postForChannel(channelId: string): Promise<boolean> {
    const subs = await this.prisma.channelJiraSubscription.findMany({
      where: { channelId },
      include: { channel: { select: { workspaceId: true } } },
    });
    if (subs.length === 0) return false;

    const workspaceId = subs[0].channel.workspaceId;
    const connection = await this.atlassian.connectionForWorkspace(workspaceId);
    const token = await this.atlassian.accessTokenFor(connection);

    const digests: ProjectDigest[] = [];
    for (const sub of subs) {
      const [moved, overdue] = await Promise.all([
        this.api.searchJql(
          token,
          connection.siteId,
          `project="${sub.projectKey}" AND updated >= -1d ORDER BY updated DESC`,
        ),
        this.api.searchJql(
          token,
          connection.siteId,
          `project="${sub.projectKey}" AND duedate < now() AND statusCategory != Done ORDER BY duedate ASC`,
        ),
      ]);
      if (moved.length > 0 || overdue.length > 0) {
        digests.push({ projectKey: sub.projectKey, moved, overdue });
      }
    }
    // A digest with nothing in it is noise — say nothing at all.
    if (digests.length === 0) return false;

    const { text, doc } = this.render(digests, connection.siteUrl);
    await this.integrationMessages.post(channelContainer(channelId), {
      workspaceId,
      contentText: text,
      contentJson: doc,
    });
    return true;
  }

  private render(digests: ProjectDigest[], siteUrl: string) {
    const lines: string[] = ['Standup digest'];
    const content: unknown[] = [
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'Standup digest', marks: [{ type: 'bold' }] }],
      },
    ];

    for (const d of digests) {
      const head = `${d.projectKey} — ${d.moved.length} updated since yesterday, ${d.overdue.length} overdue`;
      lines.push(head);
      content.push({
        type: 'paragraph',
        content: [{ type: 'text', text: head, marks: [{ type: 'bold' }] }],
      });

      const section = (label: string, rows: JiraSearchRow[]) => {
        if (rows.length === 0) return;
        // Keep the message readable when a project has a busy day.
        const shown = rows.slice(0, 10);
        for (const r of shown) {
          const line = `${label} ${r.key} · ${r.summary}${r.status ? ` — ${r.status}` : ''}`;
          lines.push(line);
          content.push({
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: line,
                marks: [{ type: 'link', attrs: { href: `${siteUrl}/browse/${r.key}` } }],
              },
            ],
          });
        }
        if (rows.length > shown.length) {
          const more = `…and ${rows.length - shown.length} more`;
          lines.push(more);
          content.push({ type: 'paragraph', content: [{ type: 'text', text: more }] });
        }
      };

      section('Moved:', d.moved);
      section('Overdue:', d.overdue);
    }

    return { text: lines.join('\n'), doc: { type: 'doc', content } };
  }
}
