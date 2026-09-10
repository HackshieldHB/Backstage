import { BadGatewayException, Injectable, Logger } from '@nestjs/common';

export interface AtlassianTokens {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
  scopes: string;
}

export interface AtlassianSite {
  id: string; // cloudId
  url: string;
  name: string;
}

export interface AtlassianProfile {
  accountId: string;
  email: string | null;
  emailVerified: boolean;
  displayName: string;
  avatarUrl: string | null;
}

export interface AtlassianDirectoryUser {
  accountId: string;
  accountType: 'atlassian' | 'app' | 'customer';
  active: boolean;
  displayName: string;
  email: string | null;
  avatarUrl: string | null;
}

export interface JiraIssueSummary {
  key: string;
  summary: string;
  status: string;
  issueType: string | null;
  priority: string | null;
  assigneeAccountId: string | null;
}

/** One row from a JQL search. */
export interface JiraSearchRow {
  key: string;
  summary: string;
  status: string | null;
  priority: string | null;
  /** ISO date (no time) or null when the issue has no due date. */
  dueDate: string | null;
  updated: string | null;
}

/**
 * Thin HTTP client for the Atlassian cloud APIs. Kept behind one injectable so
 * integration tests can substitute a mock without touching business logic.
 */
@Injectable()
export class AtlassianApiService {
  private readonly logger = new Logger(AtlassianApiService.name);

  private get clientId() {
    return process.env.ATLASSIAN_CLIENT_ID ?? '';
  }
  private get clientSecret() {
    return process.env.ATLASSIAN_CLIENT_SECRET ?? '';
  }
  private get redirectUri() {
    return process.env.ATLASSIAN_REDIRECT_URI ?? 'http://localhost:3001/atlassian/callback';
  }

  authorizeUrl(state: string, scopes: string[]): string {
    const params = new URLSearchParams({
      audience: 'api.atlassian.com',
      client_id: this.clientId,
      scope: scopes.join(' '),
      redirect_uri: this.redirectUri,
      state,
      response_type: 'code',
      prompt: 'consent',
    });
    return `https://auth.atlassian.com/authorize?${params.toString()}`;
  }

  private async post<T>(url: string, body: unknown): Promise<T> {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      this.logger.warn(`Atlassian POST ${url} -> ${res.status} body=${errBody.slice(0, 400)}`);
      throw new BadGatewayException('Atlassian API request failed');
    }
    return res.json() as Promise<T>;
  }

  private async get<T>(url: string, accessToken: string): Promise<T | null> {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (res.status === 404) return null;
    if (!res.ok) {
      this.logger.warn(`Atlassian GET ${url} -> ${res.status}`);
      throw new BadGatewayException('Atlassian API request failed');
    }
    return res.json() as Promise<T>;
  }

  async exchangeCode(code: string): Promise<AtlassianTokens> {
    const json = await this.post<{
      access_token: string;
      refresh_token: string;
      expires_in: number;
      scope: string;
    }>('https://auth.atlassian.com/oauth/token', {
      grant_type: 'authorization_code',
      client_id: this.clientId,
      client_secret: this.clientSecret,
      code,
      redirect_uri: this.redirectUri,
    });
    return {
      accessToken: json.access_token,
      refreshToken: json.refresh_token,
      expiresInSeconds: json.expires_in,
      scopes: json.scope,
    };
  }

  async refreshTokens(refreshToken: string): Promise<AtlassianTokens> {
    const json = await this.post<{
      access_token: string;
      refresh_token: string;
      expires_in: number;
      scope: string;
    }>('https://auth.atlassian.com/oauth/token', {
      grant_type: 'refresh_token',
      client_id: this.clientId,
      client_secret: this.clientSecret,
      refresh_token: refreshToken,
    });
    return {
      accessToken: json.access_token,
      refreshToken: json.refresh_token,
      expiresInSeconds: json.expires_in,
      scopes: json.scope,
    };
  }

  async accessibleResources(accessToken: string): Promise<AtlassianSite[]> {
    const sites =
      (await this.get<Array<{ id: string; url: string; name: string }>>(
        'https://api.atlassian.com/oauth/token/accessible-resources',
        accessToken,
      )) ?? [];
    return sites.map((s) => ({ id: s.id, url: s.url, name: s.name }));
  }

  async me(accessToken: string): Promise<AtlassianProfile> {
    const json = await this.get<{
      account_id: string;
      email?: string;
      email_verified?: boolean;
      name: string;
      picture?: string;
    }>('https://api.atlassian.com/me', accessToken);
    if (!json) throw new BadGatewayException('Atlassian profile unavailable');
    return {
      accountId: json.account_id,
      email: json.email ?? null,
      emailVerified: json.email_verified ?? false,
      displayName: json.name,
      avatarUrl: json.picture ?? null,
    };
  }

  /** Pages through the site's whole user directory. */
  async listUsers(accessToken: string, cloudId: string): Promise<AtlassianDirectoryUser[]> {
    const users: AtlassianDirectoryUser[] = [];
    const pageSize = 50;
    for (let startAt = 0; ; startAt += pageSize) {
      const page = await this.get<
        Array<{
          accountId: string;
          accountType: string;
          active: boolean;
          displayName: string;
          emailAddress?: string;
          avatarUrls?: Record<string, string>;
        }>
      >(
        `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/users/search?startAt=${startAt}&maxResults=${pageSize}`,
        accessToken,
      );
      if (!page || page.length === 0) break;
      for (const u of page) {
        users.push({
          accountId: u.accountId,
          accountType: (u.accountType as AtlassianDirectoryUser['accountType']) ?? 'atlassian',
          active: u.active,
          displayName: u.displayName,
          email: u.emailAddress ?? null,
          avatarUrl: u.avatarUrls?.['48x48'] ?? null,
        });
      }
      if (page.length < pageSize) break;
    }
    return users;
  }

  async getIssue(accessToken: string, cloudId: string, issueKey: string): Promise<JiraIssueSummary | null> {
    const json = await this.get<{
      key: string;
      fields: {
        summary: string;
        status?: { name: string };
        issuetype?: { name: string };
        priority?: { name: string };
        assignee?: { accountId: string };
      };
    }>(
      `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/issue/${encodeURIComponent(issueKey)}?fields=summary,status,issuetype,priority,assignee`,
      accessToken,
    );
    if (!json) return null;
    return {
      key: json.key,
      summary: json.fields.summary,
      status: json.fields.status?.name ?? 'Unknown',
      issueType: json.fields.issuetype?.name ?? null,
      priority: json.fields.priority?.name ?? null,
      assigneeAccountId: json.fields.assignee?.accountId ?? null,
    };
  }

  async createIssue(
    accessToken: string,
    cloudId: string,
    input: {
      projectKey: string;
      summary: string;
      description: string;
      priority?: string;
      reporterAccountId?: string;
    },
  ): Promise<{ key: string }> {
    const res = await fetch(`https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/issue`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fields: {
          project: { key: input.projectKey },
          summary: input.summary,
          issuetype: { name: 'Task' },
          ...(input.priority ? { priority: { name: input.priority } } : {}),
          ...(input.reporterAccountId ? { reporter: { id: input.reporterAccountId } } : {}),
          description: {
            type: 'doc',
            version: 1,
            content: [{ type: 'paragraph', content: [{ type: 'text', text: input.description }] }],
          },
        },
      }),
    });
    if (!res.ok) throw new BadGatewayException('Failed to create Jira issue');
    const json = (await res.json()) as { key: string };
    return { key: json.key };
  }

  /** Projects on the site (for the sidebar browse tree). */
  async listProjects(
    accessToken: string,
    cloudId: string,
  ): Promise<Array<{ id: string; key: string; name: string }>> {
    const json = await this.get<{ values?: Array<{ id: string; key: string; name: string }> }>(
      `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/project/search?maxResults=50&orderBy=key`,
      accessToken,
    );
    return (json?.values ?? []).map((p) => ({ id: p.id, key: p.key, name: p.name }));
  }

  /**
   * Runs a JQL query. Uses the /search/jql endpoint — the old /search was
   * removed by Atlassian (returns 410 Gone).
   *
   * Callers build the JQL, so it must never be assembled from raw user input;
   * today every caller passes either a server-owned literal or a project key
   * already validated against /^[A-Z][A-Z0-9]+$/.
   */
  async searchJql(
    accessToken: string,
    cloudId: string,
    jql: string,
  ): Promise<JiraSearchRow[]> {
    const json = await this.get<{
      issues?: Array<{
        key: string;
        fields?: {
          summary?: string;
          status?: { name?: string };
          priority?: { name?: string };
          duedate?: string | null;
          updated?: string;
        };
      }>;
    }>(
      `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}` +
        `&maxResults=50&fields=summary,status,priority,duedate,updated`,
      accessToken,
    );
    return (json?.issues ?? []).map((i) => ({
      key: i.key,
      summary: i.fields?.summary ?? i.key,
      status: i.fields?.status?.name ?? null,
      priority: i.fields?.priority?.name ?? null,
      dueDate: i.fields?.duedate ?? null,
      updated: i.fields?.updated ?? null,
    }));
  }

  /**
   * Fast count-only query via the dedicated approximate-count endpoint — used by
   * the dashboard so a headline number never pulls a full issue page. Same JQL
   * safety contract as {@link searchJql}: server-owned literals / validated keys only.
   */
  async countJql(accessToken: string, cloudId: string, jql: string): Promise<number> {
    const res = await fetch(
      `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/search/approximate-count`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ jql }),
      },
    );
    if (!res.ok) {
      this.logger.warn(`Atlassian count ${jql} -> ${res.status}`);
      throw new BadGatewayException('Atlassian API request failed');
    }
    const json = (await res.json()) as { count?: number };
    return json.count ?? 0;
  }

  // ---------- Dashboards & gadgets (for mirroring the user's real Jira dashboards) ----------

  async listDashboards(
    accessToken: string,
    cloudId: string,
  ): Promise<Array<{ id: string; name: string; view: string | null }>> {
    const json = await this.get<{ dashboards?: Array<{ id: string; name: string; view?: string }> }>(
      `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/dashboard?maxResults=50`,
      accessToken,
    );
    return (json?.dashboards ?? []).map((d) => ({ id: d.id, name: d.name, view: d.view ?? null }));
  }

  async dashboardGadgets(
    accessToken: string,
    cloudId: string,
    dashboardId: string,
  ): Promise<Array<{ id: number; title: string; moduleKey: string | null; color: string | null }>> {
    const json = await this.get<{
      gadgets?: Array<{ id: number; title: string; moduleKey?: string; uri?: string; color?: string }>;
    }>(
      `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/dashboard/${dashboardId}/gadget`,
      accessToken,
    );
    return (json?.gadgets ?? []).map((g) => ({
      id: g.id,
      title: g.title,
      moduleKey: g.moduleKey ?? g.uri ?? null,
      color: g.color ?? null,
    }));
  }

  /** A saved filter's JQL — used to render filter-backed gadgets. */
  async getFilterJql(accessToken: string, cloudId: string, filterId: string): Promise<string | null> {
    const json = await this.get<{ jql?: string }>(
      `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/filter/${encodeURIComponent(filterId)}`,
      accessToken,
    );
    return json?.jql ?? null;
  }

  /** Best-effort read of a gadget's stored config (e.g. a filter id) from its item properties. */
  async gadgetConfig(
    accessToken: string,
    cloudId: string,
    dashboardId: string,
    itemId: number,
  ): Promise<Record<string, string>> {
    const base = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/dashboard/${dashboardId}/items/${itemId}/properties`;
    const keys = await this.get<{ keys?: Array<{ key: string }> }>(base, accessToken).catch(() => null);
    const out: Record<string, string> = {};
    for (const k of keys?.keys ?? []) {
      const v = await this.get<{ value?: unknown }>(`${base}/${encodeURIComponent(k.key)}`, accessToken).catch(() => null);
      if (v && v.value !== undefined) out[k.key] = typeof v.value === 'string' ? v.value : JSON.stringify(v.value);
    }
    return out;
  }

  // ---------- Agile (boards & sprints) ----------

  private agileBase(cloudId: string): string {
    return `https://api.atlassian.com/ex/jira/${cloudId}/rest/agile/1.0`;
  }

  /** Scrum/Kanban boards on the site. */
  async listBoards(accessToken: string, cloudId: string): Promise<Array<{ id: number; name: string }>> {
    const json = await this.get<{ values?: Array<{ id: number; name: string }> }>(
      `${this.agileBase(cloudId)}/board?maxResults=50`,
      accessToken,
    );
    return (json?.values ?? []).map((b) => ({ id: b.id, name: b.name }));
  }

  /** Active sprints for a board. Throws for boards without sprints (Kanban) — callers guard. */
  async activeSprints(
    accessToken: string,
    cloudId: string,
    boardId: number,
  ): Promise<Array<{ id: number; name: string; endDate: string | null }>> {
    const json = await this.get<{ values?: Array<{ id: number; name: string; endDate?: string }> }>(
      `${this.agileBase(cloudId)}/board/${boardId}/sprint?state=active`,
      accessToken,
    );
    return (json?.values ?? []).map((s) => ({ id: s.id, name: s.name, endDate: s.endDate ?? null }));
  }

  /** Issues in a sprint, with the coarse status category for progress bars. */
  async sprintIssues(
    accessToken: string,
    cloudId: string,
    sprintId: number,
  ): Promise<Array<{ key: string; summary: string; status: string | null; category: 'todo' | 'inProgress' | 'done' }>> {
    const json = await this.get<{
      issues?: Array<{
        key: string;
        fields?: { summary?: string; status?: { name?: string; statusCategory?: { key?: string } } };
      }>;
    }>(
      `${this.agileBase(cloudId)}/sprint/${sprintId}/issue?fields=summary,status&maxResults=100`,
      accessToken,
    );
    const mapCat = (key?: string): 'todo' | 'inProgress' | 'done' =>
      key === 'done' ? 'done' : key === 'indeterminate' ? 'inProgress' : 'todo';
    return (json?.issues ?? []).map((i) => ({
      key: i.key,
      summary: i.fields?.summary ?? i.key,
      status: i.fields?.status?.name ?? null,
      category: mapCat(i.fields?.status?.statusCategory?.key),
    }));
  }

  /** Recent issues in a project (the sidebar browse tree). */
  async searchIssues(
    accessToken: string,
    cloudId: string,
    projectKey: string,
  ): Promise<JiraSearchRow[]> {
    return this.searchJql(accessToken, cloudId, `project="${projectKey}" ORDER BY updated DESC`);
  }

  private issueBase(cloudId: string, issueKey: string): string {
    return `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/issue/${encodeURIComponent(issueKey)}`;
  }

  /** Writes that return 204/201 with no useful body — kept as raw fetch. */
  private async write(accessToken: string, url: string, method: 'POST' | 'PUT', body: unknown) {
    const res = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      this.logger.warn(`Atlassian ${method} ${url} -> ${res.status}`);
      throw new BadGatewayException('Atlassian API request failed');
    }
  }

  async getTransitions(
    accessToken: string,
    cloudId: string,
    issueKey: string,
  ): Promise<Array<{ id: string; name: string }>> {
    const json = await this.get<{ transitions?: Array<{ id: string; name: string }> }>(
      `${this.issueBase(cloudId, issueKey)}/transitions`,
      accessToken,
    );
    return (json?.transitions ?? []).map((t) => ({ id: t.id, name: t.name }));
  }

  async transitionIssue(accessToken: string, cloudId: string, issueKey: string, transitionId: string) {
    await this.write(accessToken, `${this.issueBase(cloudId, issueKey)}/transitions`, 'POST', {
      transition: { id: transitionId },
    });
  }

  async assignIssue(accessToken: string, cloudId: string, issueKey: string, accountId: string) {
    await this.write(accessToken, `${this.issueBase(cloudId, issueKey)}/assignee`, 'PUT', { accountId });
  }

  async addComment(accessToken: string, cloudId: string, issueKey: string, text: string) {
    await this.write(accessToken, `${this.issueBase(cloudId, issueKey)}/comment`, 'POST', {
      body: {
        type: 'doc',
        version: 1,
        content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
      },
    });
  }

  /**
   * Logs work against an issue via the native Jira worklog API, attributed to
   * whoever owns `accessToken`. `started` uses Jira's required
   * `yyyy-MM-ddTHH:mm:ss.SSS+0000` shape (a trailing `Z` is rejected).
   */
  async addWorklog(
    accessToken: string,
    cloudId: string,
    issueKey: string,
    input: { startedAt: Date; durationSec: number; comment?: string },
  ): Promise<{ id: string }> {
    const started = input.startedAt.toISOString().replace('Z', '+0000');
    const res = await fetch(`${this.issueBase(cloudId, issueKey)}/worklog`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        timeSpentSeconds: Math.max(60, Math.round(input.durationSec)),
        started,
        ...(input.comment?.trim()
          ? {
              comment: {
                type: 'doc',
                version: 1,
                content: [{ type: 'paragraph', content: [{ type: 'text', text: input.comment.trim() }] }],
              },
            }
          : {}),
      }),
    });
    if (!res.ok) {
      this.logger.warn(`Atlassian POST worklog ${issueKey} -> ${res.status}`);
      throw new BadGatewayException('Failed to log work in Jira');
    }
    const json = (await res.json()) as { id: string };
    return { id: json.id };
  }

  /** Existing worklogs for an issue (used to reconcile/pull logged time). */
  async getWorklogs(
    accessToken: string,
    cloudId: string,
    issueKey: string,
  ): Promise<Array<{ id: string; authorAccountId: string | null; startedAt: string | null; durationSec: number }>> {
    const json = await this.get<{
      worklogs?: Array<{
        id: string;
        author?: { accountId?: string };
        started?: string;
        timeSpentSeconds?: number;
      }>;
    }>(`${this.issueBase(cloudId, issueKey)}/worklog`, accessToken);
    return (json?.worklogs ?? []).map((w) => ({
      id: w.id,
      authorAccountId: w.author?.accountId ?? null,
      startedAt: w.started ?? null,
      durationSec: w.timeSpentSeconds ?? 0,
    }));
  }
}
