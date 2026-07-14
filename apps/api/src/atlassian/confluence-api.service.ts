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

interface RawPage {
  id: string;
  title: string;
  version?: { number: number };
  body?: { storage?: { value?: string } };
  _links?: { webui?: string };
}

/**
 * Thin HTTP client for the Confluence Cloud REST API. Kept behind one injectable
 * so integration tests can substitute a mock without touching business logic.
 */
@Injectable()
export class ConfluenceApiService {
  private readonly logger = new Logger(ConfluenceApiService.name);

  private base(cloudId: string): string {
    return `https://api.atlassian.com/ex/confluence/${cloudId}/wiki/rest/api`;
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

  private toPage(p: RawPage, fallbackVersion = 1): ConfluencePageRaw {
    return {
      id: p.id,
      title: p.title,
      version: p.version?.number ?? fallbackVersion,
      webui: p._links?.webui ?? null,
    };
  }

  async listSpaces(token: string, cloudId: string): Promise<ConfluenceSpaceRaw[]> {
    const json = await this.req<{ results?: Array<{ key: string; name: string; id: string | number }> }>(
      'GET',
      `${this.base(cloudId)}/space?limit=100`,
      token,
    );
    return (json?.results ?? []).map((s) => ({ key: s.key, name: s.name, id: String(s.id) }));
  }

  async listPages(token: string, cloudId: string, spaceKey: string): Promise<ConfluencePageRaw[]> {
    const json = await this.req<{ results?: RawPage[] }>(
      'GET',
      `${this.base(cloudId)}/content?spaceKey=${encodeURIComponent(spaceKey)}&type=page&limit=50&expand=version`,
      token,
    );
    return (json?.results ?? []).map((p) => this.toPage(p));
  }

  async getPage(token: string, cloudId: string, pageId: string): Promise<ConfluencePageWithBody | null> {
    const json = await this.req<RawPage>(
      'GET',
      `${this.base(cloudId)}/content/${encodeURIComponent(pageId)}?expand=body.storage,version`,
      token,
    );
    if (!json) return null;
    return { ...this.toPage(json), body: json.body?.storage?.value ?? '' };
  }

  async createPage(
    token: string,
    cloudId: string,
    input: { spaceKey: string; title: string; body: string },
  ): Promise<ConfluencePageRaw> {
    const json = await this.req<RawPage>('POST', `${this.base(cloudId)}/content`, token, {
      type: 'page',
      title: input.title,
      space: { key: input.spaceKey },
      body: { storage: { value: input.body, representation: 'storage' } },
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
    const json = await this.req<RawPage>('PUT', `${this.base(cloudId)}/content/${encodeURIComponent(pageId)}`, token, {
      type: 'page',
      title: input.title,
      version: { number: input.version + 1 },
      body: { storage: { value: input.body, representation: 'storage' } },
    });
    if (!json) throw new NotFoundException('Confluence page not found');
    return this.toPage(json, input.version + 1);
  }

  async deletePage(token: string, cloudId: string, pageId: string): Promise<void> {
    await this.req('DELETE', `${this.base(cloudId)}/content/${encodeURIComponent(pageId)}`, token);
  }
}
