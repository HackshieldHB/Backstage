'use client';

import { createContext, useContext } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ApplicationDetailDto,
  ApplicationsOverviewDto,
  ApplicationSummaryDto,
  AtlassianOverviewDto,
} from '@backstages/shared';
import { api } from '@/lib/api';
import type { Application } from './types';

/** The workspace the Applications Hub is showing. */
export const ApplicationsWorkspaceContext = createContext<string | null>(null);

function useWs(): string | null {
  return useContext(ApplicationsWorkspaceContext);
}

type LiveAtlassian = Extract<AtlassianOverviewDto, { connected: true }>;

const fmt = (n: number | null) => (n == null ? '—' : n.toLocaleString('en-US'));

/** The Atlassian card from its live overview (or a "connect" card). Pure, so it can be tested. */
export function atlassianApp(o: AtlassianOverviewDto | null): Application {
  const base = {
    id: 'atlassian',
    name: 'Atlassian',
    description: 'Jira and Confluence',
    category: 'Productivity',
    connectVia: 'atlassian' as const,
    settings: {},
    secretsSet: [],
  };
  if (!o || !o.connected) {
    return {
      ...base,
      connected: false,
      status: 'unknown',
      statusReason: 'Not connected yet.',
      url: 'https://www.atlassian.com/',
      lastChecked: null,
      metrics: [],
    };
  }
  const problems = o.problems.length;
  return {
    ...base,
    connected: true,
    status: problems ? 'warning' : 'healthy',
    statusReason: problems ? `Some figures couldn’t be read: ${o.problems.join(', ')}` : `Connected to ${o.siteName}.`,
    url: o.siteUrl,
    lastChecked: o.fetchedAt,
    metrics: [
      { label: 'Projects', value: fmt(o.projects) },
      { label: 'Open issues', value: fmt(o.openIssues) },
      o.confluenceSpaces != null
        ? { label: 'Spaces', value: fmt(o.confluenceSpaces) }
        : { label: 'Linked members', value: fmt(o.linkedMembers) },
    ],
  };
}

/** Atlassian's detail view, in the hub's generic shape. Pure, so it can be tested. */
export function atlassianDetail(o: LiveAtlassian): ApplicationDetailDto {
  return {
    id: 'atlassian',
    status: o.problems.length ? 'warning' : 'healthy',
    statusReason: o.problems.length ? `Some figures couldn’t be read: ${o.problems.join(', ')}` : `Connected to ${o.siteName}.`,
    fetchedAt: o.fetchedAt,
    url: o.siteUrl,
    stats: [
      { label: 'Jira projects', value: fmt(o.projects) },
      { label: 'Open issues', value: fmt(o.openIssues) },
      { label: 'Confluence spaces', value: fmt(o.confluenceSpaces) },
      { label: 'Linked members', value: fmt(o.linkedMembers) },
    ],
    lists: [
      {
        title: 'Issues updated this week',
        empty: 'No issues were updated in the last 7 days.',
        items: o.recent.map((r) => ({
          title: `${r.key} · ${r.summary}`,
          subtitle: r.status,
          meta: r.updated,
          url: r.url,
        })),
      },
    ],
  };
}

function fromSummary(s: ApplicationSummaryDto, overview: ApplicationsOverviewDto): Application {
  const catalog = overview.catalog.find((c) => c.id === s.id);
  return {
    id: s.id,
    name: catalog?.name ?? s.id,
    description: catalog?.description ?? '',
    category: catalog?.category ?? '',
    connected: s.connected,
    status: s.status,
    statusReason: s.statusReason,
    url: s.url,
    lastChecked: s.lastChecked,
    metrics: s.metrics,
    connectVia: 'api',
    catalog,
    settings: s.settings,
    secretsSet: s.secretsSet,
  };
}

const keys = {
  apps: (ws: string | null) => ['applications', ws] as const,
  detail: (ws: string | null, id: string | null) => ['application-detail', ws, id] as const,
};

/** Every application with its live status (connected ones) or how to connect it. */
export function useApplications() {
  const ws = useWs();
  return useQuery({
    queryKey: keys.apps(ws),
    enabled: !!ws,
    staleTime: 30_000,
    queryFn: async (): Promise<Application[]> => {
      const [overview, atlassian] = await Promise.all([
        api<ApplicationsOverviewDto>('GET', `/workspaces/${ws}/applications`),
        // Atlassian is optional here: if its overview fails, show it as not connected.
        api<AtlassianOverviewDto>('GET', `/workspaces/${ws}/applications/atlassian`).catch(() => null),
      ]);
      return [atlassianApp(atlassian), ...overview.apps.map((s) => fromSummary(s, overview))];
    },
  });
}

/** Live detail for one connected application. */
export function useApplicationDetail(app: Application | null) {
  const ws = useWs();
  return useQuery({
    queryKey: keys.detail(ws, app?.id ?? null),
    enabled: !!ws && !!app?.connected,
    staleTime: 30_000,
    queryFn: async (): Promise<ApplicationDetailDto> => {
      if (app!.connectVia === 'atlassian') {
        const o = await api<AtlassianOverviewDto>('GET', `/workspaces/${ws}/applications/atlassian`);
        if (!o.connected) throw new Error('Atlassian isn’t connected.');
        return atlassianDetail(o);
      }
      return api<ApplicationDetailDto>('GET', `/workspaces/${ws}/applications/${app!.id}/detail`);
    },
  });
}

export function useConnectApplication(appId: string) {
  const ws = useWs();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (fields: Record<string, string>) =>
      api<ApplicationSummaryDto>('PUT', `/workspaces/${ws}/applications/${appId}/connection`, { fields }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.apps(ws) });
      void qc.invalidateQueries({ queryKey: keys.detail(ws, appId) });
    },
  });
}

export function useDisconnectApplication(appId: string) {
  const ws = useWs();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<{ ok: true }>('DELETE', `/workspaces/${ws}/applications/${appId}/connection`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.apps(ws) });
      qc.removeQueries({ queryKey: keys.detail(ws, appId) });
    },
  });
}
