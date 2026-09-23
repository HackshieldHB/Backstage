'use client';

import { useMemo, useState } from 'react';
import clsx from 'clsx';
import { Building2, Plug, ShieldCheck, Trash2, Users } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import type { WorkspaceMemberDto, WorkspaceRole } from '@backstages/shared';
import { api } from '@/lib/api';
import { keys, useMembers, useRemoveMember, useUpdateMemberRole } from '@/hooks/queries';
import { useAuthStore } from '@/stores/auth-store';
import { useUiStore } from '@/stores/ui-store';
import { Dialog } from './dialog';
import { Avatar } from './avatar';
import { AtlassianSettings } from './atlassian-dialog';

type Section = 'general' | 'members' | 'atlassian';

/**
 * Workspace settings, opened from the workspace name. Home for everything that
 * configures the workspace — currently General (rename) and the Atlassian /
 * Jira / Confluence integration, which used to be its own scattered dialog.
 */
export function WorkspaceSettingsDialog({
  workspaceId,
  workspaceName,
  isAdmin,
  onClose,
}: {
  workspaceId: string;
  workspaceName: string;
  isAdmin: boolean;
  onClose: () => void;
}) {
  const [section, setSection] = useState<Section>('general');
  const setMainView = useUiStore((s) => s.setMainView);

  const openConfluence = () => {
    onClose();
    setMainView('confluence');
  };

  return (
    <Dialog title="Workspace settings" onClose={onClose} wide>
      <div className="flex gap-4">
        <nav className="w-40 shrink-0 space-y-0.5">
          <SectionTab
            icon={<Building2 size={15} />}
            label="General"
            active={section === 'general'}
            onClick={() => setSection('general')}
          />
          <SectionTab
            icon={<Users size={15} />}
            label="Members"
            active={section === 'members'}
            onClick={() => setSection('members')}
          />
          <SectionTab
            icon={<Plug size={15} />}
            label="Atlassian"
            active={section === 'atlassian'}
            onClick={() => setSection('atlassian')}
          />
        </nav>
        <div className="min-w-0 flex-1">
          {section === 'general' ? (
            <GeneralSettings
              workspaceId={workspaceId}
              workspaceName={workspaceName}
              isAdmin={isAdmin}
            />
          ) : section === 'members' ? (
            <MembersSettings workspaceId={workspaceId} />
          ) : (
            <AtlassianSettings
              workspaceId={workspaceId}
              isAdmin={isAdmin}
              onOpenConfluence={openConfluence}
            />
          )}
        </div>
      </div>
    </Dialog>
  );
}

function GeneralSettings({
  workspaceId,
  workspaceName,
  isAdmin,
}: {
  workspaceId: string;
  workspaceName: string;
  isAdmin: boolean;
}) {
  const qc = useQueryClient();
  const pushToast = useUiStore((s) => s.pushToast);
  const [name, setName] = useState(workspaceName);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const next = name.trim();
    if (!next || next === workspaceName) return;
    setSaving(true);
    try {
      await api('PATCH', `/workspaces/${workspaceId}`, { name: next });
      await qc.invalidateQueries({ queryKey: keys.workspaces });
      pushToast('Workspace renamed.', 'success');
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Rename failed', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="text-sm">
      <label className="mb-1 block text-xs font-medium text-gray-500">Workspace name</label>
      <div className="flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={!isAdmin}
          className="flex-1 rounded-md border border-line-strong px-3 py-2 text-sm outline-none focus:border-accent disabled:opacity-60 dark:border-line dark:bg-gray-800"
          data-testid="workspace-rename"
        />
        {isAdmin && (
          <button
            onClick={() => void save()}
            disabled={saving || !name.trim() || name.trim() === workspaceName}
            className="rounded-md bg-accent px-3 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        )}
      </div>
      {!isAdmin && (
        <p className="mt-2 text-xs text-gray-500">Only workspace admins can rename the workspace.</p>
      )}
    </div>
  );
}

const ROLE_RANK: Record<WorkspaceRole, number> = { OWNER: 0, ADMIN: 1, MEMBER: 2, GUEST: 3 };
const ROLE_BADGE: Record<WorkspaceRole, string> = {
  OWNER: 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300',
  ADMIN: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300',
  MEMBER: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300',
  GUEST: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
};
const title = (r: string) => r[0] + r.slice(1).toLowerCase();

/** Admin member management: change roles, remove members. Mirrors the server's
 *  rules so the UI never offers an action the API would reject. */
function MembersSettings({ workspaceId }: { workspaceId: string }) {
  const me = useAuthStore((s) => s.user);
  const members = useMembers(workspaceId);
  const updateRole = useUpdateMemberRole(workspaceId);
  const removeMember = useRemoveMember(workspaceId);
  const pushToast = useUiStore((s) => s.pushToast);
  const [q, setQ] = useState('');

  const myRole = members.data?.find((m) => m.user.id === me?.id)?.role;
  const iAmAdmin = myRole === 'OWNER' || myRole === 'ADMIN';

  const rows = useMemo(() => {
    const sorted = [...(members.data ?? [])].sort(
      (a, b) => ROLE_RANK[a.role] - ROLE_RANK[b.role] || a.user.displayName.localeCompare(b.user.displayName),
    );
    const needle = q.trim().toLowerCase();
    return needle
      ? sorted.filter(
          (m) => m.user.displayName.toLowerCase().includes(needle) || m.user.email.toLowerCase().includes(needle),
        )
      : sorted;
  }, [members.data, q]);

  const canManage = (m: WorkspaceMemberDto) => {
    if (!iAmAdmin || m.user.id === me?.id) return false; // not yourself
    if (m.role === 'OWNER') return false; // owner untouchable
    if (m.role === 'ADMIN' && myRole !== 'OWNER') return false; // only owner manages admins
    return true;
  };

  const changeRole = (m: WorkspaceMemberDto, role: 'ADMIN' | 'MEMBER' | 'GUEST') =>
    updateRole.mutate(
      { userId: m.user.id, role },
      {
        onSuccess: () => pushToast(`${m.user.displayName} is now ${role.toLowerCase()}.`, 'success'),
        onError: (e) => pushToast(e instanceof Error ? e.message : 'Could not change role.', 'error'),
      },
    );

  const remove = (m: WorkspaceMemberDto) => {
    if (!window.confirm(`Remove ${m.user.displayName} from this workspace?`)) return;
    removeMember.mutate(m.user.id, {
      onSuccess: () => pushToast(`${m.user.displayName} removed.`, 'success'),
      onError: (e) => pushToast(e instanceof Error ? e.message : 'Could not remove.', 'error'),
    });
  };

  return (
    <div className="text-sm">
      <div className="mb-3 flex items-center justify-between gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={`Search ${members.data?.length ?? 0} members`}
          className="w-56 rounded-md border border-line-strong px-2.5 py-1.5 text-[13px] outline-none focus:border-accent dark:border-line dark:bg-gray-800"
          data-testid="members-search"
        />
        {!iAmAdmin && <span className="text-[12px] text-gray-500">View only — admins manage roles.</span>}
      </div>
      {members.isLoading ? (
        <p className="py-6 text-center text-gray-500">Loading members…</p>
      ) : (
        <ul className="max-h-[55vh] divide-y divide-line overflow-y-auto">
          {rows.map((m) => (
            <li key={m.id} className="flex items-center gap-2.5 py-2">
              <Avatar user={m.user} size="sm" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-[13px] font-medium">
                    {m.user.displayName}
                    {m.user.id === me?.id && ' (you)'}
                  </span>
                  {m.role === 'OWNER' && <ShieldCheck size={12} className="text-amber-500" aria-label="Owner" />}
                  {m.deactivatedAt && (
                    <span className="rounded bg-gray-200 px-1 text-[10px] text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                      deactivated
                    </span>
                  )}
                </div>
                <span className="block truncate text-[11px] text-gray-500">{m.user.email}</span>
              </div>
              {canManage(m) ? (
                <div className="flex items-center gap-1.5">
                  <select
                    value={m.role}
                    onChange={(e) => changeRole(m, e.target.value as 'ADMIN' | 'MEMBER' | 'GUEST')}
                    className="rounded border border-line-strong bg-elevated px-1.5 py-1 text-[12px] dark:bg-gray-800"
                    aria-label={`Role for ${m.user.displayName}`}
                  >
                    {(['ADMIN', 'MEMBER', 'GUEST'] as const).map((r) => (
                      <option key={r} value={r}>{title(r)}</option>
                    ))}
                  </select>
                  <button
                    onClick={() => remove(m)}
                    title="Remove from workspace"
                    aria-label={`Remove ${m.user.displayName}`}
                    className="rounded p-1 text-gray-400 hover:bg-red-500/10 hover:text-red-500"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ) : (
                <span className={clsx('rounded px-1.5 py-0.5 text-[11px] font-medium', ROLE_BADGE[m.role])}>
                  {title(m.role)}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SectionTab({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-[13px]',
        active
          ? 'bg-accent/10 font-medium text-accent'
          : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800',
      )}
    >
      {icon}
      {label}
    </button>
  );
}
