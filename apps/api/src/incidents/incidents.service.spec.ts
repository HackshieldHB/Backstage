import { IncidentsService } from './incidents.service';

/**
 * Covers the incident status-transition rule (an update of kind MITIGATED/RESOLVED
 * advances the incident and stamps resolvedAt) and the admin gate on the on-call
 * roster. Prisma and policy are faked — no database.
 */
const userRow = { id: 'u1', displayName: 'Ada', avatarUrl: null };

function makeService(role: 'OWNER' | 'ADMIN' | 'MEMBER' = 'MEMBER') {
  const update = jest.fn(async ({ data }: any) => ({
    id: 'i1',
    title: 'DB down',
    severity: 'SEV1',
    status: data.status ?? 'OPEN',
    channelId: null,
    jiraIssueKey: null,
    commander: null,
    declaredBy: userRow,
    declaredAt: new Date('2026-09-09T00:00:00Z'),
    resolvedAt: data.resolvedAt ?? null,
    updates: [],
  }));
  const prisma = {
    incident: {
      findUnique: jest.fn(async () => ({ id: 'i1', workspaceId: 'w1' })),
      update,
    },
    oncallShift: { create: jest.fn(), findUnique: jest.fn() },
    workspaceMember: { findUnique: jest.fn(async () => ({ id: 'm1' })) },
  } as any;
  const policy = { requireWorkspaceMember: jest.fn(async () => ({ role })) } as any;
  return { svc: new IncidentsService(prisma, policy), prisma, update };
}

describe('IncidentsService.addUpdate', () => {
  it('a NOTE update does not change status or resolve', async () => {
    const { svc, update } = makeService();
    await svc.addUpdate('u1', 'i1', { kind: 'NOTE', body: 'looking into it' });
    const data = update.mock.calls[0][0].data;
    expect(data.status).toBeUndefined();
    expect(data.resolvedAt).toBeUndefined();
  });

  it('a RESOLVED update sets status RESOLVED and stamps resolvedAt', async () => {
    const { svc, update } = makeService();
    const dto = await svc.addUpdate('u1', 'i1', { kind: 'RESOLVED', body: 'fixed' });
    const data = update.mock.calls[0][0].data;
    expect(data.status).toBe('RESOLVED');
    expect(data.resolvedAt).toBeInstanceOf(Date);
    expect(dto.status).toBe('RESOLVED');
    expect(dto.resolvedAt).not.toBeNull();
    expect(dto.durationMin).not.toBeNull();
  });

  it('a MITIGATED update advances status without resolving', async () => {
    const { svc, update } = makeService();
    await svc.addUpdate('u1', 'i1', { kind: 'MITIGATED', body: 'failover done' });
    const data = update.mock.calls[0][0].data;
    expect(data.status).toBe('MITIGATED');
    expect(data.resolvedAt).toBeUndefined();
  });
});

describe('IncidentsService.createShift', () => {
  it('rejects non-admins from editing the roster', async () => {
    const { svc } = makeService('MEMBER');
    await expect(
      svc.createShift('u1', 'w1', { userId: 'u2', label: 'Primary', startsAt: '2026-09-09T00:00:00Z', endsAt: '2026-09-10T00:00:00Z' }),
    ).rejects.toThrow(/admins/i);
  });

  it('rejects a shift whose end is not after its start', async () => {
    const { svc } = makeService('ADMIN');
    await expect(
      svc.createShift('u1', 'w1', { userId: 'u2', label: 'Primary', startsAt: '2026-09-10T00:00:00Z', endsAt: '2026-09-09T00:00:00Z' }),
    ).rejects.toThrow(/after its start/i);
  });
});
