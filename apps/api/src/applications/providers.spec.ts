import { PROVIDERS, ProviderError, datadogAppHost, requestJson, salesforceHost } from './providers';

/** A fetch stub that answers by URL substring, recording every call. */
function stubFetch(routes: Array<[string, unknown, number?]>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl = jest.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    const hit = routes.find(([part]) => url.includes(part));
    if (!hit)
      return { ok: false, status: 404, json: async () => ({}), text: async () => '' } as Response;
    const [, body, status = 200] = hit;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    } as Response;
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

describe('requestJson', () => {
  it('explains rejected credentials', async () => {
    const { impl } = stubFetch([['x', {}, 403]]);
    await expect(requestJson(impl, 'Datadog', 'https://x')).rejects.toThrow(
      'Datadog rejected the credentials (HTTP 403)',
    );
  });

  it('explains network failures', async () => {
    const impl = jest.fn().mockRejectedValue(new Error('ENOTFOUND')) as unknown as typeof fetch;
    await expect(requestJson(impl, 'Miro', 'https://x')).rejects.toThrow(ProviderError);
  });
});

describe('Datadog', () => {
  it('reads monitors and hosts with both keys and reports alerting monitors as critical', async () => {
    const { impl, calls } = stubFetch([
      [
        '/api/v1/monitor',
        [
          { id: 1, name: 'API latency', type: 'metric alert', overall_state: 'Alert' },
          { id: 2, name: 'Disk', type: 'metric alert', overall_state: 'Warn' },
          { id: 3, name: 'CPU', type: 'metric alert', overall_state: 'OK' },
        ],
      ],
      ['/api/v1/hosts/totals', { total_up: 12, total_active: 14 }],
    ]);
    const r = await PROVIDERS.datadog.fetch(
      { site: 'datadoghq.eu' },
      { apiKey: 'A', appKey: 'B' },
      impl,
    );
    expect(calls.map((c) => c.url)).toEqual([
      'https://api.datadoghq.eu/api/v1/monitor?page=0&page_size=1000',
      'https://api.datadoghq.eu/api/v1/hosts/totals',
    ]);
    expect(calls[0].init.headers).toMatchObject({ 'DD-API-KEY': 'A', 'DD-APPLICATION-KEY': 'B' });
    expect(r.status).toBe('critical');
    expect(r.statusReason).toBe('1 monitor alerting, 1 warning.');
    expect(r.metrics).toEqual([
      { label: 'Monitors', value: '3' },
      { label: 'Alerting', value: '1', tone: 'critical' },
      { label: 'Hosts up', value: '12' },
    ]);
    expect(r.lists[0].items.map((i) => i.title)).toEqual(['API latency', 'Disk']);
    expect(r.lists[0].items[0].url).toBe('https://app.datadoghq.eu/monitors/1');
  });

  it('is healthy when nothing alerts', async () => {
    const { impl } = stubFetch([
      ['/api/v1/monitor', [{ id: 1, name: 'ok', overall_state: 'OK' }]],
      ['/api/v1/hosts/totals', { total_up: 1 }],
    ]);
    const r = await PROVIDERS.datadog.fetch(
      { site: 'datadoghq.com' },
      { apiKey: 'A', appKey: 'B' },
      impl,
    );
    expect(r.status).toBe('healthy');
    expect(r.url).toBe('https://app.datadoghq.com/monitors/manage');
  });

  it('only accepts known sites and maps app hosts', () => {
    expect(PROVIDERS.datadog.checkSettings!({ site: 'evil.example' })).toMatch(
      /Pick a Datadog site/,
    );
    expect(PROVIDERS.datadog.checkSettings!({ site: 'us3.datadoghq.com' })).toBeNull();
    expect(datadogAppHost('us3.datadoghq.com')).toBe('us3.datadoghq.com');
    expect(datadogAppHost('ddog-gov.com')).toBe('app.ddog-gov.com');
  });
});

describe('LaunchDarkly', () => {
  it('reads the project and newest flags with the token', async () => {
    const now = Date.now();
    const { impl, calls } = stubFetch([
      [
        '/projects/my-proj',
        {
          key: 'my-proj',
          name: 'Web',
          environments: {
            items: [
              { key: 'production', name: 'Production' },
              { key: 'test', name: 'Test' },
            ],
          },
        },
      ],
      [
        '/flags/my-proj',
        {
          totalCount: 42,
          items: [
            {
              key: 'new-nav',
              name: 'New nav',
              temporary: true,
              creationDate: now,
              environments: { production: { on: true }, test: { on: true } },
            },
            {
              key: 'old',
              name: 'Old',
              creationDate: now - 30 * 86_400_000,
              environments: { production: { on: false } },
            },
          ],
        },
      ],
    ]);
    const r = await PROVIDERS.launchdarkly.fetch(
      { projectKey: 'my-proj' },
      { accessToken: 'api-x' },
      impl,
    );
    expect(calls[0].init.headers).toMatchObject({ Authorization: 'api-x' });
    expect(r.metrics).toEqual([
      { label: 'Feature flags', value: '42' },
      { label: 'Environments', value: '2' },
      { label: 'New this week', value: '1' },
    ]);
    expect(r.lists[0].items[0]).toMatchObject({
      title: 'New nav',
      meta: 'On in Production, Test',
      tone: 'positive',
    });
    expect(r.lists[0].items[1].meta).toBe('Off everywhere');
  });

  it('accepts an environments array too and validates the project key', async () => {
    const { impl } = stubFetch([
      [
        '/projects/default',
        { key: 'default', name: 'Default', environments: [{ key: 'p', name: 'P' }] },
      ],
      ['/flags/default', { items: [] }],
    ]);
    const r = await PROVIDERS.launchdarkly.fetch(
      { projectKey: 'default' },
      { accessToken: 't' },
      impl,
    );
    expect(r.metrics[1].value).toBe('1');
    expect(PROVIDERS.launchdarkly.checkSettings!({ projectKey: '../x' })).toMatch(
      /valid project key/,
    );
  });
});

describe('Miro', () => {
  it('lists boards with a bearer token', async () => {
    const { impl, calls } = stubFetch([
      [
        '/v2/boards',
        {
          total: 3,
          data: [
            {
              id: 'b1',
              name: 'Roadmap',
              viewLink: 'https://miro.com/app/board/b1',
              modifiedAt: new Date().toISOString(),
              team: { name: 'Acme' },
            },
            { id: 'b2', name: 'Old', modifiedAt: '2020-01-01T00:00:00Z' },
          ],
        },
      ],
    ]);
    const r = await PROVIDERS.miro.fetch({}, { accessToken: 'tok' }, impl);
    expect(calls[0].init.headers).toMatchObject({ Authorization: 'Bearer tok' });
    expect(r.metrics).toEqual([
      { label: 'Boards', value: '3' },
      { label: 'Updated this week', value: '1' },
      { label: 'Team', value: 'Acme' },
    ]);
    expect(r.lists[0].items[0]).toMatchObject({
      title: 'Roadmap',
      url: 'https://miro.com/app/board/b1',
    });
  });
});

describe('Salesforce', () => {
  it('only allows real Salesforce hosts over https', () => {
    expect(salesforceHost('https://acme.my.salesforce.com')).toBe('acme.my.salesforce.com');
    expect(salesforceHost('https://acme.lightning.force.com/')).toBe('acme.lightning.force.com');
    expect(salesforceHost('http://acme.my.salesforce.com')).toBeNull();
    expect(salesforceHost('https://salesforce.com.evil.io')).toBeNull();
    expect(salesforceHost('https://169.254.169.254')).toBeNull();
    expect(salesforceHost('https://acme.my.salesforce.com:8443')).toBeNull();
  });

  it('gets a client-credentials token, then reads limits and pipeline', async () => {
    const { impl, calls } = stubFetch([
      [
        '/services/oauth2/token',
        { access_token: 'AT', instance_url: 'https://acme.my.salesforce.com' },
      ],
      ['/services/data/v62.0/limits', { DailyApiRequests: { Max: 100000, Remaining: 20000 } }],
      [
        'IsClosed%20%3D%20false%20ORDER',
        {
          records: [
            {
              Id: '006A',
              Name: 'Big deal',
              StageName: 'Proposal',
              Amount: 12500.4,
              CloseDate: '2026-11-01',
            },
          ],
        },
      ],
      ['COUNT()%20FROM%20Opportunity', { totalSize: 7 }],
      ['COUNT()%20FROM%20Account', { totalSize: 30 }],
      [
        '/services/data/',
        [
          { version: '61.0', url: '/services/data/v61.0' },
          { version: '62.0', url: '/services/data/v62.0' },
        ],
      ],
    ]);
    const r = await PROVIDERS.salesforce.fetch(
      { instanceUrl: 'https://acme.my.salesforce.com' },
      { clientId: 'id', clientSecret: 'sec' },
      impl,
    );
    expect(calls[0].url).toBe('https://acme.my.salesforce.com/services/oauth2/token');
    expect(String(calls[0].init.body)).toContain('grant_type=client_credentials');
    expect(calls[1].init.headers).toMatchObject({ Authorization: 'Bearer AT' });
    expect(r.status).toBe('warning');
    expect(r.metrics).toEqual([
      { label: 'Open opportunities', value: '7' },
      { label: 'Accounts', value: '30' },
      { label: 'API usage', value: '80%', tone: 'warning' },
    ]);
    expect(r.lists[0].items[0]).toMatchObject({
      title: 'Big deal',
      meta: '$12,500 · closes 2026-11-01',
      url: 'https://acme.my.salesforce.com/lightning/r/Opportunity/006A/view',
    });
  });

  it('refuses a non-Salesforce URL before calling anything', async () => {
    const { impl, calls } = stubFetch([]);
    await expect(
      PROVIDERS.salesforce.fetch(
        { instanceUrl: 'https://example.com' },
        { clientId: 'a', clientSecret: 'b' },
        impl,
      ),
    ).rejects.toThrow(ProviderError);
    expect(calls).toHaveLength(0);
  });
});
