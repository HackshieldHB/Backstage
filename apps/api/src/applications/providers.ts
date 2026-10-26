import type { AppCatalogEntry, AppList, AppStat, AppStatus } from '@backstages/shared';

/**
 * Live adapters for the Applications hub. Each one reads a connected service's
 * public API with the workspace's own credentials and turns the answer into
 * the hub's generic shape (status, headline metrics, stats and lists).
 * Nothing here is sample data: if a call fails, the app shows as unreachable.
 */

export interface ProviderResult {
  status: AppStatus;
  statusReason: string;
  /** Deep link into the connected account. */
  url: string;
  metrics: AppStat[];
  stats: AppStat[];
  lists: AppList[];
}

export interface Provider {
  catalog: AppCatalogEntry;
  /** Check settings beyond "non-empty" before any network call; returns an error message or null. */
  checkSettings?(settings: Record<string, string>): string | null;
  /** Read everything the card and detail need. Throws ProviderError on failure. */
  fetch(
    settings: Record<string, string>,
    secrets: Record<string, string>,
    http: Http,
  ): Promise<ProviderResult>;
}

export class ProviderError extends Error {}

export type Http = typeof fetch;

const fmt = (n: number) => n.toLocaleString('en-US');
const pct = (n: number) => `${Math.round(n)}%`;

/** GET/POST JSON with a timeout and errors people can act on. */
export async function requestJson<T>(
  http: Http,
  appName: string,
  url: string,
  init: RequestInit = {},
  timeoutMs = 15_000,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await http(url, { ...init, signal: controller.signal });
  } catch (err) {
    throw new ProviderError(
      controller.signal.aborted
        ? `${appName} didn’t answer in time.`
        : `Couldn’t reach ${appName} (${err instanceof Error ? err.message : 'network error'}).`,
    );
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 401 || res.status === 403) {
    throw new ProviderError(
      `${appName} rejected the credentials (HTTP ${res.status}). Check the keys and their permissions.`,
    );
  }
  if (res.status === 404)
    throw new ProviderError(`${appName} couldn’t find that (HTTP 404). Check the settings.`);
  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 160);
    throw new ProviderError(
      `${appName} returned an error (HTTP ${res.status})${detail ? `: ${detail}` : ''}`,
    );
  }
  try {
    return (await res.json()) as T;
  } catch {
    throw new ProviderError(`${appName} sent a response that couldn’t be read.`);
  }
}

// ---------------------------------------------------------------------------
// Datadog
// ---------------------------------------------------------------------------

const DATADOG_SITES = [
  { value: 'datadoghq.com', label: 'US1 (datadoghq.com)' },
  { value: 'us3.datadoghq.com', label: 'US3 (us3.datadoghq.com)' },
  { value: 'us5.datadoghq.com', label: 'US5 (us5.datadoghq.com)' },
  { value: 'datadoghq.eu', label: 'EU (datadoghq.eu)' },
  { value: 'ap1.datadoghq.com', label: 'AP1 (ap1.datadoghq.com)' },
  { value: 'ap2.datadoghq.com', label: 'AP2 (ap2.datadoghq.com)' },
  { value: 'ddog-gov.com', label: 'US1-FED (ddog-gov.com)' },
];

/** The web app's host for a Datadog site (US1/EU/FED use an "app." prefix). */
export function datadogAppHost(site: string): string {
  return site === 'datadoghq.com' || site === 'datadoghq.eu' || site === 'ddog-gov.com'
    ? `app.${site}`
    : site;
}

type DatadogMonitor = { id: number; name: string; type?: string; overall_state?: string };

const datadog: Provider = {
  catalog: {
    id: 'datadog',
    name: 'Datadog',
    description: 'Monitors and infrastructure health',
    category: 'Observability',
    homeUrl: 'https://app.datadoghq.com/',
    setupUrl: 'https://docs.datadoghq.com/account_management/api-app-keys/',
    setupSteps: [
      'In Datadog, open Organization settings → API keys and copy (or create) an API key.',
      'Open Organization settings → Application keys and create a key with read access to monitors and hosts.',
      'Pick the site your Datadog account lives on (it’s in your Datadog URL).',
    ],
    fields: [
      {
        key: 'site',
        label: 'Datadog site',
        secret: false,
        options: DATADOG_SITES,
        defaultValue: 'datadoghq.com',
      },
      { key: 'apiKey', label: 'API key', secret: true, placeholder: '32-character API key' },
      {
        key: 'appKey',
        label: 'Application key',
        secret: true,
        placeholder: '40-character application key',
      },
    ],
  },
  checkSettings: (s) =>
    DATADOG_SITES.some((o) => o.value === s.site) ? null : 'Pick a Datadog site from the list.',
  async fetch(settings, secrets, http) {
    const site = settings.site;
    const base = `https://api.${site}`;
    const headers = {
      'DD-API-KEY': secrets.apiKey,
      'DD-APPLICATION-KEY': secrets.appKey,
      Accept: 'application/json',
    };
    const [monitors, hosts] = await Promise.all([
      requestJson<DatadogMonitor[]>(
        http,
        'Datadog',
        `${base}/api/v1/monitor?page=0&page_size=1000`,
        { headers },
      ),
      requestJson<{ total_up?: number; total_active?: number }>(
        http,
        'Datadog',
        `${base}/api/v1/hosts/totals`,
        {
          headers,
        },
      ),
    ]);
    const list = Array.isArray(monitors) ? monitors : [];
    const count = (state: string) => list.filter((m) => m.overall_state === state).length;
    const alert = count('Alert');
    const warn = count('Warn');
    const noData = count('No Data');
    const ok = count('OK');
    const appHost = datadogAppHost(site);
    const status: AppStatus = alert > 0 ? 'critical' : warn > 0 ? 'warning' : 'healthy';
    const statusReason =
      alert > 0
        ? `${alert} monitor${alert === 1 ? '' : 's'} alerting${warn ? `, ${warn} warning` : ''}.`
        : warn > 0
          ? `${warn} monitor${warn === 1 ? '' : 's'} warning.`
          : list.length === 0
            ? 'Connected — no monitors set up yet.'
            : `All ${fmt(list.length)} monitors are OK or quiet.`;
    const attention = list
      .filter(
        (m) =>
          m.overall_state === 'Alert' ||
          m.overall_state === 'Warn' ||
          m.overall_state === 'No Data',
      )
      .sort((a, b) => stateRank(a.overall_state) - stateRank(b.overall_state))
      .slice(0, 15);
    return {
      status,
      statusReason,
      url: `https://${appHost}/monitors/manage`,
      metrics: [
        { label: 'Monitors', value: fmt(list.length) },
        { label: 'Alerting', value: fmt(alert), tone: alert ? 'critical' : undefined },
        { label: 'Hosts up', value: fmt(hosts.total_up ?? 0) },
      ],
      stats: [
        { label: 'OK', value: fmt(ok), tone: 'positive' },
        { label: 'Alert', value: fmt(alert), tone: alert ? 'critical' : undefined },
        { label: 'Warn', value: fmt(warn), tone: warn ? 'warning' : undefined },
        { label: 'No data', value: fmt(noData) },
        { label: 'Hosts up', value: fmt(hosts.total_up ?? 0) },
        { label: 'Hosts active', value: fmt(hosts.total_active ?? 0) },
      ],
      lists: [
        {
          title: 'Monitors needing attention',
          empty: 'Nothing is alerting or warning.',
          items: attention.map((m) => ({
            title: m.name,
            subtitle: m.type ?? null,
            meta: m.overall_state ?? null,
            url: `https://${appHost}/monitors/${m.id}`,
            tone:
              m.overall_state === 'Alert'
                ? 'critical'
                : m.overall_state === 'Warn'
                  ? 'warning'
                  : undefined,
          })),
        },
      ],
    };
  },
};

function stateRank(s?: string) {
  return s === 'Alert' ? 0 : s === 'Warn' ? 1 : 2;
}

// ---------------------------------------------------------------------------
// LaunchDarkly
// ---------------------------------------------------------------------------

type LdEnvironment = { key: string; name: string };
type LdProject = {
  key: string;
  name: string;
  environments?: { items?: LdEnvironment[] } | LdEnvironment[];
};
type LdFlag = {
  key: string;
  name: string;
  kind?: string;
  temporary?: boolean;
  creationDate?: number;
  environments?: Record<string, { on?: boolean }>;
};

const launchdarkly: Provider = {
  catalog: {
    id: 'launchdarkly',
    name: 'LaunchDarkly',
    description: 'Feature flags across environments',
    category: 'Feature management',
    homeUrl: 'https://app.launchdarkly.com/',
    setupUrl: 'https://docs.launchdarkly.com/home/account/api-create',
    setupSteps: [
      'In LaunchDarkly, open Organization settings → Authorization → Access tokens.',
      'Create a token with the Reader role and copy it.',
      'Enter the key of the project to show (it’s in the project’s URL; often "default").',
    ],
    fields: [
      {
        key: 'projectKey',
        label: 'Project key',
        secret: false,
        placeholder: 'default',
        defaultValue: 'default',
      },
      { key: 'accessToken', label: 'API access token', secret: true, placeholder: 'api-…' },
    ],
  },
  checkSettings: (s) =>
    /^[A-Za-z0-9._-]{1,100}$/.test(s.projectKey ?? '') ? null : 'Enter a valid project key.',
  async fetch(settings, secrets, http) {
    const project = encodeURIComponent(settings.projectKey);
    const headers = { Authorization: secrets.accessToken, Accept: 'application/json' };
    const base = 'https://app.launchdarkly.com/api/v2';
    const [proj, flags] = await Promise.all([
      requestJson<LdProject>(
        http,
        'LaunchDarkly',
        `${base}/projects/${project}?expand=environments`,
        { headers },
      ),
      requestJson<{ items?: LdFlag[]; totalCount?: number }>(
        http,
        'LaunchDarkly',
        `${base}/flags/${project}?limit=20&summary=true&sort=-creationDate`,
        { headers },
      ),
    ]);
    const envs: LdEnvironment[] = Array.isArray(proj.environments)
      ? proj.environments
      : (proj.environments?.items ?? []);
    const items = flags.items ?? [];
    const total = flags.totalCount ?? items.length;
    const weekAgo = Date.now() - 7 * 86_400_000;
    const newThisWeek = items.filter((f) => (f.creationDate ?? 0) >= weekAgo).length;
    const projectUrl = `https://app.launchdarkly.com/projects/${project}/flags`;
    return {
      status: 'healthy',
      statusReason: `Connected to project “${proj.name}”.`,
      url: projectUrl,
      metrics: [
        { label: 'Feature flags', value: fmt(total) },
        { label: 'Environments', value: fmt(envs.length) },
        { label: 'New this week', value: fmt(newThisWeek) },
      ],
      stats: [
        { label: 'Feature flags', value: fmt(total) },
        { label: 'Environments', value: fmt(envs.length) },
        { label: 'Temporary (recent)', value: fmt(items.filter((f) => f.temporary).length) },
        { label: 'New this week', value: fmt(newThisWeek) },
      ],
      lists: [
        {
          title: 'Newest flags',
          empty: 'This project has no flags yet.',
          items: items.map((f) => {
            const onIn = envs.filter((e) => f.environments?.[e.key]?.on).map((e) => e.name);
            return {
              title: f.name || f.key,
              subtitle: f.key,
              meta: envs.length
                ? onIn.length
                  ? `On in ${onIn.join(', ')}`
                  : 'Off everywhere'
                : null,
              url: `https://app.launchdarkly.com/projects/${project}/flags/${encodeURIComponent(f.key)}`,
              tone: onIn.length ? ('positive' as const) : undefined,
            };
          }),
        },
        {
          title: 'Environments',
          empty: 'No environments.',
          items: envs.map((e) => ({ title: e.name, subtitle: e.key })),
        },
      ],
    };
  },
};

// ---------------------------------------------------------------------------
// Miro
// ---------------------------------------------------------------------------

type MiroBoard = {
  id: string;
  name: string;
  viewLink?: string;
  modifiedAt?: string;
  team?: { name?: string };
  owner?: { name?: string };
};

const miro: Provider = {
  catalog: {
    id: 'miro',
    name: 'Miro',
    description: 'Collaborative whiteboards',
    category: 'Collaboration',
    homeUrl: 'https://miro.com/app/dashboard/',
    setupUrl: 'https://developers.miro.com/docs/rest-api-build-your-first-hello-world-app',
    setupSteps: [
      'In Miro, open Settings → Your apps and create a new app (keep "Expire user authorization token" off).',
      'Give it the boards:read permission, then click "Install app and get OAuth token".',
      'Pick the team to show and copy the access token.',
    ],
    fields: [{ key: 'accessToken', label: 'Access token', secret: true, placeholder: 'eyJtaXJv…' }],
  },
  async fetch(_settings, secrets, http) {
    const res = await requestJson<{ data?: MiroBoard[]; total?: number }>(
      http,
      'Miro',
      'https://api.miro.com/v2/boards?limit=20&sort=last_modified',
      { headers: { Authorization: `Bearer ${secrets.accessToken}`, Accept: 'application/json' } },
    );
    const boards = res.data ?? [];
    const total = res.total ?? boards.length;
    const weekAgo = Date.now() - 7 * 86_400_000;
    const updated = boards.filter(
      (b) => b.modifiedAt && Date.parse(b.modifiedAt) >= weekAgo,
    ).length;
    const team = boards.find((b) => b.team?.name)?.team?.name;
    return {
      status: 'healthy',
      statusReason: team ? `Connected to team “${team}”.` : 'Connected.',
      url: 'https://miro.com/app/dashboard/',
      metrics: [
        { label: 'Boards', value: fmt(total) },
        { label: 'Updated this week', value: fmt(updated) },
        { label: 'Team', value: team ?? '—' },
      ],
      stats: [
        { label: 'Boards', value: fmt(total) },
        { label: 'Updated this week', value: fmt(updated) },
      ],
      lists: [
        {
          title: 'Recently updated boards',
          empty: 'No boards yet.',
          items: boards.map((b) => ({
            title: b.name || 'Untitled board',
            subtitle: b.owner?.name ? `Owner: ${b.owner.name}` : null,
            meta: b.modifiedAt ?? null,
            url: b.viewLink ?? null,
          })),
        },
      ],
    };
  },
};

// ---------------------------------------------------------------------------
// Salesforce (client-credentials connected app)
// ---------------------------------------------------------------------------

/** Only real Salesforce hosts — the server calls this URL, so it must not be arbitrary. */
export function salesforceHost(raw: string): string | null {
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== 'https:' || u.port) return null;
    const h = u.hostname.toLowerCase();
    return h.endsWith('.salesforce.com') || h.endsWith('.force.com') ? h : null;
  } catch {
    return null;
  }
}

type SfOpportunity = {
  Id: string;
  Name: string;
  StageName?: string;
  Amount?: number | null;
  CloseDate?: string;
};

const salesforce: Provider = {
  catalog: {
    id: 'salesforce',
    name: 'Salesforce',
    description: 'Pipeline and org limits',
    category: 'CRM',
    homeUrl: 'https://login.salesforce.com/',
    setupUrl:
      'https://help.salesforce.com/s/articleView?id=sf.connected_app_client_credentials_setup.htm',
    setupSteps: [
      'In Salesforce Setup, create a Connected App with OAuth enabled and "Enable Client Credentials Flow" on.',
      'Set its "Run As" user (an integration user with read access to Opportunities and Accounts).',
      'Copy the Consumer Key and Secret, and your My Domain URL (https://yourcompany.my.salesforce.com).',
    ],
    fields: [
      {
        key: 'instanceUrl',
        label: 'My Domain URL',
        secret: false,
        placeholder: 'https://yourcompany.my.salesforce.com',
      },
      { key: 'clientId', label: 'Consumer key', secret: true },
      { key: 'clientSecret', label: 'Consumer secret', secret: true },
    ],
  },
  checkSettings: (s) =>
    salesforceHost(s.instanceUrl ?? '')
      ? null
      : 'Enter your Salesforce My Domain URL, e.g. https://yourcompany.my.salesforce.com',
  async fetch(settings, secrets, http) {
    const host = salesforceHost(settings.instanceUrl);
    if (!host) throw new ProviderError('The Salesforce URL isn’t a Salesforce domain.');
    const token = await requestJson<{ access_token?: string; instance_url?: string }>(
      http,
      'Salesforce',
      `https://${host}/services/oauth2/token`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: secrets.clientId,
          client_secret: secrets.clientSecret,
        }).toString(),
      },
    );
    if (!token.access_token) throw new ProviderError('Salesforce didn’t return an access token.');
    // Stay on the verified host even if the token response names another instance.
    const instance =
      token.instance_url && salesforceHost(token.instance_url)
        ? new URL(token.instance_url).origin
        : `https://${host}`;
    const headers = { Authorization: `Bearer ${token.access_token}`, Accept: 'application/json' };
    const versions = await requestJson<Array<{ version: string; url: string }>>(
      http,
      'Salesforce',
      `${instance}/services/data/`,
      { headers },
    );
    const latest =
      Array.isArray(versions) && versions.length
        ? versions[versions.length - 1].url
        : '/services/data/v60.0';
    const api = `${instance}${latest}`;
    const soql = (q: string) => `${api}/query?q=${encodeURIComponent(q)}`;
    const [limits, openOpps, accounts, upcoming] = await Promise.all([
      requestJson<{ DailyApiRequests?: { Max?: number; Remaining?: number } }>(
        http,
        'Salesforce',
        `${api}/limits`,
        {
          headers,
        },
      ),
      requestJson<{ totalSize?: number }>(
        http,
        'Salesforce',
        soql('SELECT COUNT() FROM Opportunity WHERE IsClosed = false'),
        {
          headers,
        },
      ),
      requestJson<{ totalSize?: number }>(http, 'Salesforce', soql('SELECT COUNT() FROM Account'), {
        headers,
      }),
      requestJson<{ records?: SfOpportunity[] }>(
        http,
        'Salesforce',
        soql(
          'SELECT Id, Name, StageName, Amount, CloseDate FROM Opportunity WHERE IsClosed = false ORDER BY CloseDate ASC NULLS LAST LIMIT 8',
        ),
        { headers },
      ),
    ]);
    const max = limits.DailyApiRequests?.Max ?? 0;
    const remaining = limits.DailyApiRequests?.Remaining ?? max;
    const usage = max > 0 ? ((max - remaining) / max) * 100 : 0;
    const status: AppStatus = usage >= 90 ? 'critical' : usage >= 75 ? 'warning' : 'healthy';
    const usageTone = usage >= 90 ? 'critical' : usage >= 75 ? 'warning' : undefined;
    return {
      status,
      statusReason:
        status === 'healthy'
          ? `Connected to ${host}.`
          : `Daily API usage is at ${pct(usage)} of the limit.`,
      url: instance,
      metrics: [
        { label: 'Open opportunities', value: fmt(openOpps.totalSize ?? 0) },
        { label: 'Accounts', value: fmt(accounts.totalSize ?? 0) },
        { label: 'API usage', value: pct(usage), tone: usageTone },
      ],
      stats: [
        { label: 'Open opportunities', value: fmt(openOpps.totalSize ?? 0) },
        { label: 'Accounts', value: fmt(accounts.totalSize ?? 0) },
        {
          label: 'API requests today',
          value: `${fmt(max - remaining)} / ${fmt(max)}`,
          tone: usageTone,
        },
      ],
      lists: [
        {
          title: 'Open opportunities closing soonest',
          empty: 'No open opportunities.',
          items: (upcoming.records ?? []).map((o) => ({
            title: o.Name,
            subtitle: o.StageName ?? null,
            meta:
              [
                o.Amount != null ? `$${fmt(Math.round(o.Amount))}` : null,
                o.CloseDate ? `closes ${o.CloseDate}` : null,
              ]
                .filter(Boolean)
                .join(' · ') || null,
            url: `${instance}/lightning/r/Opportunity/${o.Id}/view`,
          })),
        },
      ],
    };
  },
};

export const PROVIDERS: Record<string, Provider> = { datadog, launchdarkly, miro, salesforce };
