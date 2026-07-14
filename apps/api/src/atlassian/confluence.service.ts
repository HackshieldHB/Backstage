import { Injectable, NotFoundException } from '@nestjs/common';
import type { AtlassianConnection } from '@prisma/client';
import type {
  ConfluencePage,
  ConfluenceSpace,
  CreatePageInput,
  UpdatePageInput,
} from '@backstages/shared';
import { PolicyService } from '../authz/policy.service';
import { AtlassianService } from './atlassian.service';
import { ConfluenceApiService, type ConfluencePageRaw } from './confluence-api.service';

/** Wraps plain user text into Confluence storage-format XHTML. */
function toStorage(text: string): string {
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const paras = text
    .split(/\n{2,}/)
    .map((p) => `<p>${esc(p).replace(/\n/g, '<br/>')}</p>`)
    .join('');
  return paras || '<p></p>';
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
  ) {}

  private async ctx(userId: string, workspaceId: string) {
    await this.policy.requireWorkspaceMember(userId, workspaceId);
    const connection = await this.atlassian.connectionForWorkspace(workspaceId);
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
    return this.toDto(connection, page);
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
    return {
      id: p.id,
      title: p.title,
      version: p.version,
      url: p.webui ? `${connection.siteUrl}/wiki${p.webui}` : null,
    };
  }
}
