'use client';

import { useEffect, useState } from 'react';
import { Bot, Download, Globe, History, KeyRound, Trash2, Users } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ApiTokenScope,
  BotDto,
  CreatedApiTokenDto,
  RetentionSettingsDto,
  ScimStatusDto,
  SsoConnectionDto,
  WorkspaceDomainDto,
  WorkspaceExportScope,
} from '@backstages/shared';
import { api, API_URL } from '@/lib/api';
import { useUiStore } from '@/stores/ui-store';
import { inputCls, OneTimeSecret, primaryBtn, secondaryBtn } from './account-security';

const errText = (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback);

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-line p-3 dark:border-line">
      <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
        {icon}
        {title}
      </h3>
      {children}
    </section>
  );
}

const Hint = ({ children }: { children: React.ReactNode }) => (
  <p className="mb-2 text-[13px] text-gray-500">{children}</p>
);

/**
 * Workspace security (admins): verified domains, SSO, SCIM, bots, retention and
 * export. Owner-only actions are shown read-only to admins.
 */
export function WorkspaceSecuritySettings({ workspaceId, isOwner }: { workspaceId: string; isOwner: boolean }) {
  return (
    <div className="max-h-[65vh] space-y-4 overflow-y-auto pr-1">
      {!isOwner && (
        <p className="rounded-md bg-gray-50 px-3 py-2 text-[13px] text-gray-600 dark:bg-gray-800 dark:text-gray-300">
          Only the workspace owner can change domains, single sign-on, SCIM and retention.
        </p>
      )}
      <DomainsSection workspaceId={workspaceId} isOwner={isOwner} />
      <SsoSection workspaceId={workspaceId} isOwner={isOwner} />
      <ScimSection workspaceId={workspaceId} isOwner={isOwner} />
      <BotsSection workspaceId={workspaceId} />
      <RetentionSection workspaceId={workspaceId} isOwner={isOwner} />
    </div>
  );
}

// ---------- verified domains ----------

function DomainsSection({ workspaceId, isOwner }: { workspaceId: string; isOwner: boolean }) {
  const qc = useQueryClient();
  const pushToast = useUiStore((s) => s.pushToast);
  const key = ['ws-domains', workspaceId];
  const domains = useQuery({ queryKey: key, queryFn: () => api<WorkspaceDomainDto[]>('GET', `/workspaces/${workspaceId}/domains`) });
  const [domain, setDomain] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: key });

  const add = async () => {
    try {
      await api('POST', `/workspaces/${workspaceId}/domains`, { domain: domain.trim() });
      setDomain('');
      await refresh();
    } catch (err) {
      pushToast(errText(err, 'Could not add the domain'), 'error');
    }
  };
  const verify = async (id: string) => {
    setBusyId(id);
    try {
      await api('POST', `/domains/${id}/verify`);
      await refresh();
      pushToast('Domain verified.', 'success');
    } catch (err) {
      pushToast(errText(err, 'Verification failed'), 'error');
    } finally {
      setBusyId(null);
    }
  };
  const remove = async (id: string) => {
    try {
      await api('DELETE', `/domains/${id}`);
      await refresh();
    } catch (err) {
      pushToast(errText(err, 'Could not remove'), 'error');
    }
  };

  return (
    <Section icon={<Globe size={16} />} title="Verified domains">
      <Hint>
        Prove your organization owns its email domain. Single sign-on and SCIM only ever apply to people on verified
        domains.
      </Hint>
      <ul className="mb-2 space-y-2">
        {(domains.data ?? []).map((d) => (
          <li key={d.id} className="rounded-md border border-line p-2 text-[13px] dark:border-line" data-testid="domain-row">
            <div className="flex items-center gap-2">
              <span className="font-medium">{d.domain}</span>
              <span
                className={
                  d.verified
                    ? 'rounded bg-green-100 px-1.5 py-0.5 text-[11px] font-medium text-green-700 dark:bg-green-900/40 dark:text-green-300'
                    : 'rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-200'
                }
              >
                {d.verified ? 'Verified' : 'Pending'}
              </span>
              {isOwner && (
                <span className="ml-auto flex gap-1">
                  {!d.verified && (
                    <button className={secondaryBtn} onClick={() => void verify(d.id)} disabled={busyId === d.id}>
                      {busyId === d.id ? 'Checking…' : 'Verify'}
                    </button>
                  )}
                  <button onClick={() => void remove(d.id)} className="rounded p-1 text-gray-400 hover:text-red-500" aria-label={`Remove ${d.domain}`}>
                    <Trash2 size={15} />
                  </button>
                </span>
              )}
            </div>
            {!d.verified && (
              <p className="mt-1.5 text-xs text-gray-500">
                Add a DNS <b>TXT</b> record named <code className="break-all">{d.txtRecordName}</code> with the value{' '}
                <code className="break-all">{d.txtRecordValue}</code>, then press Verify.
              </p>
            )}
          </li>
        ))}
      </ul>
      {isOwner && (
        <div className="flex gap-2">
          <input className={inputCls} placeholder="acme.com" value={domain} onChange={(e) => setDomain(e.target.value)} aria-label="Domain" />
          <button className={primaryBtn} onClick={() => void add()} disabled={!domain.trim()}>
            Add
          </button>
        </div>
      )}
    </Section>
  );
}

// ---------- SSO ----------

function SsoSection({ workspaceId, isOwner }: { workspaceId: string; isOwner: boolean }) {
  const qc = useQueryClient();
  const pushToast = useUiStore((s) => s.pushToast);
  const key = ['ws-sso', workspaceId];
  const conn = useQuery({ queryKey: key, queryFn: () => api<SsoConnectionDto | null>('GET', `/workspaces/${workspaceId}/sso`) });
  const [issuer, setIssuer] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [enforced, setEnforced] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (conn.data) {
      setIssuer(conn.data.issuer);
      setClientId(conn.data.clientId);
      setEnforced(conn.data.enforced);
    }
  }, [conn.data]);

  const save = async () => {
    setBusy(true);
    try {
      await api('PUT', `/workspaces/${workspaceId}/sso`, {
        issuer: issuer.trim(),
        clientId: clientId.trim(),
        enforced,
        ...(clientSecret ? { clientSecret } : {}),
      });
      setClientSecret('');
      await qc.invalidateQueries({ queryKey: key });
      pushToast('Single sign-on saved.', 'success');
    } catch (err) {
      pushToast(errText(err, 'Could not save'), 'error');
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    try {
      await api('DELETE', `/workspaces/${workspaceId}/sso`);
      setIssuer('');
      setClientId('');
      setEnforced(false);
      await qc.invalidateQueries({ queryKey: key });
    } catch (err) {
      pushToast(errText(err, 'Could not remove'), 'error');
    }
  };

  // Admins need this before creating the IdP app, so show it even with no connection yet.
  const redirectUri = conn.data?.redirectUri ?? `${API_URL}/auth/sso/callback`;
  return (
    <Section icon={<KeyRound size={16} />} title="Single sign-on (OpenID Connect)">
      <Hint>
        Works with Okta, Microsoft Entra ID, Google Workspace, Auth0, Keycloak and other OIDC providers. Create a web
        app in your IdP with the redirect URI <code className="break-all">{redirectUri}</code>, then paste its details
        here.
      </Hint>
      <div className="grid gap-2 sm:grid-cols-2">
        <input className={inputCls} placeholder="Issuer URL (https://…)" value={issuer} onChange={(e) => setIssuer(e.target.value)} disabled={!isOwner} aria-label="Issuer URL" />
        <input className={inputCls} placeholder="Client ID" value={clientId} onChange={(e) => setClientId(e.target.value)} disabled={!isOwner} aria-label="Client ID" />
        <input
          className={inputCls}
          type="password"
          placeholder={conn.data ? 'Client secret (unchanged)' : 'Client secret'}
          value={clientSecret}
          onChange={(e) => setClientSecret(e.target.value)}
          disabled={!isOwner}
          aria-label="Client secret"
          autoComplete="off"
        />
        <label className="flex items-center gap-2 text-[13px]">
          <input type="checkbox" checked={enforced} onChange={(e) => setEnforced(e.target.checked)} disabled={!isOwner} />
          Require SSO for verified domains (owner keeps password access)
        </label>
      </div>
      {isOwner && (
        <div className="mt-2 flex gap-2">
          <button className={primaryBtn} onClick={() => void save()} disabled={busy || !issuer.trim() || !clientId.trim()}>
            {busy ? 'Checking IdP…' : 'Save'}
          </button>
          {conn.data && (
            <button className={secondaryBtn} onClick={() => void remove()}>
              Remove SSO
            </button>
          )}
        </div>
      )}
    </Section>
  );
}

// ---------- SCIM ----------

function ScimSection({ workspaceId, isOwner }: { workspaceId: string; isOwner: boolean }) {
  const qc = useQueryClient();
  const pushToast = useUiStore((s) => s.pushToast);
  const key = ['ws-scim', workspaceId];
  const status = useQuery({ queryKey: key, queryFn: () => api<ScimStatusDto>('GET', `/workspaces/${workspaceId}/scim`) });
  const [token, setToken] = useState<string | null>(null);

  const rotate = async () => {
    try {
      const res = await api<ScimStatusDto & { token: string }>('POST', `/workspaces/${workspaceId}/scim/token`);
      setToken(res.token);
      await qc.invalidateQueries({ queryKey: key });
    } catch (err) {
      pushToast(errText(err, 'Could not create the token'), 'error');
    }
  };
  const disable = async () => {
    try {
      await api('DELETE', `/workspaces/${workspaceId}/scim`);
      setToken(null);
      await qc.invalidateQueries({ queryKey: key });
    } catch (err) {
      pushToast(errText(err, 'Could not disable'), 'error');
    }
  };

  return (
    <Section icon={<Users size={16} />} title="User provisioning (SCIM 2.0)">
      <Hint>
        Let your IdP create, update and deactivate members automatically. Only people on verified domains can be
        provisioned.
      </Hint>
      {status.data && (
        <p className="mb-2 text-[13px]">
          Base URL: <code className="break-all">{status.data.baseUrl}</code>
          <br />
          Status: {status.data.enabled ? <>enabled (token {status.data.tokenPrefix}…)</> : 'off'}
        </p>
      )}
      {token && (
        <div className="mb-2">
          <OneTimeSecret label="SCIM bearer token — paste it into your IdP now; it won't be shown again." value={token} onDone={() => setToken(null)} />
        </div>
      )}
      {isOwner && (
        <div className="flex gap-2">
          <button className={primaryBtn} onClick={() => void rotate()}>
            {status.data?.enabled ? 'Rotate token' : 'Enable SCIM'}
          </button>
          {status.data?.enabled && (
            <button className={secondaryBtn} onClick={() => void disable()}>
              Disable
            </button>
          )}
        </div>
      )}
    </Section>
  );
}

// ---------- bots ----------

function BotsSection({ workspaceId }: { workspaceId: string }) {
  const qc = useQueryClient();
  const pushToast = useUiStore((s) => s.pushToast);
  const key = ['ws-bots', workspaceId];
  const bots = useQuery({ queryKey: key, queryFn: () => api<BotDto[]>('GET', `/workspaces/${workspaceId}/bots`) });
  const [name, setName] = useState('');
  const [scope, setScope] = useState<ApiTokenScope>('write');
  const [secret, setSecret] = useState<{ label: string; value: string } | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: key });

  const create = async () => {
    try {
      const res = await api<{ bot: BotDto; token: CreatedApiTokenDto }>('POST', `/workspaces/${workspaceId}/bots`, {
        name: name.trim(),
        scope,
      });
      setSecret({ label: `Token for ${res.bot.displayName} — copy it now; it won't be shown again.`, value: res.token.token });
      setName('');
      await refresh();
    } catch (err) {
      pushToast(errText(err, 'Could not create the bot'), 'error');
    }
  };
  const newToken = async (bot: BotDto) => {
    try {
      const res = await api<CreatedApiTokenDto>('POST', `/bots/${bot.id}/tokens`, { name: `${bot.displayName} token`, scope: 'write' });
      setSecret({ label: `New token for ${bot.displayName} — copy it now.`, value: res.token });
      await refresh();
    } catch (err) {
      pushToast(errText(err, 'Could not create a token'), 'error');
    }
  };
  const revokeToken = async (botId: string, tokenId: string) => {
    try {
      await api('DELETE', `/bots/${botId}/tokens/${tokenId}`);
      await refresh();
    } catch (err) {
      pushToast(errText(err, 'Could not revoke'), 'error');
    }
  };
  const removeBot = async (botId: string) => {
    try {
      await api('DELETE', `/bots/${botId}`);
      await refresh();
    } catch (err) {
      pushToast(errText(err, 'Could not delete the bot'), 'error');
    }
  };

  return (
    <Section icon={<Bot size={16} />} title="Bots">
      <Hint>
        Bot accounts post and read through the API with their own token, separate from any person. Add a bot to
        channels by having it join (POST /channels/:id/join).
      </Hint>
      {secret && (
        <div className="mb-2">
          <OneTimeSecret label={secret.label} value={secret.value} onDone={() => setSecret(null)} />
        </div>
      )}
      <ul className="mb-2 space-y-1.5">
        {(bots.data ?? []).map((b) => (
          <li key={b.id} className="rounded-md border border-line p-2 text-[13px] dark:border-line">
            <div className="flex items-center gap-2">
              <span className="font-medium">{b.displayName}</span>
              <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] dark:bg-gray-800">BOT</span>
              <span className="ml-auto flex gap-1">
                <button className={secondaryBtn} onClick={() => void newToken(b)}>
                  New token
                </button>
                <button onClick={() => void removeBot(b.id)} className="rounded p-1 text-gray-400 hover:text-red-500" aria-label={`Delete ${b.displayName}`}>
                  <Trash2 size={15} />
                </button>
              </span>
            </div>
            {b.tokens.length > 0 && (
              <ul className="mt-1 space-y-0.5 text-xs text-gray-500">
                {b.tokens.map((t) => (
                  <li key={t.id} className="flex items-center gap-2">
                    <code>{t.prefix}…</code> {t.scope}
                    <button onClick={() => void revokeToken(b.id, t.id)} className="text-red-500 hover:underline">
                      revoke
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <input className={inputCls} placeholder="Bot name (e.g. Deploy Bot)" value={name} onChange={(e) => setName(e.target.value)} aria-label="Bot name" />
        <select className={`${inputCls} w-auto`} value={scope} onChange={(e) => setScope(e.target.value as ApiTokenScope)} aria-label="Bot token scope">
          <option value="write">Read & write</option>
          <option value="read">Read only</option>
        </select>
        <button className={primaryBtn} onClick={() => void create()} disabled={!name.trim()}>
          Create bot
        </button>
      </div>
    </Section>
  );
}

// ---------- retention & export ----------

function RetentionSection({ workspaceId, isOwner }: { workspaceId: string; isOwner: boolean }) {
  const qc = useQueryClient();
  const pushToast = useUiStore((s) => s.pushToast);
  const key = ['ws-retention', workspaceId];
  const settings = useQuery({
    queryKey: key,
    queryFn: () => api<RetentionSettingsDto>('GET', `/workspaces/${workspaceId}/retention`),
  });
  const [days, setDays] = useState('');
  const [legalHold, setLegalHold] = useState(false);
  const [exporting, setExporting] = useState<WorkspaceExportScope | null>(null);

  useEffect(() => {
    if (settings.data) {
      setDays(settings.data.retentionDays ? String(settings.data.retentionDays) : '');
      setLegalHold(settings.data.legalHold);
    }
  }, [settings.data]);

  const save = async () => {
    const n = days.trim() ? Number(days) : null;
    if (n !== null && (!Number.isInteger(n) || n < 7 || n > 3650)) {
      pushToast('Keep messages for 7 to 3650 days, or leave it empty to keep everything.', 'error');
      return;
    }
    if (n !== null && !legalHold && !window.confirm(`Permanently delete messages older than ${n} days? This cannot be undone.`)) {
      return;
    }
    try {
      await api('PUT', `/workspaces/${workspaceId}/retention`, { retentionDays: n, legalHold });
      await qc.invalidateQueries({ queryKey: key });
      pushToast('Retention saved.', 'success');
    } catch (err) {
      pushToast(errText(err, 'Could not save'), 'error');
    }
  };

  const download = async (scope: WorkspaceExportScope) => {
    setExporting(scope);
    try {
      const data = await api<{ truncated: boolean }>('GET', `/workspaces/${workspaceId}/export?scope=${scope}`);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `backstages-export-${scope}-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      if (data.truncated) pushToast('The export hit the 50,000-message limit — older messages beyond it are not included.', 'info');
    } catch (err) {
      pushToast(errText(err, 'Export failed'), 'error');
    } finally {
      setExporting(null);
    }
  };

  return (
    <Section icon={<History size={16} />} title="Retention & export">
      <Hint>
        Automatically delete messages (and their files) after a period. A legal hold pauses all deletion. Thread
        starters are kept while their thread is still active.
      </Hint>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          className={`${inputCls} w-40`}
          inputMode="numeric"
          placeholder="Keep forever"
          value={days}
          onChange={(e) => setDays(e.target.value.replace(/[^0-9]/g, ''))}
          disabled={!isOwner}
          aria-label="Retention in days"
        />
        <span className="text-[13px] text-gray-500">days</span>
        <label className="flex items-center gap-2 text-[13px]">
          <input type="checkbox" checked={legalHold} onChange={(e) => setLegalHold(e.target.checked)} disabled={!isOwner} />
          Legal hold
        </label>
        {isOwner && (
          <button className={primaryBtn} onClick={() => void save()}>
            Save
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <button className={secondaryBtn} onClick={() => void download('public')} disabled={exporting !== null}>
          <Download size={14} className="mr-1 inline" />
          {exporting === 'public' ? 'Exporting…' : 'Export public channels'}
        </button>
        {isOwner && (
          <button className={secondaryBtn} onClick={() => void download('all')} disabled={exporting !== null}>
            <Download size={14} className="mr-1 inline" />
            {exporting === 'all' ? 'Exporting…' : 'Export everything (incl. private & DMs)'}
          </button>
        )}
      </div>
    </Section>
  );
}
