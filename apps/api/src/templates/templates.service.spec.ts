import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { TemplatesService, canManage } from './templates.service';

function setup(
  role: 'OWNER' | 'ADMIN' | 'MEMBER' | 'GUEST',
  rows: Array<Record<string, unknown>> = [],
) {
  const prisma = {
    messageTemplate: {
      findMany: jest.fn(async () => rows),
      findUnique: jest.fn(
        async ({ where }: { where: { id: string } }) => rows.find((r) => r.id === where.id) ?? null,
      ),
      count: jest.fn(async () => 0),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 't-new',
        ...data,
        updatedAt: new Date(),
        owner: { id: data.ownerId, displayName: 'Me' },
      })),
      update: jest.fn(
        async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => ({
          ...rows.find((r) => r.id === where.id),
          ...data,
          updatedAt: new Date(),
          owner: { id: 'someone', displayName: 'Someone' },
        }),
      ),
      delete: jest.fn(async () => ({})),
    },
  };
  const policy = { requireWorkspaceMember: jest.fn(async () => ({ role })) };
  return { svc: new TemplatesService(prisma as never, policy as never), prisma };
}

const row = (over: Record<string, unknown>) => ({
  id: 't1',
  workspaceId: 'w',
  ownerId: 'other',
  name: 'Standup',
  content: 'Yesterday / Today / Blockers',
  shared: false,
  updatedAt: new Date(),
  owner: { id: 'other', displayName: 'Other' },
  ...over,
});

describe('canManage', () => {
  it('lets owners manage their own, and admins manage shared ones', () => {
    expect(canManage({ ownerId: 'me', shared: false }, 'me', { role: 'MEMBER' })).toBe(true);
    expect(canManage({ ownerId: 'x', shared: true }, 'me', { role: 'ADMIN' })).toBe(true);
    expect(canManage({ ownerId: 'x', shared: true }, 'me', { role: 'MEMBER' })).toBe(false);
    expect(canManage({ ownerId: 'x', shared: false }, 'me', { role: 'OWNER' })).toBe(false);
  });
});

describe('TemplatesService', () => {
  it('lists your own and shared templates only', async () => {
    const { svc, prisma } = setup('MEMBER');
    await svc.list('me', 'w');
    expect(prisma.messageTemplate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { workspaceId: 'w', OR: [{ ownerId: 'me' }, { shared: true }] },
      }),
    );
  });

  it('does not let guests share templates', async () => {
    const { svc } = setup('GUEST');
    await expect(
      svc.create('me', 'w', { name: 'a', content: 'b', shared: true }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      svc.create('me', 'w', { name: 'a', content: 'b', shared: false }),
    ).resolves.toMatchObject({ shared: false });
  });

  it('hides someone else’s personal template', async () => {
    const { svc } = setup('ADMIN', [row({ shared: false })]);
    await expect(svc.remove('me', 't1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('lets an admin edit a shared template but not unshare it', async () => {
    const { svc } = setup('ADMIN', [row({ shared: true })]);
    await expect(svc.update('me', 't1', { content: 'new' })).resolves.toMatchObject({
      content: 'new',
    });
    await expect(svc.update('me', 't1', { shared: false })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('refuses members changing a shared template they don’t own', async () => {
    const { svc } = setup('MEMBER', [row({ shared: true })]);
    await expect(svc.update('me', 't1', { name: 'x' })).rejects.toBeInstanceOf(ForbiddenException);
  });
});
