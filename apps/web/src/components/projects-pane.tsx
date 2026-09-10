'use client';

import { useState } from 'react';
import { Briefcase, Plus, Trash2 } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import type { ClientRollupDto, ProjectRollupDto } from '@backstages/shared';
import { api } from '@/lib/api';
import { keys, useProjectsOverview } from '@/hooks/queries';
import { PaneShell } from './pane-shell';

const input =
  'w-full rounded-lg border border-line-strong bg-elevated px-2.5 py-1.5 text-sm text-ink outline-none focus:border-accent';

const hrs = (sec: number) => `${(sec / 3600).toFixed(1)}h`;
const money = (cents: number) => `$${(cents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

export function ProjectsPane({ workspaceId }: { workspaceId: string }) {
  const [days, setDays] = useState(30);
  const q = useProjectsOverview(workspaceId, days);
  const [adding, setAdding] = useState<'none' | 'client' | 'project'>('none');

  return (
    <PaneShell
      icon={<Briefcase size={18} className="text-accent" />}
      title="Clients & Projects"
      subtitle="Billability & margin"
      actions={
        <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="rounded-lg border border-line bg-elevated px-2 py-1 text-[13px] text-ink-2">
          <option value={30}>Last 30 days</option>
          <option value={60}>Last 60 days</option>
          <option value={90}>Last 90 days</option>
        </select>
      }
    >
      <div className="mx-auto max-w-5xl">
        {q.isLoading && <p className="py-10 text-center text-sm text-ink-3">Loading rollup…</p>}
        {q.isError && (
          <p className="rounded-xl border border-dashed border-line py-8 text-center text-sm text-ink-3">
            Clients & billing are visible to workspace admins only.
          </p>
        )}
        {q.data && (
          <>
            {/* Totals */}
            <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Hours logged" value={hrs(q.data.totals.loggedSec)} />
              <Stat label="Revenue" value={money(q.data.totals.revenueCents)} tone="text-accent" />
              <Stat label="Cost" value={money(q.data.totals.costCents)} />
              <Stat label="Margin" value={money(q.data.totals.marginCents)} tone={q.data.totals.marginCents >= 0 ? 'text-green-500' : 'text-red-500'} />
            </div>

            <div className="mb-3 flex items-center gap-2">
              <button onClick={() => setAdding(adding === 'client' ? 'none' : 'client')} className="flex items-center gap-1 rounded-lg bg-accent px-2.5 py-1.5 text-[13px] font-semibold text-white hover:bg-accent-hover">
                <Plus size={14} /> Client
              </button>
              <button onClick={() => setAdding(adding === 'project' ? 'none' : 'project')} className="flex items-center gap-1 rounded-lg border border-line px-2.5 py-1.5 text-[13px] font-medium text-ink-2 hover:bg-hovered hover:text-ink">
                <Plus size={14} /> Project
              </button>
            </div>
            {adding === 'client' && <AddClient workspaceId={workspaceId} onDone={() => setAdding('none')} />}
            {adding === 'project' && <AddProject workspaceId={workspaceId} clients={q.data.clients} onDone={() => setAdding('none')} />}

            <div className="space-y-4">
              {q.data.clients.map((c) => (
                <ClientCard key={c.id} client={c} workspaceId={workspaceId} />
              ))}
              {q.data.clients.length === 0 && adding === 'none' && (
                <p className="rounded-xl border border-dashed border-line py-8 text-center text-sm text-ink-3">
                  No clients yet. Add one, then create projects and map them to a Jira project key.
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </PaneShell>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-line bg-elevated p-3">
      <div className={`text-xl font-bold ${tone ?? 'text-ink'}`}>{value}</div>
      <div className="mt-0.5 text-[11px] text-ink-3">{label}</div>
    </div>
  );
}

function ClientCard({ client, workspaceId }: { client: ClientRollupDto; workspaceId: string }) {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['projects-overview', workspaceId] });
  const del = async () => {
    if (!window.confirm(`Delete client "${client.name}" and its projects?`)) return;
    await api('DELETE', `/clients/${client.id}`);
    await invalidate();
  };
  return (
    <div className="rounded-xl border border-line bg-elevated">
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-ink">{client.name}</span>
          <span className="text-[11px] text-ink-3">{client.projectCount} projects · {hrs(client.loggedSec)}</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[12px] text-ink-2">{money(client.revenueCents)} rev</span>
          <span className={`text-[12px] font-medium ${client.marginCents >= 0 ? 'text-green-500' : 'text-red-500'}`}>{money(client.marginCents)} margin</span>
          <button onClick={() => void del()} className="rounded p-1 text-ink-3 hover:text-red-500"><Trash2 size={13} /></button>
        </div>
      </div>
      <ul className="divide-y divide-line">
        {client.projects.map((p) => <ProjectRow key={p.id} p={p} workspaceId={workspaceId} />)}
        {client.projects.length === 0 && <li className="px-4 py-3 text-[12px] text-ink-3">No projects.</li>}
      </ul>
    </div>
  );
}

function ProjectRow({ p, workspaceId }: { p: ProjectRollupDto; workspaceId: string }) {
  const qc = useQueryClient();
  const del = async () => {
    await api('DELETE', `/projects/${p.id}`);
    await qc.invalidateQueries({ queryKey: ['projects-overview', workspaceId] });
  };
  return (
    <li className="group flex items-center gap-3 px-4 py-2.5 text-sm">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium text-ink">{p.name}</span>
          {p.jiraProjectKey && <span className="rounded bg-hovered px-1.5 py-0.5 font-mono text-[10px] text-ink-3">{p.jiraProjectKey}</span>}
          {!p.billable && <span className="rounded bg-hovered px-1.5 py-0.5 text-[10px] text-ink-3">non-billable</span>}
        </div>
        {p.budgetHours != null && (
          <div className="mt-1 flex items-center gap-2">
            <div className="h-1 w-32 overflow-hidden rounded-full bg-hovered">
              <div className={`h-full rounded-full ${(p.budgetUsedPct ?? 0) > 100 ? 'bg-red-500' : 'bg-accent'}`} style={{ width: `${Math.min(p.budgetUsedPct ?? 0, 100)}%` }} />
            </div>
            <span className="text-[10px] text-ink-3">{p.budgetUsedPct ?? 0}% of {p.budgetHours}h</span>
          </div>
        )}
      </div>
      <span className="shrink-0 text-[12px] text-ink-2">{hrs(p.loggedSec)}</span>
      <span className="shrink-0 text-[12px] text-accent">{money(p.revenueCents)}</span>
      <span className={`shrink-0 text-[12px] font-medium ${p.marginCents >= 0 ? 'text-green-500' : 'text-red-500'}`}>{money(p.marginCents)}</span>
      <button onClick={() => void del()} className="shrink-0 rounded p-1 text-ink-3 opacity-0 hover:text-red-500 group-hover:opacity-100"><Trash2 size={13} /></button>
    </li>
  );
}

function AddClient({ workspaceId, onDone }: { workspaceId: string; onDone: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const save = async () => {
    if (!name.trim()) return;
    await api('POST', `/workspaces/${workspaceId}/clients`, { name: name.trim() });
    await qc.invalidateQueries({ queryKey: ['projects-overview', workspaceId] });
    onDone();
  };
  return (
    <div className="mb-3 flex gap-2 rounded-xl border border-line bg-elevated p-3">
      <input className={input} placeholder="Client name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      <button onClick={() => void save()} className="shrink-0 rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-white hover:bg-accent-hover">Add</button>
    </div>
  );
}

function AddProject({ workspaceId, clients, onDone }: { workspaceId: string; clients: ClientRollupDto[]; onDone: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ clientId: clients[0]?.id ?? '', name: '', jiraProjectKey: '', billRate: '', costRate: '', budgetHours: '', billable: true });
  const save = async () => {
    if (!f.clientId || !f.name.trim()) return;
    await api('POST', `/workspaces/${workspaceId}/projects`, {
      clientId: f.clientId,
      name: f.name.trim(),
      ...(f.jiraProjectKey.trim() ? { jiraProjectKey: f.jiraProjectKey.trim().toUpperCase() } : {}),
      billRateCents: Math.round((Number(f.billRate) || 0) * 100),
      costRateCents: Math.round((Number(f.costRate) || 0) * 100),
      ...(f.budgetHours ? { budgetHours: Number(f.budgetHours) } : {}),
      billable: f.billable,
    });
    await qc.invalidateQueries({ queryKey: ['projects-overview', workspaceId] });
    onDone();
  };
  return (
    <div className="mb-3 grid grid-cols-2 gap-2 rounded-xl border border-line bg-elevated p-3 sm:grid-cols-3">
      <select className={input} value={f.clientId} onChange={(e) => setF({ ...f, clientId: e.target.value })}>
        {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      <input className={input} placeholder="Project name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
      <input className={input} placeholder="Jira key (KAN)" value={f.jiraProjectKey} onChange={(e) => setF({ ...f, jiraProjectKey: e.target.value })} />
      <input className={input} placeholder="Bill rate $/h" inputMode="decimal" value={f.billRate} onChange={(e) => setF({ ...f, billRate: e.target.value })} />
      <input className={input} placeholder="Cost rate $/h" inputMode="decimal" value={f.costRate} onChange={(e) => setF({ ...f, costRate: e.target.value })} />
      <input className={input} placeholder="Budget hours" inputMode="numeric" value={f.budgetHours} onChange={(e) => setF({ ...f, budgetHours: e.target.value })} />
      <label className="col-span-2 flex items-center gap-2 text-[13px] text-ink-2 sm:col-span-1">
        <input type="checkbox" checked={f.billable} onChange={(e) => setF({ ...f, billable: e.target.checked })} /> Billable
      </label>
      <button onClick={() => void save()} className="rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-white hover:bg-accent-hover">Create project</button>
    </div>
  );
}
