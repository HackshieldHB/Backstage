'use client';

import { useState } from 'react';
import { CalendarClock, CheckCircle2, Circle, Plus, Trash2, User as UserIcon } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import type { ChannelDto, DecisionDto } from '@backstages/shared';
import { api } from '@/lib/api';
import { keys, useDecisions, useMembers } from '@/hooks/queries';
import { Dialog } from './dialog';
import { Avatar } from './avatar';

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

const input =
  'w-full rounded-md border border-line-strong px-2.5 py-1.5 text-sm outline-none focus:border-accent dark:border-line dark:bg-gray-800';

export function DecisionsDialog({
  workspaceId,
  channels,
  onClose,
}: {
  workspaceId: string;
  channels: ChannelDto[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const decisions = useDecisions(workspaceId);
  const members = useMembers(workspaceId);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [detail, setDetail] = useState('');
  const [channelId, setChannelId] = useState(channels[0]?.id ?? '');
  const [ownerId, setOwnerId] = useState('');
  const [due, setDue] = useState('');

  const create = async () => {
    if (!title.trim() || !channelId) return;
    await api('POST', `/workspaces/${workspaceId}/decisions`, {
      title: title.trim(),
      detail,
      channelId,
      ...(ownerId ? { ownerId } : {}),
      ...(due ? { dueAt: new Date(due).toISOString() } : {}),
    });
    await qc.invalidateQueries({ queryKey: keys.decisions(workspaceId) });
    setTitle('');
    setDetail('');
    setOwnerId('');
    setDue('');
    setCreating(false);
  };

  return (
    <Dialog title="Decisions" onClose={onClose} wide>
      <p className="mb-3 text-sm text-gray-500">
        Capture decisions so they don&apos;t get lost in the scroll. Deciding one posts a summary to its channel.
      </p>

      {creating ? (
        <div className="mb-3 rounded-lg border border-line p-3 dark:border-line">
          <input className={`${input} mb-2`} placeholder="What needs deciding?" value={title} onChange={(e) => setTitle(e.target.value)} data-testid="decision-title" />
          <textarea className={`${input} mb-2`} rows={2} placeholder="Context (optional)" value={detail} onChange={(e) => setDetail(e.target.value)} />
          <div className="mb-2 flex items-center gap-2">
            <select className={input} value={ownerId} onChange={(e) => setOwnerId(e.target.value)} data-testid="decision-owner">
              <option value="">Owner (optional)</option>
              {(members.data ?? []).map((m) => (
                <option key={m.user.id} value={m.user.id}>{m.user.displayName}</option>
              ))}
            </select>
            <input
              type="date"
              className={input}
              value={due}
              onChange={(e) => setDue(e.target.value)}
              data-testid="decision-due"
              aria-label="Due date"
            />
          </div>
          <div className="flex items-center gap-2">
            <select className={input} value={channelId} onChange={(e) => setChannelId(e.target.value)}>
              {channels.map((c) => (
                <option key={c.id} value={c.id}>#{c.name}</option>
              ))}
            </select>
            <button onClick={() => void create()} className="shrink-0 rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-white hover:bg-accent-hover" data-testid="create-decision">
              Add
            </button>
            <button onClick={() => setCreating(false)} className="shrink-0 rounded-md px-2 py-1.5 text-sm text-gray-500 hover:bg-hovered">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button onClick={() => setCreating(true)} className="mb-3 flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-white hover:bg-accent-hover" data-testid="new-decision">
          <Plus size={14} /> New decision
        </button>
      )}

      <ul className="space-y-2">
        {(decisions.data ?? []).map((d) => (
          <DecisionRow key={d.id} decision={d} workspaceId={workspaceId} />
        ))}
        {decisions.isSuccess && decisions.data.length === 0 && !creating && (
          <li className="rounded-lg border border-dashed border-line-strong py-6 text-center text-sm text-gray-500 dark:border-line">
            No decisions yet.
          </li>
        )}
      </ul>
    </Dialog>
  );
}

function DecisionRow({ decision, workspaceId }: { decision: DecisionDto; workspaceId: string }) {
  const qc = useQueryClient();
  const [deciding, setDeciding] = useState(false);
  const [outcome, setOutcome] = useState('');
  const decided = decision.status === 'DECIDED';

  const decide = async () => {
    if (!outcome.trim()) return;
    await api('POST', `/decisions/${decision.id}/decide`, { outcome: outcome.trim() });
    await qc.invalidateQueries({ queryKey: keys.decisions(workspaceId) });
    setDeciding(false);
  };
  const remove = async () => {
    await api('DELETE', `/decisions/${decision.id}`);
    await qc.invalidateQueries({ queryKey: keys.decisions(workspaceId) });
  };

  return (
    <li className="rounded-lg border border-line p-3 dark:border-line">
      <div className="flex items-start gap-2">
        {decided ? <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-green-600" /> : <Circle size={16} className="mt-0.5 shrink-0 text-gray-400" />}
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">{decision.title}</div>
          {decision.detail && <div className="text-xs text-gray-500">{decision.detail}</div>}
          {decided && (
            <div className="mt-1 rounded bg-green-50 px-2 py-1 text-xs text-green-800 dark:bg-green-900/30 dark:text-green-300">
              → {decision.outcome}
            </div>
          )}
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-gray-400">
            <span className="flex items-center gap-1">
              <Avatar user={decision.createdBy} size="xs" /> {decision.createdBy.displayName}
            </span>
            {decision.owner && (
              <span className="flex items-center gap-0.5" data-testid="decision-owner-label">
                <UserIcon size={11} /> {decision.owner.displayName}
              </span>
            )}
            {decision.dueAt && (
              <span className="flex items-center gap-0.5">
                <CalendarClock size={11} /> due {fmtDate(decision.dueAt)}
              </span>
            )}
            {decided && decision.decidedBy && <span>· decided by {decision.decidedBy.displayName}</span>}
          </div>
        </div>
        <button onClick={() => void remove()} className="rounded p-1 text-gray-400 hover:text-red-600">
          <Trash2 size={13} />
        </button>
      </div>

      {!decided && (
        <div className="mt-2">
          {deciding ? (
            <div className="flex items-center gap-2">
              <input className={input} placeholder="Outcome…" value={outcome} onChange={(e) => setOutcome(e.target.value)} autoFocus data-testid="decision-outcome" />
              <button onClick={() => void decide()} className="shrink-0 rounded-md bg-green-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-green-700" data-testid="confirm-decide">
                Record
              </button>
            </div>
          ) : (
            <button onClick={() => setDeciding(true)} className="rounded-md border border-line-strong px-2.5 py-1 text-xs font-medium hover:bg-gray-50 dark:border-line-strong dark:hover:bg-gray-800" data-testid="decide-button">
              Mark decided
            </button>
          )}
        </div>
      )}
    </li>
  );
}
