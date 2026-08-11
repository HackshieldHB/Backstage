'use client';

import { useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { Trash2 } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import {
  useAnalytics,
  useAuditLog,
  useMembers,
  useUserGroups,
} from '@/hooks/queries';
import { useUiStore } from '@/stores/ui-store';
import { Dialog } from './dialog';
import { Avatar } from './avatar';

// ---------- user groups ----------

export function UserGroupsDialog({ workspaceId, onClose }: { workspaceId: string; onClose: () => void }) {
  const groups = useUserGroups(workspaceId);
  const members = useMembers(workspaceId);
  const qc = useQueryClient();
  const pushToast = useUiStore((s) => s.pushToast);
  const [name, setName] = useState('');
  const [handle, setHandle] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const refresh = () => qc.invalidateQueries({ queryKey: ['user-groups', workspaceId] });

  const create = async () => {
    try {
      await api('POST', `/workspaces/${workspaceId}/user-groups`, {
        name: name.trim(),
        handle: handle.trim(),
        memberIds: selected,
      });
      setName('');
      setHandle('');
      setSelected([]);
      await refresh();
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Could not create group', 'error');
    }
  };
  const remove = async (id: string) => {
    try {
      await api('DELETE', `/user-groups/${id}`);
      await refresh();
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Could not delete', 'error');
    }
  };

  const inputCls =
    'w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm outline-none focus:border-accent dark:border-gray-700 dark:bg-gray-800';

  return (
    <Dialog title="User groups" onClose={onClose} wide>
      <ul className="mb-4 space-y-2">
        {(groups.data ?? []).map((g) => (
          <li key={g.id} className="flex items-center gap-2 rounded-lg border border-gray-200 p-2.5 dark:border-gray-700">
            <span className="text-sm font-semibold">@{g.handle}</span>
            <span className="text-[13px] text-gray-500">{g.name} · {g.memberIds.length} members</span>
            <button onClick={() => void remove(g.id)} className="ml-auto rounded p-1 text-gray-400 hover:text-red-500">
              <Trash2 size={15} />
            </button>
          </li>
        ))}
        {(groups.data ?? []).length === 0 && (
          <li className="rounded-lg border border-dashed border-gray-300 p-3 text-center text-sm text-gray-500 dark:border-gray-600">
            No groups yet. Mention a group with @handle to ping everyone in it.
          </li>
        )}
      </ul>
      <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
        <div className="mb-2 grid grid-cols-2 gap-2">
          <input className={inputCls} placeholder="Name (e.g. Engineering)" value={name} onChange={(e) => setName(e.target.value)} />
          <input className={inputCls} placeholder="handle" value={handle} onChange={(e) => setHandle(e.target.value.toLowerCase())} />
        </div>
        <div className="mb-2 max-h-40 overflow-y-auto rounded-md border border-gray-200 p-1 dark:border-gray-700">
          {(members.data ?? []).map((m) => (
            <label key={m.user.id} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-gray-50 dark:hover:bg-gray-800">
              <input
                type="checkbox"
                checked={selected.includes(m.user.id)}
                onChange={(e) =>
                  setSelected((s) => (e.target.checked ? [...s, m.user.id] : s.filter((id) => id !== m.user.id)))
                }
              />
              <Avatar user={m.user} size="xs" /> {m.user.displayName}
            </label>
          ))}
        </div>
        <button
          onClick={() => void create()}
          disabled={!name.trim() || !handle.trim()}
          className="w-full rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
          data-testid="create-group"
        >
          Create group
        </button>
      </div>
    </Dialog>
  );
}

// ---------- analytics ----------

export function AnalyticsDialog({ workspaceId, onClose }: { workspaceId: string; onClose: () => void }) {
  const a = useAnalytics(workspaceId);
  const max = Math.max(1, ...(a.data?.messagesByDay.map((d) => d.count) ?? [1]));
  return (
    <Dialog title="Workspace analytics" onClose={onClose} wide>
      {a.isLoading && <p className="text-sm text-gray-500">Loading…</p>}
      {a.data && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: 'Total messages', value: a.data.totalMessages },
              { label: 'Members', value: a.data.memberCount },
              { label: 'Active (7d)', value: a.data.activeUsers7d },
            ].map((s) => (
              <div key={s.label} className="rounded-lg border border-gray-200 p-3 text-center dark:border-gray-700">
                <div className="text-2xl font-bold">{s.value}</div>
                <div className="text-[11px] uppercase tracking-wide text-gray-500">{s.label}</div>
              </div>
            ))}
          </div>
          <div>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Messages (last 7 days)</h3>
            <div className="flex h-28 items-end gap-1.5">
              {a.data.messagesByDay.map((d) => (
                <div key={d.date} className="flex flex-1 flex-col items-center gap-1" title={`${d.date}: ${d.count}`}>
                  <div className="w-full rounded-t bg-accent" style={{ height: `${(d.count / max) * 100}%` }} />
                  <span className="text-[9px] text-gray-400">{d.date.slice(5)}</span>
                </div>
              ))}
              {a.data.messagesByDay.length === 0 && <p className="text-sm text-gray-500">No activity.</p>}
            </div>
          </div>
          <div>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Busiest channels</h3>
            <ul className="space-y-1">
              {a.data.topChannels.map((c) => (
                <li key={c.name} className="flex justify-between text-sm">
                  <span>#{c.name}</span>
                  <span className="text-gray-500">{c.count}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </Dialog>
  );
}

// ---------- audit log ----------

export function AuditDialog({ workspaceId, onClose }: { workspaceId: string; onClose: () => void }) {
  const log = useAuditLog(workspaceId);
  return (
    <Dialog title="Audit log" onClose={onClose} wide>
      {log.isLoading && <p className="text-sm text-gray-500">Loading…</p>}
      <ul className="space-y-1.5">
        {(log.data ?? []).map((e) => (
          <li key={e.id} className="flex items-center gap-2 rounded-md border border-gray-200 p-2 text-[13px] dark:border-gray-700">
            <Avatar user={e.actor} size="xs" />
            <span className="font-medium">{e.actor?.displayName ?? 'System'}</span>
            <code className="rounded bg-gray-100 px-1 text-[12px] dark:bg-gray-800">{e.action}</code>
            <span className="ml-auto text-[11px] text-gray-400">
              {formatDistanceToNow(new Date(e.createdAt), { addSuffix: true })}
            </span>
          </li>
        ))}
        {(log.data ?? []).length === 0 && !log.isLoading && (
          <li className="p-3 text-center text-sm text-gray-500">No audit entries yet.</li>
        )}
      </ul>
    </Dialog>
  );
}
