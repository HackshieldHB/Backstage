'use client';

import { useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { Copy, KeyRound, ShieldCheck, Trash2 } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ApiTokenDto,
  ApiTokenScope,
  CreatedApiTokenDto,
  TwoFactorSetupDto,
  TwoFactorStatusDto,
} from '@backstages/shared';
import { api } from '@/lib/api';
import { useUiStore } from '@/stores/ui-store';
import { Dialog } from './dialog';

export const inputCls =
  'w-full rounded-md border border-line-strong px-2.5 py-1.5 text-sm outline-none focus:border-accent dark:border-line dark:bg-gray-800';
export const primaryBtn =
  'rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50';
export const secondaryBtn =
  'rounded-md border border-line-strong px-3 py-1.5 text-sm font-medium hover:bg-gray-50 disabled:opacity-50 dark:border-line-strong dark:hover:bg-gray-800';

/** A secret shown exactly once, with a copy button. */
export function OneTimeSecret({ label, value, onDone }: { label: string; value: string; onDone?: () => void }) {
  const pushToast = useUiStore((s) => s.pushToast);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      pushToast('Copied.', 'success');
    } catch {
      pushToast('Copy failed — select the text and copy it manually.', 'error');
    }
  };
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-700 dark:bg-amber-950/40" role="status">
      <p className="mb-1.5 text-[13px] font-medium text-amber-900 dark:text-amber-200">{label}</p>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 break-all rounded bg-white px-2 py-1 font-mono text-xs dark:bg-gray-900" data-testid="one-time-secret">
          {value}
        </code>
        <button onClick={() => void copy()} className="rounded p-1.5 text-amber-800 hover:bg-amber-100 dark:text-amber-200 dark:hover:bg-amber-900" aria-label="Copy">
          <Copy size={15} />
        </button>
      </div>
      {onDone && (
        <button onClick={onDone} className="mt-2 text-xs font-medium text-amber-900 underline dark:text-amber-200">
          I&apos;ve saved it
        </button>
      )}
    </div>
  );
}

const errText = (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback);

/** The signed-in person's own security: 2FA and personal API tokens. */
export function AccountSecurityDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog title="Account security" onClose={onClose} wide>
      <div className="space-y-6">
        <TwoFactorSection />
        <ApiTokensSection />
      </div>
    </Dialog>
  );
}

function TwoFactorSection() {
  const qc = useQueryClient();
  const pushToast = useUiStore((s) => s.pushToast);
  const status = useQuery({
    queryKey: ['2fa-status'],
    queryFn: () => api<TwoFactorStatusDto>('GET', '/auth/2fa'),
  });
  const [setup, setSetup] = useState<TwoFactorSetupDto | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['2fa-status'] });

  const run = async (fn: () => Promise<void>, fallback: string) => {
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      pushToast(errText(err, fallback), 'error');
    } finally {
      setBusy(false);
    }
  };

  const start = () =>
    run(async () => {
      setSetup(await api<TwoFactorSetupDto>('POST', '/auth/2fa/setup'));
      setCode('');
    }, 'Could not start setup');
  const enable = () =>
    run(async () => {
      const res = await api<{ recoveryCodes: string[] }>('POST', '/auth/2fa/enable', { code });
      setRecoveryCodes(res.recoveryCodes);
      setSetup(null);
      setCode('');
      await refresh();
      pushToast('Two-factor authentication is on.', 'success');
    }, 'That code is not valid');
  const disable = () =>
    run(async () => {
      await api('POST', '/auth/2fa/disable', { code });
      setCode('');
      setRecoveryCodes(null);
      await refresh();
      pushToast('Two-factor authentication is off.', 'success');
    }, 'That code is not valid');
  const regenerate = () =>
    run(async () => {
      const res = await api<{ recoveryCodes: string[] }>('POST', '/auth/2fa/recovery-codes', { code });
      setRecoveryCodes(res.recoveryCodes);
      setCode('');
      await refresh();
    }, 'That code is not valid');

  const enabled = status.data?.enabled ?? false;

  return (
    <section aria-labelledby="tfa-heading">
      <h3 id="tfa-heading" className="mb-1 flex items-center gap-2 text-sm font-semibold">
        <ShieldCheck size={16} /> Two-factor authentication
        {status.data && (
          <span
            className={
              enabled
                ? 'rounded bg-green-100 px-1.5 py-0.5 text-[11px] font-medium text-green-700 dark:bg-green-900/40 dark:text-green-300'
                : 'rounded bg-gray-100 px-1.5 py-0.5 text-[11px] font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-300'
            }
            data-testid="tfa-status"
          >
            {enabled ? 'On' : 'Off'}
          </span>
        )}
      </h3>
      <p className="mb-3 text-[13px] text-gray-500">
        Ask for a code from an authenticator app (Google Authenticator, 1Password, Authy, …) when you sign in with
        your password.
      </p>

      {recoveryCodes && (
        <div className="mb-3">
          <OneTimeSecret
            label="Save these recovery codes somewhere safe. Each works once if you lose your authenticator."
            value={recoveryCodes.join('  ')}
            onDone={() => setRecoveryCodes(null)}
          />
        </div>
      )}

      {!enabled && !setup && (
        <button className={primaryBtn} onClick={() => void start()} disabled={busy || status.isLoading} data-testid="tfa-start">
          Set up two-factor authentication
        </button>
      )}

      {!enabled && setup && (
        <div className="space-y-3 rounded-lg border border-line p-3 dark:border-line">
          <ol className="list-decimal space-y-1 pl-5 text-[13px] text-gray-600 dark:text-gray-300">
            <li>
              In your authenticator app, add an account using this key
              {' '}(or <a className="text-accent underline" href={setup.otpauthUri}>open it in the app</a> on this device):
            </li>
          </ol>
          <code className="block break-all rounded bg-gray-100 px-2 py-1.5 font-mono text-sm tracking-wider dark:bg-gray-800" data-testid="tfa-secret">
            {setup.secret.replace(/(.{4})/g, '$1 ').trim()}
          </code>
          <ol start={2} className="list-decimal pl-5 text-[13px] text-gray-600 dark:text-gray-300">
            <li>Enter the 6-digit code it shows:</li>
          </ol>
          <div className="flex gap-2">
            <input
              className={inputCls}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123456"
              aria-label="Authentication code"
              data-testid="tfa-code"
            />
            <button className={primaryBtn} onClick={() => void enable()} disabled={busy || code.trim().length < 6} data-testid="tfa-enable">
              Turn on
            </button>
            <button className={secondaryBtn} onClick={() => setSetup(null)} disabled={busy}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {enabled && (
        <div className="space-y-2 rounded-lg border border-line p-3 dark:border-line">
          <p className="text-[13px] text-gray-600 dark:text-gray-300">
            {status.data?.recoveryCodesLeft ?? 0} recovery code(s) left. Enter a current code (or a recovery code) to
            make changes.
          </p>
          <div className="flex flex-wrap gap-2">
            <input
              className={`${inputCls} max-w-[12rem]`}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              autoComplete="one-time-code"
              placeholder="Code"
              aria-label="Authentication or recovery code"
              data-testid="tfa-manage-code"
            />
            <button className={secondaryBtn} onClick={() => void regenerate()} disabled={busy || code.trim().length < 6}>
              New recovery codes
            </button>
            <button
              className="rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:hover:bg-red-950/40"
              onClick={() => void disable()}
              disabled={busy || code.trim().length < 6}
              data-testid="tfa-disable"
            >
              Turn off
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function ApiTokensSection() {
  const qc = useQueryClient();
  const pushToast = useUiStore((s) => s.pushToast);
  const tokens = useQuery({
    queryKey: ['api-tokens'],
    queryFn: () => api<ApiTokenDto[]>('GET', '/me/api-tokens'),
  });
  const [name, setName] = useState('');
  const [scope, setScope] = useState<ApiTokenScope>('read');
  const [expires, setExpires] = useState<'' | '30' | '90' | '365'>('90');
  const [created, setCreated] = useState<CreatedApiTokenDto | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ['api-tokens'] });

  const create = async () => {
    setBusy(true);
    try {
      const res = await api<CreatedApiTokenDto>('POST', '/me/api-tokens', {
        name: name.trim(),
        scope,
        ...(expires ? { expiresInDays: Number(expires) } : {}),
      });
      setCreated(res);
      setName('');
      await refresh();
    } catch (err) {
      pushToast(errText(err, 'Could not create the token'), 'error');
    } finally {
      setBusy(false);
    }
  };
  const revoke = async (id: string) => {
    try {
      await api('DELETE', `/me/api-tokens/${id}`);
      await refresh();
    } catch (err) {
      pushToast(errText(err, 'Could not revoke'), 'error');
    }
  };

  return (
    <section aria-labelledby="tokens-heading">
      <h3 id="tokens-heading" className="mb-1 flex items-center gap-2 text-sm font-semibold">
        <KeyRound size={16} /> Personal API tokens
      </h3>
      <p className="mb-3 text-[13px] text-gray-500">
        Use the Backstages API from scripts as yourself: send <code>Authorization: Bearer &lt;token&gt;</code>.
        Read-only tokens can only fetch data. Tokens can never manage tokens, 2FA or workspace security.
      </p>
      {created && (
        <div className="mb-3">
          <OneTimeSecret
            label={`Copy “${created.name}” now — you won't be able to see it again.`}
            value={created.token}
            onDone={() => setCreated(null)}
          />
        </div>
      )}
      <ul className="mb-3 space-y-1.5">
        {(tokens.data ?? []).map((t) => (
          <li key={t.id} className="flex items-center gap-2 rounded-lg border border-line px-2.5 py-2 text-[13px] dark:border-line">
            <span className="font-medium">{t.name}</span>
            <code className="text-xs text-gray-500">{t.prefix}…</code>
            <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] dark:bg-gray-800">{t.scope}</span>
            <span className="ml-auto text-xs text-gray-500">
              {t.lastUsedAt ? `used ${formatDistanceToNow(new Date(t.lastUsedAt), { addSuffix: true })}` : 'never used'}
              {t.expiresAt ? ` · expires ${formatDistanceToNow(new Date(t.expiresAt), { addSuffix: true })}` : ''}
            </span>
            <button onClick={() => void revoke(t.id)} className="rounded p-1 text-gray-400 hover:text-red-500" aria-label={`Revoke ${t.name}`}>
              <Trash2 size={15} />
            </button>
          </li>
        ))}
        {tokens.data?.length === 0 && (
          <li className="rounded-lg border border-dashed border-line-strong p-3 text-center text-sm text-gray-500 dark:border-line-strong">
            No tokens yet.
          </li>
        )}
      </ul>
      <div className="flex flex-wrap gap-2">
        <input
          className={`${inputCls} min-w-[10rem] flex-1`}
          placeholder="Token name (e.g. CI reporter)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-label="Token name"
          data-testid="token-name"
        />
        <select className={`${inputCls} w-auto`} value={scope} onChange={(e) => setScope(e.target.value as ApiTokenScope)} aria-label="Scope">
          <option value="read">Read only</option>
          <option value="write">Read & write</option>
        </select>
        <select className={`${inputCls} w-auto`} value={expires} onChange={(e) => setExpires(e.target.value as typeof expires)} aria-label="Expiry">
          <option value="30">30 days</option>
          <option value="90">90 days</option>
          <option value="365">1 year</option>
          <option value="">No expiry</option>
        </select>
        <button className={primaryBtn} onClick={() => void create()} disabled={busy || !name.trim()} data-testid="token-create">
          Create token
        </button>
      </div>
    </section>
  );
}
