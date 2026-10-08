import { describe, it, expect } from 'vitest';
import type { AtlassianOverviewDto } from '@backstages/shared';
import { WorkspaceApplicationService, liveAtlassianData } from './service';

const live: Extract<AtlassianOverviewDto, { connected: true }> = {
  connected: true,
  siteUrl: 'https://acme.atlassian.net',
  siteName: 'Acme',
  fetchedAt: '2026-10-08T03:00:00.000Z',
  projects: 12,
  openIssues: 340,
  confluenceSpaces: null,
  linkedMembers: 5,
  recent: [
    { key: 'PROJ-1', summary: 'Ship it', status: 'Done', updated: '2026-10-08T02:00:00Z', url: 'x' },
  ],
  problems: [],
};

describe('WorkspaceApplicationService', () => {
  it('shows Atlassian live and every other app as demo data', async () => {
    const svc = new WorkspaceApplicationService(async () => live);
    const apps = await svc.getApplications();
    const atl = apps.find((a) => a.id === 'atlassian')!;
    expect(atl.dataSource).toBe('live');
    expect(atl.status).toBe('healthy');
    expect(atl.statusReason).toBe('Connected to Acme');
    expect(atl.url).toBe('https://acme.atlassian.net');
    expect(atl.metrics).toEqual([
      { label: 'Projects', value: '12' },
      { label: 'Open issues', value: '340' },
      { label: 'Linked members', value: '5' },
    ]);
    expect(apps.filter((a) => a.id !== 'atlassian').every((a) => a.dataSource === 'demo')).toBe(true);
  });

  it('flags partial failures as a warning with the reason', async () => {
    const svc = new WorkspaceApplicationService(async () => ({
      ...live,
      openIssues: null,
      problems: ['open issue count'],
    }));
    const atl = (await svc.getApplications()).find((a) => a.id === 'atlassian')!;
    expect(atl.status).toBe('warning');
    expect(atl.statusReason).toMatch(/open issue count/);
    expect(atl.metrics[1]).toEqual({ label: 'Open issues', value: '—' });
  });

  it('falls back to clearly-marked demo data when not connected or the call fails', async () => {
    for (const fetch of [
      async () => ({ connected: false }) as AtlassianOverviewDto,
      async () => {
        throw new Error('network');
      },
    ]) {
      const svc = new WorkspaceApplicationService(fetch);
      const atl = (await svc.getApplications()).find((a) => a.id === 'atlassian')!;
      expect(atl.dataSource).toBe('demo');
      const data = await svc.getApplicationData('atlassian');
      expect(data.ok).toBe(true);
    }
  });

  it('maps live figures into the Atlassian detail view', async () => {
    const data = liveAtlassianData(live);
    expect(data.products.map((p) => p.key)).toEqual(['jira']); // no Confluence granted
    expect(data.openIssues).toBe(340);
    expect(data.activity[0]).toMatchObject({ id: 'PROJ-1', text: 'PROJ-1 · Ship it — Done' });
    const svc = new WorkspaceApplicationService(async () => live);
    const res = await svc.getApplicationData('atlassian');
    expect(res.ok && res.data.experience === 'atlassian' && res.data.data.projects).toBe(12);
  });
});
