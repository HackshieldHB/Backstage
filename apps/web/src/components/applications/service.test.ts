import { describe, it, expect } from 'vitest';
import { MockApplicationService } from './service';
import { EXPERIENCE_TABS } from './experiences';
import type { ApplicationExperienceType } from './types';

const svc = new MockApplicationService();

describe('MockApplicationService', () => {
  it('returns the five registered applications with unique experiences', async () => {
    const apps = await svc.getApplications();
    expect(apps.map((a) => a.id).sort()).toEqual(['atlassian', 'datadog', 'launchdarkly', 'miro', 'salesforce']);
    const experiences = apps.map((a) => a.experience);
    expect(new Set(experiences).size).toBe(5); // all distinct
    apps.forEach((a) => expect(a.metrics.length).toBeGreaterThanOrEqual(3));
  });

  it('has exactly one application needing attention (Salesforce), rest healthy', async () => {
    const apps = await svc.getApplications();
    const attention = apps.filter((a) => a.status === 'warning' || a.status === 'critical');
    expect(attention.map((a) => a.id)).toEqual(['salesforce']);
    expect(apps.filter((a) => a.status === 'healthy')).toHaveLength(4);
  });

  it('returns domain data whose shape matches each application', async () => {
    for (const id of ['miro', 'launchdarkly', 'atlassian', 'datadog', 'salesforce']) {
      const res = await svc.getApplicationData(id);
      expect(res.ok).toBe(true);
      if (res.ok) expect(res.data.experience).toBe(id);
    }
  });

  it('reports monitoring unavailable (not "critical") for an unknown application', async () => {
    const res = await svc.getApplicationData('nope');
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toMatch(/unavailable/i);
      expect(res.lastSuccessfulSync).toBeTruthy();
    }
  });
});

describe('domain navigation is genuinely different per application', () => {
  const ids = (t: ApplicationExperienceType) => EXPERIENCE_TABS[t].map((x) => x.id).join(',');

  it('every experience defines its own tab set', () => {
    const sets = (['miro', 'launchdarkly', 'atlassian', 'datadog', 'salesforce'] as const).map(ids);
    expect(new Set(sets).size).toBe(5); // no two applications share the same tabs
  });

  it('tabs use domain-specific concepts, not one universal set', () => {
    expect(EXPERIENCE_TABS.miro.map((t) => t.id)).toEqual(['overview', 'workspaces', 'boards', 'activity']);
    expect(EXPERIENCE_TABS.launchdarkly.map((t) => t.id)).toEqual(['overview', 'flags', 'environments', 'rollouts', 'changes']);
    expect(EXPERIENCE_TABS.atlassian.map((t) => t.id)).toEqual(['overview', 'jira', 'confluence', 'jsm', 'activity']);
    expect(EXPERIENCE_TABS.datadog.map((t) => t.id)).toEqual(['overview', 'services', 'monitors', 'incidents', 'infrastructure']);
    expect(EXPERIENCE_TABS.salesforce.map((t) => t.id)).toEqual(['overview', 'users', 'api', 'integrations', 'activity']);
  });
});
