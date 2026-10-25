'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import {
  Bell,
  Check,
  ChevronDown,
  Headphones,
  Plus,
  Search,
  Settings,
  UserPlus,
} from 'lucide-react';
import type { ConversationDto } from '@backstages/shared';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import {
  keys,
  useNotifications,
  type ChannelWithMeta,
  type Container,
  type WorkspaceWithRole,
} from '@/hooks/queries';
import type { HuddleController } from '@/hooks/use-huddle';
import { useAuthStore } from '@/stores/auth-store';
import { useUiStore } from '@/stores/ui-store';
import { Avatar } from './avatar';
import { BrandMark } from './brand-mark';
import { Dialog } from './dialog';
import { JoinWorkspaceSection } from './join-workspace-section';
import { Tooltip } from './tooltip';

/** Open one of the Sidebar's dialogs (it owns them) by name. */
function openSidebarDialog(name: string) {
  window.dispatchEvent(new CustomEvent('bs:open-dialog', { detail: name }));
}

/**
 * The marquee: the bar across the top of the app. Workspace switcher on the
 * left, what's live right now (huddles you could join) in the middle, and
 * search / activity / invite on the right.
 */
export function StageMarquee({
  workspaces,
  activeId,
  onSelectWorkspace,
  huddle,
  channels,
  conversations,
  onNavigate,
  searchRef,
}: {
  workspaces: WorkspaceWithRole[];
  activeId: string;
  onSelectWorkspace: (id: string) => void;
  huddle: HuddleController;
  channels: ChannelWithMeta[];
  conversations: ConversationDto[];
  onNavigate: (c: Container) => void;
  /** The search button, so the sidebar's guided tour can point at it. */
  searchRef: React.RefObject<HTMLButtonElement>;
}) {
  const { setCommandOpen, openInbox, mainView, inboxTab } = useUiStore();
  const activityOpen = mainView === 'inbox' && inboxTab === 'activity';
  const notifications = useNotifications();
  const workspace = workspaces.find((w) => w.id === activeId);
  const isAdmin = workspace?.myRole === 'OWNER' || workspace?.myRole === 'ADMIN';
  const activityBadge = notifications.data?.unreadCount ?? 0;

  // Platform-aware shortcut hint, resolved after mount (stable SSR output).
  const [modKey, setModKey] = useState('⌘K');
  useEffect(() => {
    const mac = /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);
    setModKey(mac ? '⌘K' : 'Ctrl K');
  }, []);

  return (
    <header
      className="flex h-12 shrink-0 items-center gap-2 px-2 sm:gap-3 sm:px-3"
      data-testid="stage-marquee"
    >
      <WorkspaceSwitcher
        workspaces={workspaces}
        active={workspace}
        isAdmin={isAdmin}
        onSelect={onSelectWorkspace}
      />

      <div className="flex min-w-0 flex-1 justify-center">
        <LiveHuddles
          huddle={huddle}
          channels={channels}
          conversations={conversations}
          onNavigate={onNavigate}
        />
      </div>

      <button
        ref={searchRef}
        onClick={() => setCommandOpen(true)}
        className="flex h-8 items-center gap-2 rounded-lg border border-line bg-surface/70 px-2.5 text-[13px] text-ink-3 shadow-soft transition-colors hover:border-line-strong hover:text-ink-2 lg:w-60"
        data-testid="search-trigger"
        aria-label="Search or jump to"
      >
        <Search size={14} className="shrink-0" />
        <span className="hidden truncate lg:inline">Search or jump to…</span>
        <kbd className="kbd ml-auto hidden lg:inline-flex">{modKey}</kbd>
      </button>

      <Tooltip label="Activity">
        <button
          onClick={() => {
            openInbox('activity');
            useUiStore.getState().toggleSidebar(false);
          }}
          className={clsx('icon-btn relative h-8 w-8', activityOpen && 'bg-hovered text-ink')}
          aria-label={activityBadge > 0 ? `Activity (${activityBadge})` : 'Activity'}
          data-testid="marquee-activity"
        >
          <Bell size={16} />
          {activityBadge > 0 && (
            <span className="absolute -right-0.5 -top-0.5 min-w-[16px] rounded-full bg-red-500 px-1 text-center text-[10px] font-semibold leading-4 text-white">
              {activityBadge > 99 ? '99+' : activityBadge}
            </span>
          )}
        </button>
      </Tooltip>

      {isAdmin && (
        <Tooltip label="Invite people">
          <button
            onClick={() => openSidebarDialog('invite')}
            className="icon-btn h-8 w-8"
            aria-label="Invite people"
            data-testid="invite-button"
          >
            <UserPlus size={16} />
          </button>
        </Tooltip>
      )}
    </header>
  );
}

function WorkspaceSwitcher({
  workspaces,
  active,
  isAdmin,
  onSelect,
}: {
  workspaces: WorkspaceWithRole[];
  active: WorkspaceWithRole | undefined;
  isAdmin: boolean;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const choose = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };

  return (
    <div ref={ref} className="relative min-w-0 shrink-0">
      <button
        onClick={() => setOpen((o) => !o)}
        className="group flex min-w-0 max-w-[46vw] items-center gap-2.5 rounded-lg px-1.5 py-1 text-left transition-colors hover:bg-hovered sm:max-w-[240px]"
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid="workspace-menu"
      >
        <BrandMark size={28} />
        <span className="min-w-0">
          <span className="flex items-center gap-1 text-[14px] font-semibold leading-tight tracking-tight text-ink">
            <span className="truncate">{active?.name ?? 'Workspace'}</span>
            <ChevronDown
              size={14}
              className={clsx('shrink-0 text-ink-3 transition-transform', open && 'rotate-180')}
            />
          </span>
          <span className="block text-[11px] leading-tight text-ink-3">Backstages</span>
        </span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute left-0 top-full z-50 mt-1.5 w-72 rounded-xl border border-line bg-overlay p-1.5 text-[13px] shadow-pop"
          data-testid="workspace-switcher-menu"
        >
          <div className="px-2 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-3">
            Workspaces
          </div>
          <ul className="thin-scrollbar max-h-64 overflow-y-auto">
            {workspaces.map((ws) => {
              const current = ws.id === active?.id;
              return (
                <li key={ws.id}>
                  <button
                    role="menuitem"
                    onClick={choose(() => onSelect(ws.id))}
                    className={clsx(
                      'flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-hovered',
                      current ? 'font-medium text-ink' : 'text-ink-2',
                    )}
                    aria-current={current ? 'true' : undefined}
                  >
                    <span
                      className={clsx(
                        'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[12px] font-semibold',
                        current
                          ? 'bg-accent text-white'
                          : 'border border-line bg-surface text-ink-2',
                      )}
                    >
                      {ws.name.slice(0, 1).toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{ws.name}</span>
                    {current && <Check size={15} className="shrink-0 text-accent" />}
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="my-1.5 h-px bg-line" />
          <MenuItem
            icon={<Settings size={15} />}
            label="Workspace settings"
            onClick={choose(() => openSidebarDialog('settings'))}
          />
          {isAdmin && (
            <MenuItem
              icon={<UserPlus size={15} />}
              label="Invite people"
              onClick={choose(() => openSidebarDialog('invite'))}
            />
          )}
          <MenuItem
            icon={<Plus size={15} />}
            label="Add a workspace"
            onClick={choose(() => setAdding(true))}
            testId="add-workspace"
          />
        </div>
      )}

      {adding && (
        <AddWorkspaceDialog
          onClose={() => setAdding(false)}
          onDone={(id) => {
            setAdding(false);
            onSelect(id);
          }}
        />
      )}
    </div>
  );
}

function MenuItem({
  icon,
  label,
  onClick,
  testId,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  testId?: string;
}) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-ink-2 hover:bg-hovered hover:text-ink"
      data-testid={testId}
    >
      <span className="flex w-7 justify-center text-ink-3">{icon}</span>
      {label}
    </button>
  );
}

/** Create a new workspace, or join one by invite (formerly on the workspace rail). */
function AddWorkspaceDialog({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: (id: string) => void;
}) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const qc = useQueryClient();

  return (
    <Dialog title="Add a workspace" onClose={onClose}>
      <h3 className="mb-2 text-sm font-semibold text-ink">Create a new workspace</h3>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            const ws = await api<{ id: string }>('POST', '/workspaces', { name });
            await qc.invalidateQueries({ queryKey: keys.workspaces });
            onDone(ws.id);
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not create the workspace.');
            setBusy(false);
          }
        }}
      >
        <input
          className="mb-3 w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent"
          placeholder="Workspace name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          autoFocus
        />
        <button type="submit" disabled={busy} className="btn-primary w-full py-2 text-sm">
          {busy ? 'Creating…' : 'Create'}
        </button>
      </form>
      <div className="my-4 flex items-center gap-3">
        <span className="h-px flex-1 bg-line" />
        <span className="text-xs text-ink-3">or join one</span>
        <span className="h-px flex-1 bg-line" />
      </div>
      {error && <p className="mb-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
      <JoinWorkspaceSection onJoined={onDone} onError={setError} />
    </Dialog>
  );
}

/**
 * "Live huddle in #release-crew · 3 on stage [Join]": every huddle running in a
 * channel or DM you can see, except the one you're already in.
 */
function LiveHuddles({
  huddle,
  channels,
  conversations,
  onNavigate,
}: {
  huddle: HuddleController;
  channels: ChannelWithMeta[];
  conversations: ConversationDto[];
  onNavigate: (c: Container) => void;
}) {
  const meId = useAuthStore((s) => s.user?.id);
  const live = useMemo(() => {
    const out: { target: Container; label: string; people: HuddleController['participants'] }[] =
      [];
    for (const [id, people] of Object.entries(huddle.participantsByContainer)) {
      if (people.length === 0) continue;
      if (huddle.joined && huddle.activeTarget?.id === id) continue;
      const ch = channels.find((c) => c.id === id);
      if (ch) {
        out.push({ target: { kind: 'channel', id }, label: `#${ch.name}`, people });
        continue;
      }
      const dm = conversations.find((c) => c.id === id);
      if (dm) {
        const others = dm.members.filter((m) => m.id !== meId);
        out.push({
          target: { kind: 'conversation', id },
          label: dm.title ?? (others.map((o) => o.displayName).join(', ') || 'a DM'),
          people,
        });
      }
    }
    return out.sort((a, b) => b.people.length - a.people.length);
  }, [
    huddle.participantsByContainer,
    huddle.joined,
    huddle.activeTarget?.id,
    channels,
    conversations,
    meId,
  ]);

  if (live.length === 0) return null;
  const top = live[0];
  const more = live.length - 1;

  return (
    <div
      className="flex min-w-0 items-center gap-2 rounded-full border border-emerald-500/25 bg-emerald-500/10 py-1 pl-3 pr-1 text-[12.5px] text-ink animate-fade-in"
      data-testid="marquee-live-huddle"
    >
      <span className="live-dot shrink-0" aria-hidden />
      <button
        onClick={() => onNavigate(top.target)}
        className="hidden min-w-0 truncate hover:underline sm:inline"
        title={`Go to ${top.label}`}
      >
        <span className="font-semibold">Live huddle</span> in {top.label}
        <span className="text-ink-2"> · {top.people.length} on stage</span>
        {more > 0 && <span className="text-ink-3"> · +{more} more</span>}
      </button>
      <span className="hidden shrink-0 -space-x-1.5 md:flex">
        {top.people.slice(0, 3).map((p) => (
          <Avatar
            key={p.userId}
            user={{ id: p.userId, displayName: p.displayName, avatarUrl: p.avatarUrl }}
            size="xs"
            className="rounded-md ring-2 ring-canvas"
          />
        ))}
      </span>
      <button
        onClick={() => void huddle.join(top.target)}
        className="flex shrink-0 items-center gap-1 rounded-full bg-emerald-500 px-2.5 py-0.5 text-[12px] font-semibold text-white hover:bg-emerald-600"
        data-testid="marquee-join-huddle"
      >
        <Headphones size={12} /> Join
      </button>
    </div>
  );
}
