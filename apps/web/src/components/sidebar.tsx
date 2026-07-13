'use client';

import { useMemo, useState, type ChangeEvent } from 'react';
import clsx from 'clsx';
import {
  Bell,
  Bookmark,
  ChevronDown,
  Hash,
  Lock,
  LogOut,
  MessageSquare,
  Moon,
  Plus,
  Search,
  Sun,
  UserPlus,
} from 'lucide-react';
import type { ChannelDto, ConversationDto } from '@backstages/shared';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';
import { useUiStore } from '@/stores/ui-store';
import {
  keys,
  useBrowseChannels,
  useMembers,
  useNotifications,
  usePresence,
  useUnreads,
  useWorkspaces,
  type ChannelWithMeta,
  type Container,
} from '@/hooks/queries';
import { Avatar } from './avatar';
import { Dialog } from './dialog';
import { AtlassianDialog } from './atlassian-dialog';

export function Sidebar({
  workspaceId,
  container,
  onNavigate,
  channels,
  conversations,
}: {
  workspaceId: string;
  container: Container | null;
  onNavigate: (c: Container) => void;
  channels: ChannelWithMeta[];
  conversations: ConversationDto[];
}) {
  const me = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const { theme, setTheme, setRightPanel, rightPanel, setSearchOpen } = useUiStore();
  const unreads = useUnreads(workspaceId);
  const presence = usePresence(workspaceId);
  const notifications = useNotifications();
  const workspaces = useWorkspaces();
  const workspace = workspaces.data?.find((w) => w.id === workspaceId);

  const [dialog, setDialog] = useState<
    'none' | 'create-channel' | 'browse' | 'invite' | 'dm' | 'status' | 'atlassian'
  >('none');

  const unreadFor = (id: string) =>
    unreads.data?.find((u) => (u.channelId ?? u.conversationId) === id) ?? { unread: 0, mentions: 0 };

  const activityBadge = notifications.data?.unreadCount ?? 0;

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col bg-sidebar text-gray-200">
      {/* Workspace header */}
      <div className="flex items-center justify-between px-4 py-3">
        <button
          className="flex items-center gap-1 text-[15px] font-bold text-white"
          onClick={() => setDialog('atlassian')}
          title="Workspace settings (Atlassian)"
          data-testid="workspace-menu"
        >
          {workspace?.name ?? 'Workspace'} <ChevronDown size={14} className="opacity-70" />
        </button>
        {(workspace?.myRole === 'OWNER' || workspace?.myRole === 'ADMIN') && (
          <button
            title="Invite people"
            onClick={() => setDialog('invite')}
            className="rounded p-1.5 text-sidebar-muted hover:bg-sidebar-hover hover:text-white"
            data-testid="invite-button"
          >
            <UserPlus size={16} />
          </button>
        )}
      </div>

      {/* Search trigger */}
      <button
        onClick={() => setSearchOpen(true)}
        className="mx-3 mb-2 flex items-center gap-2 rounded-md border border-white/15 bg-white/5 px-2.5 py-1.5 text-[13px] text-sidebar-muted hover:bg-white/10"
        data-testid="search-trigger"
      >
        <Search size={14} /> Search… <kbd className="ml-auto text-[10px] opacity-70">⌘K</kbd>
      </button>

      <div className="thin-scrollbar flex-1 overflow-y-auto px-2 pb-2">
        {/* Fixed sections */}
        <SectionButton
          icon={<MessageSquare size={15} />}
          label="Threads"
          active={rightPanel.kind === 'thread'}
          onClick={() => setRightPanel({ kind: 'none' })}
        />
        <SectionButton
          icon={<Bell size={15} />}
          label="Activity"
          badge={activityBadge}
          active={rightPanel.kind === 'activity'}
          onClick={() => setRightPanel({ kind: 'activity' })}
          testId="activity-button"
        />
        <SectionButton
          icon={<Bookmark size={15} />}
          label="Saved items"
          active={rightPanel.kind === 'saved'}
          onClick={() => setRightPanel({ kind: 'saved' })}
          testId="saved-button"
        />

        {/* Channels */}
        <SectionHeader
          label="Channels"
          onAdd={() => setDialog('create-channel')}
          onBrowse={() => setDialog('browse')}
        />
        <ul>
          {channels.map((ch) => {
            const u = unreadFor(ch.id);
            const active = container?.kind === 'channel' && container.id === ch.id;
            return (
              <li key={ch.id}>
                <button
                  onClick={() => onNavigate({ kind: 'channel', id: ch.id })}
                  data-testid={`channel-${ch.name}`}
                  className={clsx(
                    'group flex w-full items-center gap-2 rounded-md px-2 py-1 text-[13px]',
                    active
                      ? 'bg-sidebar-active font-medium text-white'
                      : u.unread > 0
                        ? 'font-semibold text-white hover:bg-sidebar-hover'
                        : 'text-sidebar-muted hover:bg-sidebar-hover hover:text-gray-100',
                  )}
                >
                  {ch.isPrivate ? <Lock size={13} className="shrink-0" /> : <Hash size={13} className="shrink-0" />}
                  <span className="truncate">{ch.name}</span>
                  {u.mentions > 0 && (
                    <span className="ml-auto rounded-full bg-red-500 px-1.5 text-[11px] font-bold text-white">
                      {u.mentions}
                    </span>
                  )}
                  {u.mentions === 0 && u.unread > 0 && (
                    <span
                      className="ml-auto rounded-full bg-white/20 px-1.5 text-[11px] font-semibold text-white"
                      data-testid={`unread-${ch.name}`}
                    >
                      {u.unread}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>

        {/* DMs */}
        <SectionHeader label="Direct messages" onAdd={() => setDialog('dm')} />
        <ul>
          {conversations.map((dm) => {
            const others = dm.members.filter((m) => m.id !== me?.id);
            const label =
              dm.title ?? (others.length > 0 ? others.map((o) => o.displayName).join(', ') : 'You');
            const u = unreadFor(dm.id);
            const active = container?.kind === 'conversation' && container.id === dm.id;
            const first = others[0] ?? me;
            return (
              <li key={dm.id}>
                <button
                  onClick={() => onNavigate({ kind: 'conversation', id: dm.id })}
                  className={clsx(
                    'flex w-full items-center gap-2 rounded-md px-2 py-1 text-[13px]',
                    active
                      ? 'bg-sidebar-active font-medium text-white'
                      : u.unread > 0
                        ? 'font-semibold text-white hover:bg-sidebar-hover'
                        : 'text-sidebar-muted hover:bg-sidebar-hover hover:text-gray-100',
                  )}
                >
                  <Avatar
                    user={first ?? null}
                    size="xs"
                    presence={first ? (presence.data?.[first.id] ?? 'OFFLINE') : undefined}
                  />
                  <span className="truncate">{label}</span>
                  {u.unread > 0 && (
                    <span className="ml-auto rounded-full bg-red-500 px-1.5 text-[11px] font-bold text-white">
                      {u.unread}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {/* Footer: current user */}
      <div className="flex items-center gap-2 border-t border-white/10 px-3 py-2.5">
        <button onClick={() => setDialog('status')} title="Edit profile & status" className="flex min-w-0 flex-1 items-center gap-2 rounded-md p-1 hover:bg-sidebar-hover">
          <Avatar user={me} size="sm" presence={me ? (presence.data?.[me.id] ?? 'ACTIVE') : undefined} />
          <span className="min-w-0 flex-1 text-left">
            <span className="block truncate text-[13px] font-medium text-white">{me?.displayName}</span>
            {me?.statusText && (
              <span className="block truncate text-[11px] text-sidebar-muted">
                {me.statusEmoji ? `:${me.statusEmoji}: ` : ''}
                {me.statusText}
              </span>
            )}
          </span>
        </button>
        <button
          title="Toggle theme"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          className="rounded p-1.5 text-sidebar-muted hover:bg-sidebar-hover hover:text-white"
          data-testid="theme-toggle"
        >
          {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
        </button>
        <button
          title="Sign out"
          onClick={() => void logout()}
          className="rounded p-1.5 text-sidebar-muted hover:bg-sidebar-hover hover:text-white"
        >
          <LogOut size={15} />
        </button>
      </div>

      {dialog === 'create-channel' && (
        <CreateChannelDialog workspaceId={workspaceId} onClose={() => setDialog('none')} onCreated={(id) => { setDialog('none'); onNavigate({ kind: 'channel', id }); }} />
      )}
      {dialog === 'browse' && (
        <BrowseChannelsDialog workspaceId={workspaceId} onClose={() => setDialog('none')} onOpen={(id) => { setDialog('none'); onNavigate({ kind: 'channel', id }); }} />
      )}
      {dialog === 'invite' && <InviteDialog workspaceId={workspaceId} onClose={() => setDialog('none')} />}
      {dialog === 'dm' && (
        <DmPickerDialog workspaceId={workspaceId} onClose={() => setDialog('none')} onOpen={(id) => { setDialog('none'); onNavigate({ kind: 'conversation', id }); }} />
      )}
      {dialog === 'status' && <ProfileDialog onClose={() => setDialog('none')} />}
      {dialog === 'atlassian' && (
        <AtlassianDialog
          workspaceId={workspaceId}
          isAdmin={workspace?.myRole === 'OWNER' || workspace?.myRole === 'ADMIN'}
          onClose={() => setDialog('none')}
        />
      )}
    </aside>
  );
}

function SectionButton({
  icon,
  label,
  badge,
  active,
  onClick,
  testId,
}: {
  icon: React.ReactNode;
  label: string;
  badge?: number;
  active?: boolean;
  onClick: () => void;
  testId?: string;
}) {
  return (
    <button
      onClick={onClick}
      data-testid={testId}
      className={clsx(
        'flex w-full items-center gap-2 rounded-md px-2 py-1 text-[13px]',
        active ? 'bg-sidebar-active text-white' : 'text-sidebar-muted hover:bg-sidebar-hover hover:text-gray-100',
      )}
    >
      {icon}
      {label}
      {badge != null && badge > 0 && (
        <span className="ml-auto rounded-full bg-red-500 px-1.5 text-[11px] font-bold text-white">{badge}</span>
      )}
    </button>
  );
}

function SectionHeader({ label, onAdd, onBrowse }: { label: string; onAdd?: () => void; onBrowse?: () => void }) {
  return (
    <div className="mt-4 flex items-center justify-between px-2 pb-1">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-sidebar-muted">{label}</span>
      <span className="flex gap-1">
        {onBrowse && (
          <button onClick={onBrowse} title="Browse channels" className="rounded p-0.5 text-sidebar-muted hover:bg-sidebar-hover hover:text-white">
            <Search size={13} />
          </button>
        )}
        {onAdd && (
          <button onClick={onAdd} title="Add" data-testid={`add-${label.toLowerCase().replace(/\s/g, '-')}`} className="rounded p-0.5 text-sidebar-muted hover:bg-sidebar-hover hover:text-white">
            <Plus size={13} />
          </button>
        )}
      </span>
    </div>
  );
}

// ---------- dialogs ----------

function CreateChannelDialog({
  workspaceId,
  onClose,
  onCreated,
}: {
  workspaceId: string;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <Dialog title="Create a channel" onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            const ch = await api<{ id: string }>('POST', `/workspaces/${workspaceId}/channels`, {
              name: name.toLowerCase().replace(/\s+/g, '-'),
              isPrivate,
            });
            await qc.invalidateQueries({ queryKey: keys.channels(workspaceId) });
            onCreated(ch.id);
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed');
          }
        }}
      >
        {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
        <input
          className="mb-3 w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-accent dark:border-gray-700 dark:bg-gray-800"
          placeholder="e.g. project-launch"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          autoFocus
          data-testid="new-channel-name"
        />
        <label className="mb-3 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} />
          Make private (invitation only)
        </label>
        <button type="submit" data-testid="new-channel-create" className="w-full rounded-md bg-accent px-3 py-2 text-sm font-semibold text-white hover:bg-accent-hover">
          Create channel
        </button>
      </form>
    </Dialog>
  );
}

function BrowseChannelsDialog({
  workspaceId,
  onClose,
  onOpen,
}: {
  workspaceId: string;
  onClose: () => void;
  onOpen: (id: string) => void;
}) {
  const qc = useQueryClient();
  const browse = useBrowseChannels(workspaceId);
  const [filter, setFilter] = useState('');

  const list = useMemo(
    () => (browse.data ?? []).filter((c) => c.name.includes(filter.toLowerCase())),
    [browse.data, filter],
  );

  return (
    <Dialog title="Browse channels" onClose={onClose} wide>
      <input
        className="mb-3 w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-accent dark:border-gray-700 dark:bg-gray-800"
        placeholder="Filter channels"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        autoFocus
      />
      <ul className="divide-y divide-gray-100 dark:divide-gray-800">
        {list.map((ch) => (
          <li key={ch.id} className="flex items-center justify-between py-2">
            <div>
              <div className="flex items-center gap-1.5 text-sm font-medium">
                {ch.isPrivate ? <Lock size={13} /> : <Hash size={13} />}
                {ch.name}
                {ch.isArchived && <span className="text-xs text-gray-400">(archived)</span>}
              </div>
              <div className="text-xs text-gray-500">
                {ch.memberCount} member{ch.memberCount === 1 ? '' : 's'}
                {ch.topic ? ` · ${ch.topic}` : ''}
              </div>
            </div>
            {ch.isMember ? (
              <button onClick={() => onOpen(ch.id)} className="rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-800">
                Open
              </button>
            ) : (
              <button
                onClick={async () => {
                  await api('POST', `/channels/${ch.id}/join`);
                  await qc.invalidateQueries({ queryKey: keys.channels(workspaceId) });
                  await qc.invalidateQueries({ queryKey: keys.browse(workspaceId) });
                  onOpen(ch.id);
                }}
                className="rounded-md bg-accent px-2.5 py-1 text-xs font-semibold text-white hover:bg-accent-hover"
              >
                Join
              </button>
            )}
          </li>
        ))}
        {list.length === 0 && <li className="py-4 text-center text-sm text-gray-500">No channels found</li>}
      </ul>
    </Dialog>
  );
}

function InviteDialog({ workspaceId, onClose }: { workspaceId: string; onClose: () => void }) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'MEMBER' | 'ADMIN' | 'GUEST'>('MEMBER');
  const [result, setResult] = useState<{ url: string; email: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const create = async (withEmail: boolean) => {
    setError(null);
    try {
      const invite = await api<{ url: string; email: string | null }>(
        'POST',
        `/workspaces/${workspaceId}/invites`,
        withEmail ? { email, role } : { role },
      );
      setResult(invite);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    }
  };

  return (
    <Dialog title="Invite people" onClose={onClose}>
      {result ? (
        <div>
          <p className="mb-2 text-sm">
            {result.email ? `Invite emailed to ${result.email}.` : 'Shareable invite link created:'}
          </p>
          <code className="block break-all rounded-md bg-gray-100 p-2 text-xs dark:bg-gray-800" data-testid="invite-url">
            {result.url}
          </code>
          <button onClick={() => setResult(null)} className="mt-3 text-sm text-accent hover:underline">
            Create another
          </button>
        </div>
      ) : (
        <div>
          {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
          <input
            className="mb-2 w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-accent dark:border-gray-700 dark:bg-gray-800"
            placeholder="colleague@company.com"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as typeof role)}
            className="mb-3 w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800"
          >
            <option value="MEMBER">Member</option>
            <option value="ADMIN">Admin</option>
            <option value="GUEST">Guest (explicit channels only)</option>
          </select>
          <div className="flex gap-2">
            <button
              onClick={() => void create(true)}
              disabled={!email}
              className="flex-1 rounded-md bg-accent px-3 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
            >
              Send email invite
            </button>
            <button
              onClick={() => void create(false)}
              data-testid="create-invite-link"
              className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm font-medium hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-800"
            >
              Create link
            </button>
          </div>
        </div>
      )}
    </Dialog>
  );
}

function DmPickerDialog({
  workspaceId,
  onClose,
  onOpen,
}: {
  workspaceId: string;
  onClose: () => void;
  onOpen: (id: string) => void;
}) {
  const me = useAuthStore((s) => s.user);
  const members = useMembers(workspaceId);
  const [selected, setSelected] = useState<string[]>([]);
  const [filter, setFilter] = useState('');

  const candidates = (members.data ?? []).filter(
    (m) =>
      m.user.id !== me?.id &&
      !m.deactivatedAt &&
      m.user.displayName.toLowerCase().includes(filter.toLowerCase()),
  );

  return (
    <Dialog title="New direct message" onClose={onClose}>
      <input
        className="mb-2 w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-accent dark:border-gray-700 dark:bg-gray-800"
        placeholder="Search people"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        autoFocus
      />
      <ul className="mb-3 max-h-60 overflow-y-auto">
        {candidates.map((m) => (
          <li key={m.user.id}>
            <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-gray-50 dark:hover:bg-gray-800">
              <input
                type="checkbox"
                checked={selected.includes(m.user.id)}
                onChange={(e) =>
                  setSelected((s) =>
                    e.target.checked ? [...s, m.user.id] : s.filter((id) => id !== m.user.id),
                  )
                }
              />
              <Avatar user={m.user} size="sm" />
              <span>{m.user.displayName}</span>
              {m.user.isProvisional && (
                <span className="rounded bg-amber-100 px-1 text-[10px] font-medium text-amber-700 dark:bg-amber-900 dark:text-amber-300">
                  provisional
                </span>
              )}
            </label>
          </li>
        ))}
      </ul>
      <button
        disabled={selected.length === 0 || selected.length > 8}
        onClick={async () => {
          const dm = await api<{ id: string }>('POST', `/workspaces/${workspaceId}/conversations`, {
            memberIds: selected,
          });
          onOpen(dm.id);
        }}
        className="w-full rounded-md bg-accent px-3 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
      >
        Start conversation {selected.length > 1 ? `(group of ${selected.length + 1})` : ''}
      </button>
    </Dialog>
  );
}

function ProfileDialog({ onClose }: { onClose: () => void }) {
  const me = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const [name, setName] = useState(me?.displayName ?? '');
  const [emoji, setEmoji] = useState(me?.statusEmoji ?? '');
  const [text, setText] = useState(me?.statusText ?? '');
  const [presenceState, setPresenceState] = useState<'ACTIVE' | 'AWAY' | 'DND'>('ACTIVE');
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onPickPhoto = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const user = await api<typeof me>('POST', '/me/avatar', undefined, { formData: fd });
      if (user) setUser(user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      if (name.trim() && name.trim() !== me?.displayName) {
        await api('PATCH', '/me/profile', { displayName: name.trim() });
      }
      const user = await api<typeof me>('PATCH', '/me/status', {
        statusEmoji: emoji || null,
        statusText: text || null,
      });
      await api('PATCH', '/me/presence', { state: presenceState });
      if (user) setUser(user);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
      setSaving(false);
    }
  };

  const inputCls =
    'w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-accent dark:border-gray-700 dark:bg-gray-800';

  return (
    <Dialog title="Edit profile" onClose={onClose}>
      {error && <p className="mb-2 text-sm text-red-600">{error}</p>}

      <div className="mb-4 flex items-center gap-3">
        <Avatar user={me} size="lg" />
        <label className="cursor-pointer rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-800">
          {uploading ? 'Uploading…' : 'Change photo'}
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => void onPickPhoto(e)}
            disabled={uploading}
            data-testid="avatar-input"
          />
        </label>
      </div>

      <label className="mb-1 block text-xs font-medium text-gray-500">Display name</label>
      <input
        className={clsx(inputCls, 'mb-3')}
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Your name"
        data-testid="profile-name"
      />

      <label className="mb-1 block text-xs font-medium text-gray-500">Status</label>
      <div className="mb-3 flex gap-2">
        <input
          className={clsx(inputCls, 'w-20')}
          placeholder=":emoji:"
          value={emoji}
          onChange={(e) => setEmoji(e.target.value.replace(/:/g, ''))}
        />
        <input
          className={clsx(inputCls, 'flex-1')}
          placeholder="What's your status?"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </div>

      <div className="mb-4 flex gap-3 text-sm">
        {(['ACTIVE', 'AWAY', 'DND'] as const).map((s) => (
          <label key={s} className="flex items-center gap-1">
            <input type="radio" checked={presenceState === s} onChange={() => setPresenceState(s)} />
            {s === 'ACTIVE' ? 'Active' : s === 'AWAY' ? 'Away' : 'Do not disturb'}
          </label>
        ))}
      </div>

      <button
        onClick={() => void save()}
        disabled={saving}
        className="w-full rounded-md bg-accent px-3 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
        data-testid="profile-save"
      >
        {saving ? 'Saving…' : 'Save'}
      </button>
    </Dialog>
  );
}
