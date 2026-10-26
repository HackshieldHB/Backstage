'use client';

import { useState } from 'react';
import { ExternalLink, KeyRound, Loader2, ShieldCheck } from 'lucide-react';
import type { AppCatalogEntry } from '@backstages/shared';
import { useUiStore } from '@/stores/ui-store';
import { Dialog } from '../dialog';
import { ConfirmDialog } from '../confirm-dialog';
import { useConnectApplication, useDisconnectApplication } from './use-applications';
import type { Application } from './types';

/**
 * Connect (or manage) an application with its API credentials. The keys are
 * checked against the real service before they're saved, stored encrypted,
 * and never shown again — leave a key blank to keep the saved one.
 */
export function ConnectApplicationDialog({
  app,
  onClose,
}: {
  app: Application;
  onClose: () => void;
}) {
  const catalog = app.catalog as AppCatalogEntry;
  const pushToast = useUiStore((s) => s.pushToast);
  const connect = useConnectApplication(app.id);
  const disconnect = useDisconnectApplication(app.id);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      catalog.fields.map((f) => [
        f.key,
        f.secret ? '' : (app.settings[f.key] ?? f.defaultValue ?? ''),
      ]),
    ),
  );

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await connect.mutateAsync(values);
      pushToast(`${app.name} ${app.connected ? 'updated' : 'connected'}.`, 'success');
      onClose();
    } catch {
      /* shown inline below */
    }
  };

  return (
    <>
      <Dialog
        title={app.connected ? `Manage ${app.name}` : `Connect ${app.name}`}
        onClose={onClose}
        wide
      >
        <form onSubmit={save} className="space-y-4" data-testid={`connect-form-${app.id}`}>
          <div className="rounded-xl border border-line bg-surface p-3.5">
            <p className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-ink-3">
              <KeyRound size={13} /> Where to find the keys
            </p>
            <ol className="list-decimal space-y-1 pl-5 text-[13px] text-ink-2">
              {catalog.setupSteps.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
            <a
              href={catalog.setupUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex items-center gap-1 text-[12.5px] font-medium text-accent hover:underline"
            >
              {app.name} documentation <ExternalLink size={12} />
            </a>
          </div>

          {catalog.fields.map((f) => {
            const saved = f.secret && app.secretsSet.includes(f.key);
            return (
              <label key={f.key} className="block">
                <span className="mb-1.5 block text-[13px] font-medium text-ink-2">
                  {f.label}
                  {f.optional && <span className="font-normal text-ink-3"> (optional)</span>}
                </span>
                {f.options ? (
                  <select
                    value={values[f.key]}
                    onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                    className="h-10 w-full rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink outline-none focus:border-accent"
                  >
                    {f.options.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type={f.secret ? 'password' : 'text'}
                    autoComplete="off"
                    value={values[f.key]}
                    onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                    placeholder={saved ? '•••••••• saved — leave blank to keep' : f.placeholder}
                    required={!f.optional && !saved && !(f.defaultValue && !f.secret)}
                    className="h-10 w-full rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink outline-none placeholder:text-ink-3 focus:border-accent"
                    data-testid={`field-${f.key}`}
                  />
                )}
                {f.help && <span className="mt-1 block text-[12px] text-ink-3">{f.help}</span>}
              </label>
            );
          })}

          {connect.error && (
            <p
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700 dark:border-red-900/60 dark:bg-red-950/50 dark:text-red-300"
            >
              {connect.error instanceof Error ? connect.error.message : 'Couldn’t connect.'}
            </p>
          )}

          <p className="flex items-start gap-1.5 text-[12px] text-ink-3">
            <ShieldCheck size={14} className="mt-0.5 shrink-0 text-emerald-500" />
            Keys are checked with {app.name} first, then stored encrypted. Only workspace admins can
            change them.
          </p>

          <div className="flex items-center justify-between gap-2 pt-1">
            {app.connected ? (
              <button
                type="button"
                onClick={() => setConfirmRemove(true)}
                className="rounded-lg px-3 py-2 text-[13px] font-medium text-red-600 hover:bg-red-500/10 dark:text-red-400"
              >
                Disconnect
              </button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="btn-secondary px-3 py-2 text-[13px]"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={connect.isPending}
                className="btn-primary px-3.5 py-2 text-[13px]"
                data-testid="connect-save"
              >
                {connect.isPending && <Loader2 size={14} className="animate-spin" />}
                {connect.isPending ? 'Checking…' : app.connected ? 'Save' : 'Connect'}
              </button>
            </div>
          </div>
        </form>
      </Dialog>
      {confirmRemove && (
        <ConfirmDialog
          title={`Disconnect ${app.name}?`}
          body={`Its keys are deleted and the hub stops showing ${app.name}. You can connect it again anytime.`}
          confirmLabel="Disconnect"
          danger
          onClose={() => setConfirmRemove(false)}
          onConfirm={async () => {
            try {
              await disconnect.mutateAsync();
              pushToast(`${app.name} disconnected.`, 'success');
              onClose();
            } catch (err) {
              pushToast(err instanceof Error ? err.message : 'Couldn’t disconnect.', 'error');
            }
          }}
        />
      )}
    </>
  );
}
