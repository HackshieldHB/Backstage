'use client';

import { useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { AlarmClock, Plus, Siren } from 'lucide-react';
import clsx from 'clsx';
import { useQueryClient } from '@tanstack/react-query';
import type { IncidentDto, Severity } from '@backstages/shared';
import { api } from '@/lib/api';
import { keys, useIncidents, useMembers, useOncall } from '@/hooks/queries';
import { PaneShell } from './pane-shell';
import { Avatar } from './avatar';

const input = 'w-full rounded-lg border border-line-strong bg-elevated px-2.5 py-1.5 text-sm text-ink outline-none focus:border-accent';
const SEV: Record<Severity, string> = {
  SEV1: 'bg-red-500/15 text-red-500',
  SEV2: 'bg-amber-500/15 text-amber-500',
  SEV3: 'bg-slate-500/15 text-ink-2',
};
const STATUS: Record<string, string> = {
  OPEN: 'bg-red-500/15 text-red-500',
  MITIGATED: 'bg-amber-500/15 text-amber-500',
  RESOLVED: 'bg-green-500/15 text-green-500',
};

export function IncidentsPane({ workspaceId }: { workspaceId: string }) {
  const incidents = useIncidents(workspaceId);
  const oncall = useOncall(workspaceId);
  const [declaring, setDeclaring] = useState(false);

  return (
    <PaneShell
      icon={<Siren size={18} className="text-accent" />}
      title="Incidents"
      subtitle="Lifecycle, timeline & on-call"
      actions={
        <button onClick={() => setDeclaring((v) => !v)} className="flex items-center gap-1 rounded-lg bg-accent px-2.5 py-1.5 text-[13px] font-semibold text-white hover:bg-accent-hover">
          <Plus size={14} /> Declare
        </button>
      }
    >
      <div className="mx-auto max-w-4xl space-y-4">
        {/* On-call */}
        <div className="flex items-center gap-3 rounded-xl border border-line bg-elevated px-4 py-3">
          <AlarmClock size={16} className="text-ink-3" />
          <span className="text-[13px] font-medium text-ink">On-call now:</span>
          {oncall.data?.current?.length ? (
            <div className="flex flex-wrap items-center gap-2">
              {oncall.data.current.map((s) => (
                <span key={s.id} className="flex items-center gap-1.5 rounded-full bg-hovered px-2 py-0.5 text-[12px] text-ink">
                  <Avatar user={s.user} size="xs" /> {s.user.displayName} <span className="text-ink-3">· {s.label}</span>
                </span>
              ))}
            </div>
          ) : (
            <span className="text-[12px] text-ink-3">Nobody scheduled</span>
          )}
        </div>

        {declaring && <DeclareForm workspaceId={workspaceId} onDone={() => setDeclaring(false)} />}

        {incidents.data?.map((i) => <IncidentCard key={i.id} incident={i} workspaceId={workspaceId} />)}
        {incidents.isSuccess && incidents.data.length === 0 && !declaring && (
          <p className="rounded-xl border border-dashed border-line py-8 text-center text-sm text-ink-3">No incidents. All quiet. 🌤️</p>
        )}
      </div>
    </PaneShell>
  );
}

function DeclareForm({ workspaceId, onDone }: { workspaceId: string; onDone: () => void }) {
  const qc = useQueryClient();
  const members = useMembers(workspaceId);
  const [title, setTitle] = useState('');
  const [severity, setSeverity] = useState<Severity>('SEV3');
  const [commanderId, setCommanderId] = useState('');
  const save = async () => {
    if (!title.trim()) return;
    await api('POST', `/workspaces/${workspaceId}/incidents`, { title: title.trim(), severity, ...(commanderId ? { commanderId } : {}) });
    await qc.invalidateQueries({ queryKey: keys.incidents(workspaceId) });
    onDone();
  };
  return (
    <div className="grid grid-cols-1 gap-2 rounded-xl border border-line bg-elevated p-3 sm:grid-cols-4">
      <input className={`${input} sm:col-span-2`} placeholder="What's happening?" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
      <select className={input} value={severity} onChange={(e) => setSeverity(e.target.value as Severity)}>
        <option value="SEV1">SEV1 · critical</option>
        <option value="SEV2">SEV2 · major</option>
        <option value="SEV3">SEV3 · minor</option>
      </select>
      <select className={input} value={commanderId} onChange={(e) => setCommanderId(e.target.value)}>
        <option value="">Commander…</option>
        {(members.data ?? []).map((m) => <option key={m.user.id} value={m.user.id}>{m.user.displayName}</option>)}
      </select>
      <button onClick={() => void save()} className="rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-white hover:bg-accent-hover sm:col-span-4">Declare incident</button>
    </div>
  );
}

function IncidentCard({ incident, workspaceId }: { incident: IncidentDto; workspaceId: string }) {
  const qc = useQueryClient();
  const [body, setBody] = useState('');
  const [kind, setKind] = useState<'NOTE' | 'MITIGATED' | 'RESOLVED'>('NOTE');
  const post = async () => {
    if (!body.trim()) return;
    await api('POST', `/incidents/${incident.id}/updates`, { kind, body: body.trim() });
    await qc.invalidateQueries({ queryKey: keys.incidents(workspaceId) });
    setBody('');
    setKind('NOTE');
  };
  return (
    <div className="rounded-xl border border-line bg-elevated">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
        <span className={clsx('rounded px-1.5 py-0.5 text-[10px] font-bold', SEV[incident.severity])}>{incident.severity}</span>
        <span className="font-semibold text-ink">{incident.title}</span>
        <span className={clsx('rounded px-1.5 py-0.5 text-[10px] font-semibold', STATUS[incident.status])}>{incident.status}</span>
        <span className="ml-auto text-[11px] text-ink-3">
          {incident.durationMin != null ? `${incident.durationMin}m` : formatDistanceToNow(new Date(incident.declaredAt), { addSuffix: true })}
          {incident.commander && ` · IC ${incident.commander.displayName}`}
        </span>
      </div>
      <ul className="space-y-2 px-4 py-3">
        {incident.updates.map((u) => (
          <li key={u.id} className="flex gap-2 text-[13px]">
            <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
            <div>
              <span className="text-ink">{u.body}</span>
              <span className="ml-1.5 text-[11px] text-ink-3">
                {u.author?.displayName ?? 'system'} · {formatDistanceToNow(new Date(u.createdAt), { addSuffix: true })}
              </span>
            </div>
          </li>
        ))}
      </ul>
      {incident.status !== 'RESOLVED' && (
        <div className="flex items-center gap-2 border-t border-line px-4 py-2.5">
          <select className="rounded-lg border border-line bg-elevated px-2 py-1.5 text-[13px] text-ink-2" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
            <option value="NOTE">Note</option>
            <option value="MITIGATED">Mark mitigated</option>
            <option value="RESOLVED">Resolve</option>
          </select>
          <input className={input} placeholder="Post an update…" value={body} onChange={(e) => setBody(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void post()} />
          <button onClick={() => void post()} className="shrink-0 rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-white hover:bg-accent-hover">Post</button>
        </div>
      )}
    </div>
  );
}
