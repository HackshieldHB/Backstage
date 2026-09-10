import { DecisionsService } from './decisions.service';

/**
 * These cover the access-control invariant that an assigned owner must belong to
 * the decision's workspace. Prisma and the policy layer are faked so the guard is
 * exercised in isolation, without a database.
 */
function makeService(overrides: {
  memberFindUnique?: jest.Mock;
  decisionFindUnique?: jest.Mock;
  decisionCreate?: jest.Mock;
}) {
  const memberFindUnique = overrides.memberFindUnique ?? jest.fn(async () => null);
  const prisma = {
    workspaceMember: { findUnique: memberFindUnique },
    decision: {
      findUnique: overrides.decisionFindUnique ?? jest.fn(),
      create: overrides.decisionCreate ?? jest.fn(),
    },
  } as any;
  const policy = {
    requireChannelMember: jest.fn(async () => ({ channel: { workspaceId: 'w1' } })),
    requireWorkspaceMember: jest.fn(async () => ({ role: 'MEMBER' })),
  } as any;
  const svc = new DecisionsService(prisma, policy, {} as any);
  return { svc, prisma, policy, memberFindUnique };
}

const fullRow = {
  id: 'd1',
  channelId: 'c1',
  messageId: null,
  title: 'Ship it',
  detail: '',
  status: 'OPEN' as const,
  outcome: null,
  owner: null,
  dueAt: null,
  decidedBy: null,
  decidedAt: null,
  createdBy: { id: 'u1', displayName: 'Ada', avatarUrl: null },
  createdAt: new Date('2026-08-13T00:00:00Z'),
};

describe('DecisionsService owner validation', () => {
  it('rejects creating a decision whose owner is not a workspace member', async () => {
    const { svc, memberFindUnique } = makeService({
      memberFindUnique: jest.fn(async () => null), // owner lookup misses
    });
    await expect(
      svc.create('u1', 'w1', { channelId: 'c1', title: 'x', detail: '', ownerId: 'ghost' }),
    ).rejects.toThrow(/Owner must be a member/);
    expect(memberFindUnique).toHaveBeenCalled();
  });

  it('rejects assigning an owner who is not a workspace member', async () => {
    const { svc } = makeService({
      decisionFindUnique: jest.fn(async () => ({ id: 'd1', channelId: 'c1', workspaceId: 'w1' })),
      memberFindUnique: jest.fn(async () => null),
    });
    await expect(svc.assign('u1', 'd1', { ownerId: 'ghost' })).rejects.toThrow(
      /Owner must be a member/,
    );
  });

  it('creates without an owner without checking membership', async () => {
    const create = jest.fn(async () => fullRow);
    const memberFindUnique = jest.fn(async () => null);
    const { svc } = makeService({ decisionCreate: create, memberFindUnique });
    const dto = await svc.create('u1', 'w1', { channelId: 'c1', title: 'Ship it', detail: '' });
    expect(dto.title).toBe('Ship it');
    expect(dto.owner).toBeNull();
    expect(memberFindUnique).not.toHaveBeenCalled(); // no owner → no membership lookup
    expect(create).toHaveBeenCalled();
  });
});
