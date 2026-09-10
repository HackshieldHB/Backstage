import { BadGatewayException, Injectable, Logger, NotFoundException } from '@nestjs/common';

export interface ConfluenceSpaceRaw {
  key: string;
  name: string;
  id: string;
}

export interface ConfluencePageRaw {
  id: string;
  title: string;
  version: number;
  /** Relative web UI path under /wiki, if returned. */
  webui: string | null;
}

export interface ConfluencePageWithBody extends ConfluencePageRaw {
  body: string;
}

/** Confluence Cloud REST API **v2** page shape (the v1 `/wiki/rest/api` family
 * was removed and now returns 410 Gone). */
interface RawPageV2 {
  id: string;
  title: string;
  version?: { number: number };
  body?: { storage?: { value?: string } };
  _links?: { webui?: string };
}

interface RawSpaceV2 {
  id: string | number;
  key: string;
  name: string;
}

/**
 * Thin HTTP client for the Confluence Cloud REST API **v2**. Kept behind one
 * injectable so integration tests can substitute a mock without touching
 * business logic.
 *
 * v2 addresses pages/spaces by numeric id (not spaceKey), so key-based calls
 * resolve the id first via the spaces filter.
 */
@Injectable()
export class ConfluenceApiService {
  private readonly logger = new Logger(ConfluenceApiService.name);

  private base(cloudId: string): string {
    return `https://api.atlassian.com/ex/confluence/${cloudId}/wiki/api/v2`;
  }

  private async req<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    url: string,
    token: string,
    body?: unknown,
  ): Promise<T | null> {
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (res.status === 404) return null;
    if (res.status === 204) return null;
    if (!res.ok) {
      this.logger.warn(`Confluence ${method} ${url} -> ${res.status}`);
      throw new BadGatewayException('Confluence API request failed');
    }
    const text = await res.text();
    return (text ? JSON.parse(text) : null) as T;
  }

  private toPage(p: RawPageV2, fallbackVersion = 1): ConfluencePageRaw {
    return {
      id: p.id,
      title: p.title,
      version: p.version?.number ?? fallbackVersion,
      webui: p._links?.webui ?? null,
    };
  }

  async listSpaces(token: string, cloudId: string): Promise<ConfluenceSpaceRaw[]> {
    const json = await this.req<{ results?: RawSpaceV2[] }>(
      'GET',
      `${this.base(cloudId)}/spaces?limit=100`,
      token,
    );
    return (json?.results ?? []).map((s) => ({ key: s.key, name: s.name, id: String(s.id) }));
  }

  /** Most-recently-modified pages across the whole site — for the dashboard feed. */
  async recentPages(
    token: string,
    cloudId: string,
    limit = 8,
  ): Promise<Array<{ id: string; title: string; webui: string | null; updatedAt: string | null }>> {
    const json = await this.req<{
      results?: Array<RawPageV2 & { version?: { number: number; createdAt?: string } }>;
    }>('GET', `${this.base(cloudId)}/pages?sort=-modified-date&limit=${limit}`, token);
    return (json?.results ?? []).map((p) => ({
      id: p.id,
      title: p.title,
      webui: p._links?.webui ?? null,
      updatedAt: p.version?.createdAt ?? null,
    }));
  }

  /** v2 keys everything by numeric space id — resolve it from the human key. */
  private async spaceIdForKey(token: string, cloudId: string, spaceKey: string): Promise<string | null> {
    const json = await this.req<{ results?: RawSpaceV2[] }>(
      'GET',
      `${this.base(cloudId)}/spaces?keys=${encodeURIComponent(spaceKey)}&limit=1`,
      token,
    );
    const space = json?.results?.[0];
    return space ? String(space.id) : null;
  }

  async listPages(token: string, cloudId: string, spaceKey: string): Promise<ConfluencePageRaw[]> {
    const spaceId = await this.spaceIdForKey(token, cloudId, spaceKey);
    if (!spaceId) return [];
    const json = await this.req<{ results?: RawPageV2[] }>(
      'GET',
      `${this.base(cloudId)}/spaces/${spaceId}/pages?limit=50`,
      token,
    );
    return (json?.results ?? []).map((p) => this.toPage(p));
  }

  async getPage(token: string, cloudId: string, pageId: string): Promise<ConfluencePageWithBody | null> {
    const json = await this.req<RawPageV2>(
      'GET',
      `${this.base(cloudId)}/pages/${encodeURIComponent(pageId)}?body-format=storage`,
      token,
    );
    if (!json) return null;
    return { ...this.toPage(json), body: json.body?.storage?.value ?? '' };
  }

  /**
   * Title/version only — no `body-format`, so Confluence skips rendering the
   * body. Used by link unfurling, where a page's contents are never shown.
   */
  async getPageSummary(token: string, cloudId: string, pageId: string): Promise<ConfluencePageRaw | null> {
    const json = await this.req<RawPageV2>(
      'GET',
      `${this.base(cloudId)}/pages/${encodeURIComponent(pageId)}`,
      token,
    );
    return json ? this.toPage(json) : null;
  }

  async createPage(
    token: string,
    cloudId: string,
    input: { spaceKey: string; title: string; body: string },
  ): Promise<ConfluencePageRaw> {
    const spaceId = await this.spaceIdForKey(token, cloudId, input.spaceKey);
    if (!spaceId) throw new BadGatewayException('Confluence space not found');
    const json = await this.req<RawPageV2>('POST', `${this.base(cloudId)}/pages`, token, {
      spaceId,
      status: 'current',
      title: input.title,
      body: { representation: 'storage', value: input.body },
    });
    if (!json) throw new BadGatewayException('Failed to create Confluence page');
    return this.toPage(json);
  }

  async updatePage(
    token: string,
    cloudId: string,
    pageId: string,
    input: { title: string; body: string; version: number },
  ): Promise<ConfluencePageRaw> {
    const json = await this.req<RawPageV2>('PUT', `${this.base(cloudId)}/pages/${encodeURIComponent(pageId)}`, token, {
      id: pageId,
      status: 'current',
      title: input.title,
      body: { representation: 'storage', value: input.body },
      version: { number: input.version + 1 },
    });
    if (!json) throw new NotFoundException('Confluence page not found');
    return this.toPage(json, input.version + 1);
  }

  async deletePage(token: string, cloudId: string, pageId: string): Promise<void> {
    await this.req('DELETE', `${this.base(cloudId)}/pages/${encodeURIComponent(pageId)}`, token);
  }
}
