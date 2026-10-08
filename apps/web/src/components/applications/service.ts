/**
 * Application service abstraction. The UI depends ONLY on this interface, never on
 * external SaaS APIs directly — so a real MiroService / DatadogService / … can be
 * dropped in later without touching components. For now, a mock implementation.
 */
import type { AtlassianOverviewDto } from '@backstages/shared';
import type { Application, ApplicationData, AtlassianData, MonitoringResult } from './types';
import {
  MOCK_APPLICATIONS,
  MOCK_ATLASSIAN,
  MOCK_DATADOG,
  MOCK_GLOBAL_ACTIVITY,
  MOCK_LAUNCHDARKLY,
  MOCK_MIRO,
  MOCK_SALESFORCE,
} from './data';

export type GlobalActivity = typeof MOCK_GLOBAL_ACTIVITY;

export interface ApplicationService {
  getApplications(): Promise<Application[]>;
  getApplication(id: string): Promise<Application | null>;
  /** Domain data for one application, or a "monitoring unavailable" result. */
  getApplicationData(id: string): Promise<MonitoringResult<ApplicationData>>;
  getGlobalActivity(): Promise<GlobalActivity>;
}

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class MockApplicationService implements ApplicationService {
  async getApplications(): Promise<Application[]> {
    await delay(260);
    // Keep "last sync" recent in the demo by re-stamping on each fetch.
    return MOCK_APPLICATIONS.map((a, i) => ({
      ...a,
      lastChecked: new Date(Date.now() - (18 + i * 11) * 1000).toISOString(),
    }));
  }

  async getApplication(id: string): Promise<Application | null> {
    const apps = await this.getApplications();
    return apps.find((a) => a.id === id) ?? null;
  }

  async getApplicationData(id: string): Promise<MonitoringResult<ApplicationData>> {
    await delay(340);
    switch (id) {
      case 'miro':
        return { ok: true, data: { experience: 'miro', data: MOCK_MIRO } };
      case 'launchdarkly':
        return { ok: true, data: { experience: 'launchdarkly', data: MOCK_LAUNCHDARKLY } };
      case 'atlassian':
        return { ok: true, data: { experience: 'atlassian', data: MOCK_ATLASSIAN } };
      case 'datadog':
        return { ok: true, data: { experience: 'datadog', data: MOCK_DATADOG } };
      case 'salesforce':
        return { ok: true, data: { experience: 'salesforce', data: MOCK_SALESFORCE } };
      default:
        return {
          ok: false,
          reason: 'Monitoring unavailable',
          lastSuccessfulSync: new Date(Date.now() - 10 * 60_000).toISOString(),
        };
    }
  }

  async getGlobalActivity(): Promise<GlobalActivity> {
    await delay(180);
    return MOCK_GLOBAL_ACTIVITY;
  }
}

type LiveAtlassian = Extract<AtlassianOverviewDto, { connected: true }>;

/** The Atlassian card, rebuilt from live figures. Pure, so it can be tested. */
export function liveAtlassianApp(base: Application, o: LiveAtlassian): Application {
  const problems = o.problems.length;
  const fmt = (n: number | null) => (n == null ? '—' : n.toLocaleString());
  return {
    ...base,
    tagline: o.confluenceSpaces != null ? 'Jira • Confluence' : 'Jira',
    status: problems ? 'warning' : 'healthy',
    statusReason: problems
      ? `Some figures couldn’t be read: ${o.problems.join(', ')}`
      : `Connected to ${o.siteName}`,
    url: o.siteUrl,
    lastChecked: o.fetchedAt,
    metrics: [
      { label: 'Projects', value: fmt(o.projects) },
      { label: 'Open issues', value: fmt(o.openIssues) },
      o.confluenceSpaces != null
        ? { label: 'Spaces', value: fmt(o.confluenceSpaces) }
        : { label: 'Linked members', value: fmt(o.linkedMembers) },
    ],
    dataSource: 'live',
  };
}

/** Live Atlassian domain data for the detail view. Pure, so it can be tested. */
export function liveAtlassianData(o: LiveAtlassian): AtlassianData {
  const products: AtlassianData['products'] = [
    {
      key: 'jira',
      name: 'Jira',
      metricLabel: 'Projects',
      metricValue: o.projects ?? 0,
      status: o.projects == null ? 'unknown' : 'healthy',
    },
  ];
  if (o.confluenceSpaces != null) {
    products.push({
      key: 'confluence',
      name: 'Confluence',
      metricLabel: 'Spaces',
      metricValue: o.confluenceSpaces,
      status: 'healthy',
    });
  }
  return {
    products,
    users: o.linkedMembers,
    projects: o.projects ?? 0,
    openIssues: o.openIssues ?? 0,
    activity: o.recent.map((r) => ({
      id: r.key,
      at: r.updated ?? o.fetchedAt,
      text: `${r.key} · ${r.summary}${r.status ? ` — ${r.status}` : ''}`,
    })),
  };
}

/**
 * The real service for a workspace: Atlassian comes from the workspace's live
 * connection when there is one; the other applications (no connections yet)
 * keep the sample data and are marked `dataSource: 'demo'`.
 */
export class WorkspaceApplicationService implements ApplicationService {
  private readonly demo = new MockApplicationService();

  constructor(private readonly fetchAtlassian: () => Promise<AtlassianOverviewDto>) {}

  private async atlassian(): Promise<LiveAtlassian | null> {
    try {
      const o = await this.fetchAtlassian();
      return o.connected ? o : null;
    } catch {
      return null; // treat as not connected; the card stays clearly marked as demo
    }
  }

  async getApplications(): Promise<Application[]> {
    const [apps, live] = await Promise.all([this.demo.getApplications(), this.atlassian()]);
    return apps.map((a) =>
      a.id === 'atlassian' && live ? liveAtlassianApp(a, live) : { ...a, dataSource: 'demo' as const },
    );
  }

  async getApplication(id: string): Promise<Application | null> {
    return (await this.getApplications()).find((a) => a.id === id) ?? null;
  }

  async getApplicationData(id: string): Promise<MonitoringResult<ApplicationData>> {
    if (id === 'atlassian') {
      const live = await this.atlassian();
      if (live) return { ok: true, data: { experience: 'atlassian', data: liveAtlassianData(live) } };
    }
    return this.demo.getApplicationData(id);
  }

  getGlobalActivity(): Promise<GlobalActivity> {
    return this.demo.getGlobalActivity();
  }
}

/** Sample-data service (no workspace) — used where no workspace is known. */
export const applicationService: ApplicationService = new MockApplicationService();
