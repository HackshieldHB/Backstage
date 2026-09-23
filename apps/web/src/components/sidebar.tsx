'use client';

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import clsx from 'clsx';
import {
  BarChart3,
  Bell,
  Bookmark,
  Briefcase,
  CalendarClock,
  ChevronDown,
  ClipboardCheck,
  Clock,
  Webhook,
  FileText,
  Inbox,
  Compass,
  ScrollText,
  Siren,
  SquareKanban,
  UsersRound,
  Hash,
  Lock,
  LogOut,
  MessageSquare,
  Plus,
  Search,
  Smile,
  Sparkles,
  Timer,
  UserPlus,
  Zap,
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
import { emojiChar } from '@/lib/emoji';
import { useT } from '@/lib/i18n';
import { Avatar } from './avatar';
import { Dialog } from './dialog';
import { EmojiPickerPopover } from './emoji-picker';
import { useAtlassianStatus } from './atlassian-dialog';
import { AvailabilityDialog } from './availability-dialog';
import { WorkspaceSettingsDialog } from './workspace-settings-dialog';
import { CatchUpDialog } from './catch-up-dialog';
import { ScheduledDialog } from './scheduled-dialog';
import { StandupsDialog } from './standups-dialog';
import { IntegrationsDialog } from './integrations-dialog';
import { DecisionsDialog } from './decisions-dialog';
import { WeeklyReportsDialog } from './weekly-reports-dialog';
import { ThemePicker } from './theme-picker';
import { WellbeingCard, FocusCard, DigestToggle, CalendarLink } from './wellbeing-card';
import { WorkflowsDialog } from './workflows-dialog';
import { UserGroupsDialog, AnalyticsDialog, AuditDialog } from './workspace-admin';
import { Tooltip } from './tooltip';
import { GuidedTour, type TourStep } from './guided-tour';

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
  const { setRightPanel, rightPanel, setCommandOpen, mainView, setMainView, lang } = useUiStore();
  const unreads = useUnreads(workspaceId);
  const presence = usePresence(workspaceId);
  const notifications = useNotifications();
  const atlassian = useAtlassianStatus(workspaceId);
  const workspaces = useWorkspaces();
  const workspace = workspaces.data?.find((w) => w.id === workspaceId);

  const [dialog, setDialog] = useState<
    'none' | 'create-channel' | 'browse' | 'invite' | 'dm' | 'status' | 'availability' | 'settings' | 'catch-up' | 'scheduled' | 'workflows' | 'user-groups' | 'analytics' | 'audit' | 'standups' | 'integrations' | 'decisions' | 'weekly-reports' | 'work-dashboard'
  >('none');
  const isAdmin = workspace?.myRole === 'OWNER' || workspace?.myRole === 'ADMIN';

  // Let other surfaces (e.g. the getting-started checklist in the main pane)
  // open one of the sidebar's dialogs by name via a window event.
  useEffect(() => {
    const onOpenDialog = (e: Event) => {
      const name = (e as CustomEvent<string>).detail;
      setDialog(name as Parameters<typeof setDialog>[0]);
    };
    window.addEventListener('bs:open-dialog', onOpenDialog);
    return () => window.removeEventListener('bs:open-dialog', onOpenDialog);
  }, []);

  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  // Platform-aware search shortcut hint (⌘K on Mac, Ctrl K elsewhere). Resolved
  // after mount to keep SSR output stable and avoid a hydration mismatch.
  const [modKey, setModKey] = useState('⌘K');
  useEffect(() => {
    const mac = /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);
    setModKey(mac ? '⌘K' : 'Ctrl K');
  }, []);
  const catchUpRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLButtonElement>(null);
  const threadsRef = useRef<HTMLButtonElement>(null);
  const activityRef = useRef<HTMLButtonElement>(null);
  const timelineRef = useRef<HTMLButtonElement>(null);
  const channelsRef = useRef<HTMLDivElement>(null);
  const t = useT();

  const unreadFor = (id: string) =>
    unreads.data?.find((u) => (u.channelId ?? u.conversationId) === id) ?? { unread: 0, mentions: 0 };

  const activityBadge = notifications.data?.unreadCount ?? 0;

  const ungroupedChannels = useMemo(() => channels.filter((c) => !c.groupKey), [channels]);
  const groupedChannels = useMemo(() => {
    const g: Record<string, ChannelWithMeta[]> = {};
    for (const c of channels) if (c.groupKey) (g[c.groupKey] ??= []).push(c);
    return g;
  }, [channels]);
  const groupKeys = useMemo(() => Object.keys(groupedChannels).sort(), [groupedChannels]);

  // First-run walkthrough of the left menu. Each step spotlights a real button,
  // so the copy points at exactly what the user is looking at. Anchors chosen
  // are always present (never behind an integration/admin flag) so no step is
  // ever skipped for a plain member.
  const id = lang === 'id';
  const tourSteps: TourStep[] = [
    {
      title: id ? 'Selamat datang di Backstages 👋' : 'Welcome to Backstages 👋',
      body: id
        ? 'Kenalan sebentar yuk dengan menu di kiri — 30 detik, sekali saja. Bisa dilewati kapan pun.'
        : "Let's take 30 seconds to meet the left menu — just once. You can skip anytime.",
    },
    {
      anchorRef: searchRef,
      title: id ? 'Cari apa saja' : 'Find anything',
      body: id
        ? 'Cari pesan, orang, channel, dan file dari satu tempat. Tekan ⌘K / Ctrl+K kapan saja.'
        : 'Search messages, people, channels and files from one place. Hit ⌘K / Ctrl+K anytime.',
    },
    {
      anchorRef: threadsRef,
      title: id ? 'Utas' : 'Threads',
      body: id
        ? 'Semua balasan utas yang kamu ikuti berkumpul di sini — jadi tidak ada diskusi yang terlewat.'
        : 'Every threaded reply you follow collects here, so no side conversation slips past you.',
    },
    {
      anchorRef: activityRef,
      title: id ? 'Aktivitas' : 'Activity',
      body: id
        ? 'Mention, reaksi, dan update Jira yang ditujukan ke kamu — lencana merah menandai yang belum dibaca.'
        : 'Mentions, reactions and Jira updates aimed at you — the red badge counts what is unread.',
    },
    {
      anchorRef: catchUpRef,
      title: id ? 'Rangkum untukku' : 'Catch me up',
      body: id
        ? 'Baru kembali? Dapatkan ringkasan sekali klik — mention dulu, lalu channel & DM tersibuk.'
        : 'Been away? Get a one-click digest — mentions first, then your busiest channels and DMs.',
    },
    {
      anchorRef: timelineRef,
      title: id ? 'Timeline tim' : 'Team timeline',
      body: id
        ? 'Di grup "Alat": lini masa transparan berisi huddle, aktivitas Jira/Confluence, dan kehadiran tim — plus dashboard utilisasi.'
        : 'Under "Tools": a transparent feed of huddles, Jira/Confluence activity and presence — plus a utilization dashboard.',
    },
    {
      anchorRef: channelsRef,
      title: id ? 'Channel & DM' : 'Channels & DMs',
      body: id
        ? 'Percakapanmu tinggal di sini. Tekan + untuk buat channel atau mulai DM. Selamat menjelajah!'
        : 'Your conversations live here. Use + to create a channel or start a DM. Enjoy exploring!',
    },
  ];

  return (
    <aside className="sidebar-surface flex h-full w-64 shrink-0 flex-col border-r border-line text-ink">
      {/* Workspace header */}
      <div className="flex items-center justify-between px-4 py-3">
        <button
          className="flex items-center gap-1 text-[15px] font-bold text-ink"
          onClick={() => setDialog('settings')}
          title="Workspace settings"
          data-testid="workspace-menu"
        >
          {workspace?.name ?? 'Workspace'} <ChevronDown size={14} className="opacity-70" />
        </button>
        {(workspace?.myRole === 'OWNER' || workspace?.myRole === 'ADMIN') && (
          <button
            title="Invite people"
            onClick={() => setDialog('invite')}
            className="rounded p-1.5 text-ink-3 hover:bg-hovered hover:text-ink"
            data-testid="invite-button"
          >
            <UserPlus size={16} />
          </button>
        )}
      </div>

      {/* Command palette launcher (search + jump + run) */}
      <button
        ref={searchRef}
        onClick={() => setCommandOpen(true)}
        className="mx-3 mb-3 flex items-center gap-2 rounded-lg border border-line bg-hovered px-2.5 py-2 text-[13px] text-ink-2 transition-colors hover:border-line-strong hover:text-ink"
        data-testid="search-trigger"
      >
        <Search size={14} className="text-ink-3" /> Search or jump to…
        <kbd className="ml-auto rounded border border-line px-1 py-0.5 text-[10px] text-ink-3">{modKey}</kbd>
      </button>

      <div className="thin-scrollbar flex-1 overflow-y-auto px-2 pb-2">
        {/* Primary quick-access */}
        <SectionButton
          icon={<Inbox size={15} />}
          label={t('inbox')}
          badge={activityBadge}
          active={mainView === 'inbox'}
          onClick={() => setMainView('inbox')}
          testId="inbox-button"
        />
        <SectionButton
          icon={<Compass size={15} />}
          label="Discover"
          active={mainView === 'discover'}
          onClick={() => setMainView('discover')}
          testId="discover-button"
        />
        <SectionButton
          icon={<MessageSquare size={15} />}
          label={t('threads')}
          active={rightPanel.kind === 'threads' || rightPanel.kind === 'thread'}
          onClick={() => setRightPanel({ kind: 'threads' })}
          testId="threads-button"
          buttonRef={threadsRef}
        />
        <SectionButton
          icon={<Bell size={15} />}
          label={t('activity')}
          badge={activityBadge}
          active={rightPanel.kind === 'activity'}
          onClick={() => setRightPanel({ kind: 'activity' })}
          testId="activity-button"
          buttonRef={activityRef}
        />
        <SectionButton
          icon={<Bookmark size={15} />}
          label={t('later')}
          active={rightPanel.kind === 'saved'}
          onClick={() => setRightPanel({ kind: 'saved' })}
          testId="saved-button"
        />
        <SectionButton
          icon={<Sparkles size={15} />}
          label={t('catch_me_up')}
          onClick={() => setDialog('catch-up')}
          testId="catch-up-button"
          buttonRef={catchUpRef}
        />

        {/* Insights — data views that replace the chat pane */}
        <NavGroup id="insights" label={t('insights')}>
          {atlassian.data?.connected && (
            <SectionButton
              icon={<SquareKanban size={15} />}
              label="Jira"
              active={mainView === 'jira'}
              onClick={() => setMainView('jira')}
              testId="jira-view-button"
            />
          )}
          {atlassian.data?.connected && atlassian.data.confluenceReady && (
            <SectionButton
              icon={<FileText size={15} />}
              label="Confluence"
              active={mainView === 'confluence'}
              onClick={() => setMainView('confluence')}
              testId="confluence-view-button"
            />
          )}
          <SectionButton
            icon={<Timer size={15} />}
            label={t('team_timeline')}
            active={mainView === 'timeline'}
            onClick={() => setMainView('timeline')}
            testId="timeline-button"
            buttonRef={timelineRef}
          />
          {isAdmin && (
            <SectionButton
              icon={<Briefcase size={15} />}
              label={t('clients_projects')}
              active={mainView === 'projects'}
              onClick={() => setMainView('projects')}
              testId="projects-button"
            />
          )}
          <SectionButton
            icon={<Siren size={15} />}
            label={t('incidents')}
            active={mainView === 'incidents'}
            onClick={() => setMainView('incidents')}
            testId="incidents-button"
          />
        </NavGroup>

        {/* Productivity — actions and recurring work */}
        <NavGroup id="productivity" label={t('productivity')}>
          <SectionButton
            icon={<CalendarClock size={15} />}
            label={t('standups')}
            onClick={() => setDialog('standups')}
            testId="standups-button"
          />
          <SectionButton
            icon={<ClipboardCheck size={15} />}
            label={t('decisions')}
            onClick={() => setDialog('decisions')}
            testId="decisions-button"
          />
          <SectionButton
            icon={<BarChart3 size={15} />}
            label={t('weekly_reports')}
            onClick={() => setDialog('weekly-reports')}
            testId="weekly-reports-button"
          />
          <SectionButton
            icon={<Zap size={15} />}
            label={t('workflows')}
            onClick={() => setDialog('workflows')}
            testId="workflows-button"
          />
          <SectionButton
            icon={<Clock size={15} />}
            label={t('scheduled')}
            onClick={() => setDialog('scheduled')}
            testId="scheduled-button"
          />
        </NavGroup>

        {/* Workspace — configuration & admin */}
        <NavGroup id="workspace" label={t('workspace_group')} defaultOpen={false}>
          <SectionButton
            icon={<Webhook size={15} />}
            label={t('integrations')}
            onClick={() => setDialog('integrations')}
            testId="integrations-button"
          />
          <SectionButton
            icon={<UsersRound size={15} />}
            label={t('user_groups')}
            onClick={() => setDialog('user-groups')}
            testId="user-groups-button"
          />
          {isAdmin && (
            <>
              <SectionButton
                icon={<BarChart3 size={15} />}
                label={t('analytics')}
                onClick={() => setDialog('analytics')}
                testId="analytics-button"
              />
              <SectionButton
                icon={<ScrollText size={15} />}
                label={t('audit_log')}
                onClick={() => setDialog('audit')}
                testId="audit-button"
              />
            </>
          )}
        </NavGroup>

        {/* Channels */}
        <SectionHeader
          label={t('channels')}
          testIdKey="channels"
          browseTitle={t('browse_channels')}
          addTitle={t('add')}
          headerRef={channelsRef}
          onAdd={() => setDialog('create-channel')}
          onBrowse={() => setDialog('browse')}
        />
        <ul>
          {ungroupedChannels.map((ch) => (
            <ChannelRow
              key={ch.id}
              ch={ch}
              active={container?.kind === 'channel' && container.id === ch.id}
              unread={unreadFor(ch.id)}
              onClick={() => onNavigate({ kind: 'channel', id: ch.id })}
            />
          ))}
        </ul>

        {/* Integration channel groups (Jira / Confluence) */}
        {groupKeys.map((gk) => {
          const collapsed = collapsedGroups[gk];
          return (
            <div key={gk}>
              <button
                onClick={() => setCollapsedGroups((s) => ({ ...s, [gk]: !s[gk] }))}
                className="mt-4 flex w-full items-center gap-1 px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-3 hover:text-ink"
              >
                <ChevronDown
                  size={12}
                  className={clsx('transition-transform', collapsed && '-rotate-90')}
                />
                {GROUP_LABELS[gk] ?? gk}
              </button>
              {!collapsed && (
                <ul>
                  {groupedChannels[gk].map((ch) => (
                    <ChannelRow
                      key={ch.id}
                      ch={ch}
                      active={container?.kind === 'channel' && container.id === ch.id}
                      unread={unreadFor(ch.id)}
                      onClick={() => onNavigate({ kind: 'channel', id: ch.id })}
                    />
                  ))}
                </ul>
              )}
            </div>
          );
        })}

        {/* DMs */}
        <SectionHeader
          label={t('direct_messages')}
          testIdKey="direct-messages"
          addTitle={t('add')}
          onAdd={() => setDialog('dm')}
        />
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
                      ? 'bg-accent/10 font-medium text-accent'
                      : u.unread > 0
                        ? 'font-semibold text-ink hover:bg-hovered'
                        : 'text-ink-2 hover:bg-hovered hover:text-ink',
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
      <div className="flex items-center gap-2 border-t border-line px-3 py-2.5">
        <button onClick={() => setDialog('status')} title="Edit profile & status" className="flex min-w-0 flex-1 items-center gap-2 rounded-md p-1 hover:bg-hovered">
          <Avatar user={me} size="sm" presence={me ? (presence.data?.[me.id] ?? 'ACTIVE') : undefined} />
          <span className="min-w-0 flex-1 text-left">
            <span className="block truncate text-[13px] font-medium text-ink">{me?.displayName}</span>
            {me?.statusText && (
              <span className="block truncate text-[11px] text-ink-2">
                {me.statusEmoji ? `${emojiChar(me.statusEmoji)} ` : ''}
                {me.statusText}
              </span>
            )}
          </span>
        </button>
        <Tooltip label="Availability & focus hours">
          <button
            aria-label="Availability & focus hours"
            onClick={() => setDialog('availability')}
            className="rounded p-1.5 text-ink-3 hover:bg-hovered hover:text-ink"
          >
            <Clock size={15} />
          </button>
        </Tooltip>
        <ThemePicker />
        <Tooltip label="Sign out">
          <button
            aria-label="Sign out"
            onClick={() => void logout()}
            className="rounded p-1.5 text-ink-3 hover:bg-hovered hover:text-ink"
          >
            <LogOut size={15} />
          </button>
        </Tooltip>
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
      {dialog === 'status' && (
        <ProfileDialog
          workspaceId={workspaceId}
          initialPresence={
            (me && (presence.data?.[me.id] as 'ACTIVE' | 'AWAY' | 'DND' | undefined)) ?? 'ACTIVE'
          }
          onClose={() => setDialog('none')}
        />
      )}
      {dialog === 'availability' && (
        <AvailabilityDialog workspaceId={workspaceId} onClose={() => setDialog('none')} />
      )}
      {dialog === 'settings' && (
        <WorkspaceSettingsDialog
          workspaceId={workspaceId}
          workspaceName={workspace?.name ?? 'Workspace'}
          isAdmin={workspace?.myRole === 'OWNER' || workspace?.myRole === 'ADMIN'}
          onClose={() => setDialog('none')}
        />
      )}
      {dialog === 'catch-up' && (
        <CatchUpDialog workspaceId={workspaceId} onClose={() => setDialog('none')} />
      )}
      {dialog === 'scheduled' && (
        <ScheduledDialog
          workspaceId={workspaceId}
          channels={channels}
          conversations={conversations}
          onClose={() => setDialog('none')}
        />
      )}
      {dialog === 'workflows' && (
        <WorkflowsDialog
          workspaceId={workspaceId}
          channels={channels}
          onClose={() => setDialog('none')}
        />
      )}
      {dialog === 'user-groups' && (
        <UserGroupsDialog workspaceId={workspaceId} onClose={() => setDialog('none')} />
      )}
      {dialog === 'analytics' && (
        <AnalyticsDialog workspaceId={workspaceId} onClose={() => setDialog('none')} />
      )}
      {dialog === 'audit' && (
        <AuditDialog workspaceId={workspaceId} onClose={() => setDialog('none')} />
      )}
      {dialog === 'standups' && (
        <StandupsDialog workspaceId={workspaceId} channels={channels} onClose={() => setDialog('none')} />
      )}
      {dialog === 'decisions' && (
        <DecisionsDialog workspaceId={workspaceId} channels={channels} onClose={() => setDialog('none')} />
      )}
      {dialog === 'weekly-reports' && (
        <WeeklyReportsDialog workspaceId={workspaceId} channels={channels} onClose={() => setDialog('none')} />
      )}
      {dialog === 'integrations' && (
        <IntegrationsDialog workspaceId={workspaceId} channels={channels} onClose={() => setDialog('none')} />
      )}

      <GuidedTour
        storageKey="bs.tour.sidebar.v1"
        steps={tourSteps}
        replayEvent="bs:start-tour"
        labels={{
          skip: lang === 'id' ? 'Lewati' : 'Skip',
          back: lang === 'id' ? 'Kembali' : 'Back',
          next: lang === 'id' ? 'Lanjut' : 'Next',
          done: lang === 'id' ? 'Selesai' : 'Done',
        }}
      />
    </aside>
  );
}

const GROUP_LABELS: Record<string, string> = { jira: 'Jira', confluence: 'Confluence' };

function ChannelRow({
  ch,
  active,
  unread,
  onClick,
}: {
  ch: ChannelWithMeta;
  active: boolean;
  unread: { unread: number; mentions: number };
  onClick: () => void;
}) {
  return (
    <li>
      <button
        onClick={onClick}
        data-testid={`channel-${ch.name}`}
        className={clsx(
          'group flex w-full items-center gap-2 rounded-md px-2 py-1 text-[13px]',
          active
            ? 'bg-accent/10 font-medium text-accent'
            : unread.unread > 0
              ? 'font-semibold text-ink hover:bg-hovered'
              : 'text-ink-2 hover:bg-hovered hover:text-ink',
        )}
      >
        {ch.isPrivate ? <Lock size={13} className="shrink-0" /> : <Hash size={13} className="shrink-0" />}
        <span className="truncate">{ch.name}</span>
        {unread.mentions > 0 && (
          <span className="ml-auto rounded-full bg-red-500 px-1.5 text-[11px] font-bold text-white">
            {unread.mentions}
          </span>
        )}
        {unread.mentions === 0 && unread.unread > 0 && (
          <span
            className="ml-auto rounded-full bg-accent/15 px-1.5 text-[11px] font-semibold text-accent"
            data-testid={`unread-${ch.name}`}
          >
            {unread.unread}
          </span>
        )}
      </button>
    </li>
  );
}

function SectionButton({
  icon,
  label,
  badge,
  active,
  onClick,
  testId,
  buttonRef,
}: {
  icon: React.ReactNode;
  label: string;
  badge?: number;
  active?: boolean;
  onClick: () => void;
  testId?: string;
  buttonRef?: React.Ref<HTMLButtonElement>;
}) {
  return (
    <button
      ref={buttonRef}
      onClick={onClick}
      data-testid={testId}
      className={clsx(
        'relative flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] transition-colors',
        active
          ? 'bg-accent/10 font-medium text-accent before:absolute before:left-0 before:top-1/2 before:h-4 before:w-[3px] before:-translate-y-1/2 before:rounded-r-full before:bg-accent'
          : 'text-ink-2 hover:bg-hovered hover:text-ink',
      )}
    >
      <span className={clsx('shrink-0', active ? 'text-accent' : 'text-ink-3')}>{icon}</span>
      <span className="truncate">{label}</span>
      {badge != null && badge > 0 && (
        <span className="ml-auto rounded-full bg-accent px-1.5 text-[11px] font-semibold text-white">{badge}</span>
      )}
    </button>
  );
}

/** A collapsible sidebar hub. Remembers its open/closed state per `id`. */
function NavGroup({
  id,
  label,
  defaultOpen = true,
  children,
}: {
  id: string;
  label: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  useEffect(() => {
    const v = window.localStorage.getItem(`bs.sidebar.${id}`);
    if (v !== null) setOpen(v !== '0');
  }, [id]);
  const toggle = () =>
    setOpen((o) => {
      const next = !o;
      window.localStorage.setItem(`bs.sidebar.${id}`, next ? '1' : '0');
      return next;
    });
  return (
    <>
      <button
        onClick={toggle}
        className="mt-5 flex w-full items-center gap-1 px-2.5 pb-1 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-3 transition-colors hover:text-ink-2"
        data-testid={`navgroup-${id}`}
      >
        <ChevronDown size={11} className={clsx('transition-transform', !open && '-rotate-90')} />
        {label}
      </button>
      {open && <div className="space-y-0.5">{children}</div>}
    </>
  );
}

function SectionHeader({
  label,
  onAdd,
  onBrowse,
  headerRef,
  testIdKey,
  browseTitle = 'Browse channels',
  addTitle = 'Add',
}: {
  label: string;
  onAdd?: () => void;
  onBrowse?: () => void;
  headerRef?: React.Ref<HTMLDivElement>;
  /** Stable, language-independent key for the add button's test id. */
  testIdKey?: string;
  browseTitle?: string;
  addTitle?: string;
}) {
  const key = testIdKey ?? label.toLowerCase().replace(/\s/g, '-');
  return (
    <div ref={headerRef} className="mt-4 flex items-center justify-between px-2 pb-1">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-2">{label}</span>
      <span className="flex gap-1">
        {onBrowse && (
          <button onClick={onBrowse} title={browseTitle} className="rounded p-0.5 text-ink-3 hover:bg-hovered hover:text-ink">
            <Search size={13} />
          </button>
        )}
        {onAdd && (
          <button onClick={onAdd} title={addTitle} data-testid={`add-${key}`} className="rounded p-0.5 text-ink-3 hover:bg-hovered hover:text-ink">
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
          className="mb-3 w-full rounded-md border border-line-strong px-3 py-2 text-sm outline-none focus:border-accent dark:border-line dark:bg-gray-800"
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
        className="mb-3 w-full rounded-md border border-line-strong px-3 py-2 text-sm outline-none focus:border-accent dark:border-line dark:bg-gray-800"
        placeholder="Filter channels"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        autoFocus
      />
      <ul className="divide-y divide-line dark:divide-line">
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
              <button onClick={() => onOpen(ch.id)} className="rounded-md border border-line-strong px-2.5 py-1 text-xs font-medium hover:bg-gray-50 dark:border-line-strong dark:hover:bg-gray-800">
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
            className="mb-2 w-full rounded-md border border-line-strong px-3 py-2 text-sm outline-none focus:border-accent dark:border-line dark:bg-gray-800"
            placeholder="colleague@company.com"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as typeof role)}
            className="mb-3 w-full rounded-md border border-line-strong px-3 py-2 text-sm dark:border-line dark:bg-gray-800"
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
              className="flex-1 rounded-md border border-line-strong px-3 py-2 text-sm font-medium hover:bg-gray-50 dark:border-line-strong dark:hover:bg-gray-800"
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
  const qc = useQueryClient();
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
        className="mb-2 w-full rounded-md border border-line-strong px-3 py-2 text-sm outline-none focus:border-accent dark:border-line dark:bg-gray-800"
        placeholder="Search people"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        autoFocus
      />
      <ul className="mb-3 max-h-60 overflow-y-auto">
        {candidates.map((m) => (
          <li key={m.user.id}>
            <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-hovered">
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
          // Refresh the conversations list so the new DM shows in the sidebar and
          // resolves in the main pane immediately (no navigate-away-and-back).
          await qc.invalidateQueries({ queryKey: keys.conversations(workspaceId) });
          onOpen(dm.id);
        }}
        className="w-full rounded-md bg-accent px-3 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
      >
        Start conversation {selected.length > 1 ? `(group of ${selected.length + 1})` : ''}
      </button>
    </Dialog>
  );
}

const PRESENCE_META: Record<'ACTIVE' | 'AWAY' | 'DND', { label: string; dot: string }> = {
  ACTIVE: { label: 'Active', dot: 'bg-green-500' },
  AWAY: { label: 'Away', dot: 'bg-yellow-400' },
  DND: { label: 'Do not disturb', dot: 'bg-red-500' },
};

function ProfileDialog({
  workspaceId,
  initialPresence = 'ACTIVE',
  onClose,
}: {
  workspaceId: string;
  initialPresence?: 'ACTIVE' | 'AWAY' | 'DND';
  onClose: () => void;
}) {
  const me = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const lang = useUiStore((s) => s.lang);
  const setLang = useUiStore((s) => s.setLang);
  const t = useT();
  const [name, setName] = useState(me?.displayName ?? '');
  const [emoji, setEmoji] = useState(me?.statusEmoji ?? '');
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [text, setText] = useState(me?.statusText ?? '');
  const [clearAfter, setClearAfter] = useState<'' | '1h' | 'today' | 'week'>('');
  const [presenceState, setPresenceState] = useState<'ACTIVE' | 'AWAY' | 'DND'>(initialPresence);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notifPerm, setNotifPerm] = useState<NotificationPermission | 'unsupported'>(() =>
    typeof window === 'undefined' || typeof Notification === 'undefined'
      ? 'unsupported'
      : Notification.permission,
  );

  const enableNotifications = async () => {
    if (typeof Notification === 'undefined') return;
    setNotifPerm(await Notification.requestPermission());
  };

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
      const expiresAt =
        clearAfter === '1h'
          ? new Date(Date.now() + 3600_000)
          : clearAfter === 'today'
            ? (() => {
                const d = new Date();
                d.setHours(23, 59, 0, 0);
                return d;
              })()
            : clearAfter === 'week'
              ? new Date(Date.now() + 7 * 86400_000)
              : null;
      const user = await api<typeof me>('PATCH', '/me/status', {
        statusEmoji: emoji || null,
        statusText: text || null,
        statusExpiresAt: expiresAt ? expiresAt.toISOString() : null,
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
    'w-full rounded-md border border-line-strong px-3 py-2 text-sm outline-none focus:border-accent dark:border-line dark:bg-gray-800';

  return (
    <Dialog title="Edit profile" onClose={onClose}>
      {error && <p className="mb-2 text-sm text-red-600">{error}</p>}

      <div className="mb-4 flex items-center gap-3">
        <Avatar user={me} size="lg" />
        <label className="cursor-pointer rounded-md border border-line-strong px-3 py-1.5 text-sm font-medium hover:bg-gray-50 dark:border-line-strong dark:hover:bg-gray-800">
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
        <div className="relative">
          <button
            type="button"
            onClick={() => setEmojiPickerOpen((v) => !v)}
            className={clsx(inputCls, 'flex h-full w-12 items-center justify-center text-lg')}
            title="Pick an emoji"
            data-testid="status-emoji-button"
          >
            {emoji ? emojiChar(emoji) : <Smile size={16} className="text-gray-400" />}
          </button>
          {emojiPickerOpen && (
            <EmojiPickerPopover
              onPick={(code) => {
                setEmoji(code);
                setEmojiPickerOpen(false);
              }}
              onClose={() => setEmojiPickerOpen(false)}
            />
          )}
        </div>
        <input
          className={clsx(inputCls, 'flex-1')}
          placeholder="What's your status?"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        {emoji && (
          <button
            type="button"
            onClick={() => setEmoji('')}
            className="px-1 text-xs text-gray-400 hover:text-gray-600"
            title="Clear emoji"
          >
            Clear
          </button>
        )}
      </div>

      <label className="mb-1 block text-xs font-medium text-gray-500">Clear status after</label>
      <select
        value={clearAfter}
        onChange={(e) => setClearAfter(e.target.value as typeof clearAfter)}
        className={clsx(inputCls, 'mb-3')}
        data-testid="status-clear-after"
      >
        <option value="">Don&apos;t clear</option>
        <option value="1h">1 hour</option>
        <option value="today">Today</option>
        <option value="week">This week</option>
      </select>

      <label className="mb-1 block text-xs font-medium text-gray-500">Language</label>
      <select
        value={lang}
        onChange={(e) => setLang(e.target.value as 'en' | 'id')}
        className={clsx(inputCls, 'mb-3')}
        data-testid="language-select"
      >
        <option value="en">English</option>
        <option value="id">Bahasa Indonesia</option>
      </select>

      <button
        type="button"
        onClick={() => {
          onClose();
          window.dispatchEvent(new Event('bs:start-tour'));
        }}
        className="mb-3 flex w-full items-center justify-center gap-2 rounded-md border border-line-strong px-3 py-2 text-sm font-medium hover:bg-gray-50 dark:border-line-strong dark:hover:bg-gray-800"
        data-testid="replay-tour"
      >
        <Sparkles size={14} className="text-accent" />
        {t('replay_tour')}
      </button>

      <label className="mb-1 block text-xs font-medium text-gray-500">Pause notifications (DND)</label>
      <div className="mb-4 flex flex-wrap gap-2">
        {[
          { label: '30 min', mins: 30 },
          { label: '1 hour', mins: 60 },
          { label: 'Until tomorrow', mins: 60 * 16 },
          { label: 'Off', mins: 0 },
        ].map((o) => (
          <button
            key={o.label}
            type="button"
            onClick={() =>
              void api('PATCH', '/me/dnd', {
                until: o.mins ? new Date(Date.now() + o.mins * 60_000).toISOString() : null,
              })
            }
            className="rounded-full border border-line-strong px-2.5 py-0.5 text-[12px] font-medium hover:bg-gray-100 dark:border-line-strong dark:hover:bg-gray-800"
            data-testid="dnd-option"
          >
            {o.label}
          </button>
        ))}
      </div>

      <div className="mb-4 flex gap-4 text-sm">
        {(['ACTIVE', 'AWAY', 'DND'] as const).map((s) => (
          <label key={s} className="flex cursor-pointer items-center gap-1.5">
            <input type="radio" checked={presenceState === s} onChange={() => setPresenceState(s)} />
            <span className={clsx('h-2.5 w-2.5 rounded-full', PRESENCE_META[s].dot)} />
            {PRESENCE_META[s].label}
          </label>
        ))}
      </div>

      <label className="mb-1 block text-xs font-medium text-gray-500">Focus mode</label>
      <div className="mb-4 flex flex-wrap gap-2">
        {[
          { label: 'Focus 25 min', mins: 25 },
          { label: 'Focus 50 min', mins: 50 },
        ].map((o) => (
          <button
            key={o.label}
            type="button"
            onClick={() => void api('POST', '/me/focus', { minutes: o.mins })}
            className="rounded-full border border-accent px-2.5 py-0.5 text-[12px] font-medium text-accent hover:bg-accent/10"
            data-testid="focus-option"
          >
            🎯 {o.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => void api('POST', '/me/focus/end', {})}
          className="rounded-full border border-line-strong px-2.5 py-0.5 text-[12px] font-medium hover:bg-gray-100 dark:border-line-strong dark:hover:bg-gray-800"
          data-testid="focus-end"
        >
          End
        </button>
      </div>

      <WellbeingCard workspaceId={workspaceId} />
      <FocusCard workspaceId={workspaceId} />
      <DigestToggle workspaceId={workspaceId} />
      <CalendarLink />

      <div className="mb-4 rounded-md border border-line p-2.5 dark:border-line">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-gray-600 dark:text-gray-300">
            Desktop notifications
          </span>
          {notifPerm === 'granted' ? (
            <span className="text-xs font-medium text-green-600">Enabled</span>
          ) : notifPerm === 'unsupported' ? (
            <span className="text-xs text-gray-400">Not supported</span>
          ) : notifPerm === 'denied' ? (
            <span className="text-xs text-gray-400">Blocked in browser</span>
          ) : (
            <button
              onClick={() => void enableNotifications()}
              className="rounded border border-accent px-2 py-0.5 text-xs font-medium text-accent hover:bg-accent/10"
              data-testid="enable-notifications"
            >
              Enable
            </button>
          )}
        </div>
        <p className="mt-1 text-[11px] text-gray-400">
          Get notified when a Jira task is assigned to or removed from you, plus mentions and DMs.
        </p>
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
