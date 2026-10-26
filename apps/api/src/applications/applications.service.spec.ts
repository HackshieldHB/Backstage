import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ApplicationsService } from './applications.service';
import { decryptToken, encryptToken } from '../atlassian/crypto';

process.env.TOKEN_ENCRYPTION_KEY = 'a'.repeat(64);

const ok = (body: unknown) =>
  ({
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }) as Response;

function setup(
  opts: { admin?: boolean; existing?: { config: unknown; secrets: Record<string, string> } } = {},
) {
  const rows: Array<{ appId: string; config: unknown; secretEnc: string }> = opts.existing
    ? [
        {
          appId: 'miro',
          config: opts.existing.config,
          secretEnc: encryptToken(JSON.stringify(opts.existing.secrets)),
        },
      ]
    : [];
  const prisma = {
    appConnection: {
      findMany: jest.fn(async () => rows),
      findUnique: jest.fn(
        async ({ where }: { where: { workspaceId_appId: { appId: string } } }) =>
          rows.find((r) => r.appId === where.workspaceId_appId.appId) ?? null,
      ),
      upsert: jest.fn(
        async ({
          create,
          update,
        }: {
          create: { appId: string; config: unknown; secretEnc: string };
          update: { config: unknown; secretEnc: string };
        }) => {
          const i = rows.findIndex((r) => r.appId === create.appId);
          if (i >= 0) rows[i] = { ...rows[i], ...update };
          else
            rows.push({ appId: create.appId, config: create.config, secretEnc: create.secretEnc });
        },
      ),
      deleteMany: jest.fn(async () => ({ count: 1 })),
    },
  };
  const policy = {
    requireWorkspaceMember: jest.fn(async (_u: string, _w: string, role?: string) => {
      if (role === 'ADMIN' && !opts.admin) throw new ForbiddenException('Insufficient role');
      return {};
    }),
  };
  const audit = { record: jest.fn() };
  const svc = new ApplicationsService(prisma as never, policy as never, audit as never);
  const http = jest.fn(async () => ok({ total: 1, data: [{ id: 'b', name: 'Board' }] }));
  svc.http = http as unknown as typeof fetch;
  return { svc, prisma, http, rows, audit };
}

describe('ApplicationsService', () => {
  it('lists every catalog app, unconnected ones without fake numbers', async () => {
    const { svc } = setup();
    const res = await svc.overview('u', 'w');
    expect(res.catalog.map((c) => c.id)).toEqual(['datadog', 'launchdarkly', 'miro', 'salesforce']);
    for (const app of res.apps) {
      expect(app).toMatchObject({
        connected: false,
        status: 'unknown',
        metrics: [],
        lastChecked: null,
      });
    }
  });

  it('only admins can connect', async () => {
    const { svc } = setup({ admin: false });
    await expect(svc.connect('u', 'w', 'miro', { accessToken: 't' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('verifies the credentials against the service before saving, and encrypts them', async () => {
    const { svc, prisma, http, rows, audit } = setup({ admin: true });
    const summary = await svc.connect('u', 'w', 'miro', { accessToken: 'secret-token' });
    expect(http).toHaveBeenCalledTimes(1);
    expect(summary).toMatchObject({
      connected: true,
      status: 'healthy',
      secretsSet: ['accessToken'],
    });
    expect(JSON.stringify(summary)).not.toContain('secret-token');
    expect(prisma.appConnection.upsert).toHaveBeenCalledTimes(1);
    expect(rows[0].secretEnc).not.toContain('secret-token');
    expect(JSON.parse(decryptToken(rows[0].secretEnc))).toEqual({ accessToken: 'secret-token' });
    expect(audit.record).toHaveBeenCalledWith('w', 'u', 'application.connect', expect.anything());
  });

  it('does not save when the service rejects the credentials', async () => {
    const { svc, prisma, http } = setup({ admin: true });
    http.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({}),
      text: async () => '',
    } as Response);
    await expect(svc.connect('u', 'w', 'miro', { accessToken: 'bad' })).rejects.toThrow(
      new BadRequestException(
        'Miro rejected the credentials (HTTP 401). Check the keys and their permissions.',
      ),
    );
    expect(prisma.appConnection.upsert).not.toHaveBeenCalled();
  });

  it('requires every non-optional field', async () => {
    const { svc } = setup({ admin: true });
    await expect(svc.connect('u', 'w', 'miro', {})).rejects.toThrow('Access token is required.');
  });

  it('keeps a stored secret when the field is left blank', async () => {
    const { svc, http, rows } = setup({
      admin: true,
      existing: { config: {}, secrets: { accessToken: 'kept' } },
    });
    await svc.connect('u', 'w', 'miro', { accessToken: '   ' });
    const headers = (http.mock.calls[0] as unknown as [string, RequestInit])[1].headers as Record<
      string,
      string
    >;
    expect(headers.Authorization).toBe('Bearer kept');
    expect(JSON.parse(decryptToken(rows[0].secretEnc))).toEqual({ accessToken: 'kept' });
  });

  it('shows a connected app that fails to answer as unknown, not broken data', async () => {
    const { svc, http } = setup({ existing: { config: {}, secrets: { accessToken: 't' } } });
    http.mockRejectedValueOnce(new Error('ETIMEDOUT'));
    const res = await svc.overview('u', 'w');
    const miro = res.apps.find((a) => a.id === 'miro')!;
    expect(miro).toMatchObject({
      connected: true,
      status: 'unknown',
      metrics: [],
      secretsSet: ['accessToken'],
    });
    expect(miro.statusReason).toContain('Couldn’t reach Miro');
  });
});
