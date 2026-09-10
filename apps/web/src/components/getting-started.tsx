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
    <div className="mx-auto mt-3 w-full max-w-[1000px] rounded-xl border border-line bg-hovered/50 px-3.5 py-2.5">
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
          className="rounded-lg p-1 text-ink-3 hover:bg-hovered hover:text-ink"
          aria-label={id ? 'Tutup' : 'Dismiss'}
          data-testid="getting-started-dismiss"
        >
          <X size={15} />
        </button>
      </div>

      <ul className="mt-2 space-y-0.5">
        {items.map((item) => (
          <li
            key={item.label}
            className="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-hovered"
          >
            <span
              className={
                item.done
                  ? 'flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent text-white'
                  : 'h-5 w-5 shrink-0 rounded-full border-2 border-line-strong'
              }
            >
              {item.done && <Check size={12} strokeWidth={3} />}
            </span>
            <span
              className={
                item.done
                  ? 'flex-1 text-[13px] text-ink-3 line-through'
                  : 'flex-1 text-[13px] text-ink-2'
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
