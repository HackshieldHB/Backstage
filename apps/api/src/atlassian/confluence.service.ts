import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { AtlassianConnection } from '@prisma/client';
import type {
  ConfluencePage,
  ConfluenceSpace,
  CreatePageFromThreadInput,
  CreatePageInput,
  UpdatePageInput,
} from '@backstages/shared';
import { PolicyService } from '../authz/policy.service';
import { AtlassianService } from './atlassian.service';
import { ConfluenceApiService, type ConfluencePageRaw } from './confluence-api.service';
import { hasGranularConfluence } from './scopes';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { IntegrationMessagesService } from '../messages/integration-messages.service';
import { channelContainer } from '../messages/messages.service';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Wraps plain user text into Confluence storage-format XHTML. */
function toStorage(text: string): string {
  const paras = text
    .split(/\n{2,}/)
    .map((p) => `<p>${esc(p).replace(/\n/g, '<br/>')}</p>`)
    .join('');
  return paras || '<p></p>';
}

/** One captured thread message: who said it, when, and what. */
interface ThreadEntry {
  author: string;
  at: Date;
  text: string;
}

/**
 * Renders a thread as a Confluence decision log: a provenance line back to the
 * channel, the participant list, then every message in order. Storage format is
 * XHTML, so every piece of user text goes through esc().
 */
function threadToStorage(input: {
  channelName: string;
  threadUrl: string;
  entries: ThreadEntry[];
}): string {
  const participants = [...new Set(input.entries.map((e) => e.author))];
  const when = input.entries[0]?.at ?? new Date();
  const fmt = (d: Date) => d.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';

  const header =
    `<p>Captured from the Backstages thread in ` +
    `<a href="${esc(input.threadUrl)}">#${esc(input.channelName)}</a>` +
    ` — started ${esc(fmt(when))}.</p>` +
    `<p><strong>Participants:</strong> ${esc(participants.join(', '))}</p>`;

  const body = input.entries
    .map(
      (e) =>
        `<p><strong>${esc(e.author)}</strong> <em>${esc(fmt(e.at))}</em><br/>` +
        `${esc(e.text).replace(/\n/g, '<br/>')}</p>`,
    )
    .join('');

  return `${header}<h2>Discussion</h2>${body}`;
}

/** Best-effort inverse of toStorage for the edit form. */
function storageToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>\s*<p>/gi, '\n\n')
    .replace(/<\/?p>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .trim();
}

/** Create/read/update/delete Confluence pages for a connected workspace. */
@Injectable()
export class ConfluenceService {
  constructor(
    private readonly policy: PolicyService,
    private readonly atlassian: AtlassianService,
    private readonly api: ConfluenceApiService,
    private readonly notifications: NotificationsService,
    private readonly prisma: PrismaService,
    private readonly integrationMessages: IntegrationMessagesService,
  ) {}

  private async ctx(userId: string, workspaceId: string) {
    await this.policy.requireWorkspaceMember(userId, workspaceId);
    const connection = await this.atlassian.connectionForWorkspace(workspaceId);
    // The v2 Confluence API requires GRANULAR scopes (…:confluence). Classic
    // read:confluence-* scopes only worked with the now-removed v1 API and yield
    // an opaque 401 — require a granular scope and surface an actionable message.
    if (!hasGranularConfluence(connection.scopes)) {
      throw new ForbiddenException(
        'This Atlassian connection is missing Confluence access. A workspace admin needs to reconnect Atlassian (Workspace menu → Connect Atlassian) to grant Confluence permissions.',
      );
    }
    const token = await this.atlassian.accessTokenFor(connection);
    return { connection, token };
  }

  async listSpaces(userId: string, workspaceId: string): Promise<ConfluenceSpace[]> {
    const { connection, token } = await this.ctx(userId, workspaceId);
    return this.api.listSpaces(token, connection.siteId);
  }

  async listPages(userId: string, workspaceId: string, spaceKey: string): Promise<ConfluencePage[]> {
    const { connection, token } = await this.ctx(userId, workspaceId);
    const pages = await this.api.listPages(token, connection.siteId, spaceKey);
    return pages.map((p) => this.toDto(connection, p));
  }

  async getPage(
    userId: string,
    workspaceId: string,
    pageId: string,
  ): Promise<ConfluencePage & { body: string }> {
    const { connection, token } = await this.ctx(userId, workspaceId);
    const page = await this.api.getPage(token, connection.siteId, pageId);
    if (!page) throw new NotFoundException('Confluence page not found');
    return { ...this.toDto(connection, page), body: storageToText(page.body) };
  }

  async createPage(userId: string, workspaceId: string, input: CreatePageInput): Promise<ConfluencePage> {
    const { connection, token } = await this.ctx(userId, workspaceId);
    const page = await this.api.createPage(token, connection.siteId, {
      spaceKey: input.spaceKey,
      title: input.title,
      body: toStorage(input.body),
    });
    const dto = this.toDto(connection, page);
    await this.notifications.notify({
      userId,
      type: 'SYSTEM',
      payload: {
        source: 'confluence',
        action: 'created',
        title: dto.title,
        spaceKey: input.spaceKey,
        url: dto.url,
      },
    });
    return dto;
  }

  /**
   * Captures a channel thread as a Confluence page — the decision log flow.
   * Works from any message in the thread (the root is resolved first) and posts
   * the resulting link back into that same thread.
   */
  async createPageFromThread(
    userId: string,
    messageId: string,
    input: CreatePageFromThreadInput,
  ): Promise<ConfluencePage> {
    const message = await this.prisma.message.findUnique({ where: { id: messageId } });
    if (!message || message.deletedAt || !message.channelId) {
      throw new NotFoundException('Message not found');
    }
    const { channel } = await this.policy.requireChannelMember(userId, message.channelId);

    // Capture the whole thread regardless of which message was clicked.
    const rootId = message.parentId ?? message.id;
    const rows = await this.prisma.message.findMany({
      where: { OR: [{ id: rootId }, { parentId: rootId }], deletedAt: null },
      include: { user: { select: { displayName: true } } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    if (rows.length === 0) throw new NotFoundException('Thread not found');

    const entries: ThreadEntry[] = rows.map((r) => ({
      // Integration posts (Jira cards, bots) carry no user row.
      author: r.user?.displayName ?? 'Backstages',
      at: r.createdAt,
      text: r.contentText,
    }));

    const web = process.env.WEB_ORIGIN ?? 'http://localhost:3000';
    const threadUrl = `${web}/app?channel=${message.channelId}&thread=${rootId}`;
    const title = input.title?.trim() || entries[0].text.slice(0, 120) || `Thread in #${channel.name}`;

    const { connection, token } = await this.ctx(userId, channel.workspaceId);
    const page = await this.api.createPage(token, connection.siteId, {
      spaceKey: input.spaceKey,
      title,
      body: threadToStorage({ channelName: channel.name, threadUrl, entries }),
    });
    const dto = this.toDto(connection, page);

    const text = `Saved this thread to Confluence: ${title}`;
    await this.integrationMessages.post(channelContainer(message.channelId), {
      workspaceId: channel.workspaceId,
      contentText: text,
      contentJson: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text, ...(dto.url ? { marks: [{ type: 'link', attrs: { href: dto.url } }] } : {}) },
            ],
          },
        ],
      },
      parentId: rootId,
      ...(dto.url ? { unfurls: [{ type: 'confluence', url: dto.url, title }] } : {}),
    });

    await this.notifications.notify({
      userId,
      type: 'SYSTEM',
      payload: {
        source: 'confluence',
        action: 'created',
        title,
        spaceKey: input.spaceKey,
        url: dto.url,
      },
    });
    return dto;
  }

  async updatePage(
    userId: string,
    workspaceId: string,
    pageId: string,
    input: UpdatePageInput,
  ): Promise<ConfluencePage> {
    const { connection, token } = await this.ctx(userId, workspaceId);
    const page = await this.api.updatePage(token, connection.siteId, pageId, {
      title: input.title,
      body: toStorage(input.body),
      version: input.version,
    });
    return this.toDto(connection, page);
  }

  async deletePage(userId: string, workspaceId: string, pageId: string) {
    const { connection, token } = await this.ctx(userId, workspaceId);
    await this.api.deletePage(token, connection.siteId, pageId);
    return { ok: true };
  }

  private toDto(connection: AtlassianConnection, p: ConfluencePageRaw): ConfluencePage {
    // v2 list responses sometimes omit _links.webui — fall back to the stable
    // pageId view URL so a page is always openable.
    const url = p.webui
      ? `${connection.siteUrl}/wiki${p.webui}`
      : `${connection.siteUrl}/wiki/pages/viewpage.action?pageId=${p.id}`;
    return { id: p.id, title: p.title, version: p.version, url };
  }
}
