import { describe, expect, it } from 'vitest';
import type { AtlassianOverviewDto } from '@backstages/shared';
import { atlassianApp, atlassianDetail } from './use-applications';

const live: Extract<AtlassianOverviewDto, { connected: true }> = {
  connected: true,
  siteUrl: 'https://acme.atlassian.net',
  siteName: 'acme',
  fetchedAt: '2026-10-26T04:00:00.000Z',
  projects: 12,
  openIssues: 1234,
  confluenceSpaces: 5,
  linkedMembers: 8,
  recent: [
    {
      key: 'BS-1',
      summary: 'Fix login',
      status: 'In review',
      updated: '2026-10-25T10:00:00.000Z',
      url: 'https://acme.atlassian.net/browse/BS-1',
    },
  ],
  problems: [],
};

describe('atlassianApp', () => {
  it('shows no figures when Atlassian is not connected (no sample data)', () => {
    for (const o of [null, { connected: false } as const]) {
      const app = atlassianApp(o);
      expect(app).toMatchObject({
        connected: false,
        status: 'unknown',
        metrics: [],
        lastChecked: null,
        connectVia: 'atlassian',
      });
    }
  });

  it('builds the card from the live overview', () => {
    const app = atlassianApp(live);
    expect(app).toMatchObject({
      connected: true,
      status: 'healthy',
      url: 'https://acme.atlassian.net',
      lastChecked: live.fetchedAt,
    });
    expect(app.metrics).toEqual([
      { label: 'Projects', value: '12' },
      { label: 'Open issues', value: '1,234' },
      { label: 'Spaces', value: '5' },
    ]);
  });

  it('flags partial reads as a warning and falls back to linked members without Confluence', () => {
    const app = atlassianApp({
      ...live,
      confluenceSpaces: null,
      projects: null,
      problems: ['projects'],
    });
    expect(app.status).toBe('warning');
    expect(app.statusReason).toContain('projects');
    expect(app.metrics[0]).toEqual({ label: 'Projects', value: '—' });
    expect(app.metrics[2]).toEqual({ label: 'Linked members', value: '8' });
  });
});

describe('atlassianDetail', () => {
  it('lists recently updated issues with links', () => {
    const d = atlassianDetail(live);
    expect(d.stats.map((s) => s.label)).toEqual([
      'Jira projects',
      'Open issues',
      'Confluence spaces',
      'Linked members',
    ]);
    expect(d.lists[0].items[0]).toEqual({
      title: 'BS-1 · Fix login',
      subtitle: 'In review',
      meta: '2026-10-25T10:00:00.000Z',
      url: 'https://acme.atlassian.net/browse/BS-1',
    });
  });
});
