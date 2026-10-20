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
    <div className="mx-auto mt-2 w-[calc(100%-1.5rem)] max-w-[1000px] rounded-lg border border-line bg-surface px-3 py-2 shadow-soft">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Rocket size={14} className="shrink-0 text-accent" />
          <h3 className="text-[13px] font-semibold text-ink">{id ? 'Mulai di sini' : 'Get started'}</h3>
          <span className="text-[11px] text-ink-3">
            {doneCount}/{items.length}
          </span>
          <div className="ml-2 hidden h-1 w-24 overflow-hidden rounded-full bg-line sm:block">
            <div
              className="h-full rounded-full bg-accent transition-all"
              style={{ width: `${(doneCount / items.length) * 100}%` }}
            />
          </div>
        </div>
        <button
          onClick={dismiss}
          className="icon-btn p-1"
          aria-label={id ? 'Tutup' : 'Dismiss'}
          data-testid="getting-started-dismiss"
        >
          <X size={15} />
        </button>
      </div>

      <ul className="no-scrollbar mt-2 flex gap-1.5 overflow-x-auto sm:flex-wrap">
        {items.map((item) => (
          <li
            key={item.label}
            className="flex shrink-0 items-center gap-2 whitespace-nowrap rounded-md border border-line bg-canvas/60 py-1 pl-2 pr-1"
          >
            <span
              className={
                item.done
                  ? 'flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-accent text-white'
                  : 'h-4 w-4 shrink-0 rounded-full border-[1.5px] border-line-strong'
              }
            >
              {item.done && <Check size={10} strokeWidth={3} />}
            </span>
            <span
              className={
                item.done
                  ? 'pr-1 text-[12.5px] text-ink-3 line-through'
                  : 'text-[12.5px] text-ink-2'
              }
            >
              {item.label}
            </span>
            {!item.done && (
              <button
                onClick={item.action}
                className="rounded px-1.5 py-0.5 text-[12px] font-medium text-accent hover:bg-accent/10"
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
