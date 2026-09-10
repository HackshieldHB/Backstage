import { ProjectsService } from './projects.service';

/**
 * Exercises the billability/margin rollup math and the admin-only gate in
 * isolation. Prisma and the policy layer are faked so no database is needed.
 */
function makeService(role: 'OWNER' | 'ADMIN' | 'MEMBER', data?: {
  clients?: any[];
  projects?: any[];
  entries?: any[];
}) {
  const prisma = {
    client: { findMany: jest.fn(async () => data?.clients ?? []) },
    project: { findMany: jest.fn(async () => data?.projects ?? []) },
    timesheetEntry: { findMany: jest.fn(async () => data?.entries ?? []) },
  } as any;
  const policy = {
    requireWorkspaceMember: jest.fn(async () => ({ role })),
  } as any;
  return { svc: new ProjectsService(prisma, policy), prisma, policy };
}

const project = (over: Partial<Record<string, unknown>>) => ({
  id: 'p',
  clientId: 'c1',
  name: 'Project',
  jiraProjectKey: null,
  channelId: null,
  billRateCents: 0,
  costRateCents: 0,
  budgetHours: null,
  billable: true,
  archived: false,
  ...over,
});

describe('ProjectsService.overview', () => {
  it('rejects non-admins', async () => {
    const { svc } = makeService('MEMBER');
    await expect(svc.overview('u1', 'w1', 30)).rejects.toThrow(/admins/i);
  });

  it('computes revenue, cost, margin and budget% by Jira key prefix', async () => {
    const { svc } = makeService('ADMIN', {
      clients: [{ id: 'c1', name: 'Acme' }],
      projects: [
        project({ id: 'p1', jiraProjectKey: 'KAN', billRateCents: 20000, costRateCents: 10000, budgetHours: 10, billable: true }),
        project({ id: 'p2', jiraProjectKey: 'OTH', billRateCents: 20000, costRateCents: 5000, billable: false }),
      ],
      entries: [
        { issueKey: 'KAN-1', durationSec: 3600 },
        { issueKey: 'KAN-2', durationSec: 3600 },
        { issueKey: 'OTH-9', durationSec: 3600 },
      ],
    });

    const out = await svc.overview('u1', 'w1', 30);
    const [p1, p2] = out.clients[0].projects;

    // p1: 2h billable @ $200/h = $400 revenue, @ $100/h = $200 cost.
    expect(p1.loggedSec).toBe(7200);
    expect(p1.revenueCents).toBe(40000);
    expect(p1.costCents).toBe(20000);
    expect(p1.marginCents).toBe(20000);
    expect(p1.budgetUsedPct).toBe(20); // 2h of 10h

    // p2: non-billable → no revenue, cost still accrues.
    expect(p2.revenueCents).toBe(0);
    expect(p2.costCents).toBe(5000);
    expect(p2.marginCents).toBe(-5000);
    expect(p2.budgetUsedPct).toBeNull();

    // Client + totals roll up the projects.
    expect(out.clients[0].revenueCents).toBe(40000);
    expect(out.totals.marginCents).toBe(15000);
    expect(out.totals.loggedSec).toBe(10800);
  });

  it('attributes no time to a project without a Jira key', async () => {
    const { svc } = makeService('OWNER', {
      clients: [{ id: 'c1', name: 'Acme' }],
      projects: [project({ id: 'p1', jiraProjectKey: null, billRateCents: 20000, costRateCents: 10000 })],
      entries: [{ issueKey: 'KAN-1', durationSec: 3600 }],
    });
    const out = await svc.overview('u1', 'w1', 30);
    expect(out.clients[0].projects[0].loggedSec).toBe(0);
    expect(out.totals.revenueCents).toBe(0);
  });
});
