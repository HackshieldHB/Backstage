'use client';

import { useEffect, useState } from 'react';
import { Check, Rocket, X } from 'lucide-react';
import { useAuthStore } from '@/stores/auth-store';
import { useUiStore } from '@/stores/ui-store';
import { useChannels, useMembers } from '@/hooks/queries';
import { useAtlassianStatus } from './atlassian-dialog';

const DISMISS_KEY = 'bs.gettingStarted.dismissed';
const CATCHUP_KEY = 'bs.gettingStarted.triedCatchUp';

/** Open one of the sidebar dialogs by name (the sidebar listens for this). */
function openDialog(name: string) {
  window.dispatchEvent(new CustomEvent('bs:open-dialog', { detail: name }));
}

/**
 * A dismissible "getting started" checklist shown in the main pane for fresh
 * workspaces. Each item reflects real state (channels created, teammates
 * invited, profile set, integration connected) and links to the action that
 * completes it. Hides itself once everything is done or the user dismisses it.
 */
export function GettingStarted({ workspaceId }: { workspaceId: string }) {
  const me = useAuthStore((s) => s.user);
  const lang = useUiStore((s) => s.lang);
  const id = lang === 'id';
  const channels = useChannels(workspaceId);
  const members = useMembers(workspaceId);
  const atlassian = useAtlassianStatus(workspaceId);

  const [dismissed, setDismissed] = useState(true); // assume dismissed until we read storage
  const [triedCatchUp, setTriedCatchUp] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    setDismissed(window.localStorage.getItem(DISMISS_KEY) === '1');
    setTriedCatchUp(window.localStorage.getItem(CATCHUP_KEY) === '1');
  }, []);

  const dismiss = () => {
    if (typeof window !== 'undefined') window.localStorage.setItem(DISMISS_KEY, '1');
    setDismissed(true);
  };

  const markCatchUp = () => {
    if (typeof window !== 'undefined') window.localStorage.setItem(CATCHUP_KEY, '1');
    setTriedCatchUp(true);
  };

  const items = [
    {
      done: !!me?.statusText || !!me?.avatarUrl,
      label: id ? 'Lengkapi profil & status' : 'Set your profile & status',
      cta: id ? 'Buka' : 'Open',
      action: () => openDialog('status'),
    },
    {
      done: (channels.data ?? []).some((c) => !c.isDefault),
      label: id ? 'Buat channel pertama' : 'Create your first channel',
      cta: id ? 'Buat' : 'Create',
      action: () => openDialog('create-channel'),
    },
    {
      done: (members.data ?? []).length > 1,
      label: id ? 'Undang rekan tim' : 'Invite a teammate',
      cta: id ? 'Undang' : 'Invite',
      action: () => openDialog('invite'),
    },
    {
      done: !!atlassian.data?.connected,
      label: id ? 'Sambungkan Jira & Confluence' : 'Connect Jira & Confluence',
      cta: id ? 'Sambungkan' : 'Connect',
      action: () => openDialog('settings'),
    },
    {
      done: triedCatchUp,
      label: id ? 'Coba "Rangkum untukku"' : 'Try "Catch me up"',
      cta: id ? 'Coba' : 'Try',
      action: () => {
        markCatchUp();
        openDialog('catch-up');
      },
    },
  ];

  const doneCount = items.filter((i) => i.done).length;

  // Wait for data before deciding to render, and never show once complete.
  if (dismissed) return null;
  if (channels.isLoading || members.isLoading) return null;
  if (doneCount === items.length) return null;

  return (
    <div className="mx-auto my-4 w-full max-w-2xl rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/10 text-accent">
            <Rocket size={16} />
          </span>
          <div>
            <h3 className="text-sm font-bold">
              {id ? 'Mulai di sini' : 'Get started'}
            </h3>
            <p className="text-xs text-gray-500">
              {id
                ? `${doneCount} dari ${items.length} langkah selesai`
                : `${doneCount} of ${items.length} steps done`}
            </p>
          </div>
        </div>
        <button
          onClick={dismiss}
          className="-mr-1 -mt-1 rounded p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
          aria-label={id ? 'Tutup' : 'Dismiss'}
          data-testid="getting-started-dismiss"
        >
          <X size={15} />
        </button>
      </div>

      {/* Progress bar */}
      <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
        <div
          className="h-full rounded-full bg-accent transition-all"
          style={{ width: `${(doneCount / items.length) * 100}%` }}
        />
      </div>

      <ul className="mt-3 space-y-1">
        {items.map((item) => (
          <li
            key={item.label}
            className="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-800/60"
          >
            <span
              className={
                item.done
                  ? 'flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent text-white'
                  : 'h-5 w-5 shrink-0 rounded-full border-2 border-gray-300 dark:border-gray-600'
              }
            >
              {item.done && <Check size={12} strokeWidth={3} />}
            </span>
            <span
              className={
                item.done
                  ? 'flex-1 text-sm text-gray-400 line-through'
                  : 'flex-1 text-sm text-gray-700 dark:text-gray-200'
              }
            >
              {item.label}
            </span>
            {!item.done && (
              <button
                onClick={item.action}
                className="rounded-md bg-accent px-2.5 py-1 text-xs font-semibold text-white hover:bg-accent-hover"
              >
                {item.cta}
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
