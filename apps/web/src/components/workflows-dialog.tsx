'use client';

import { useState } from 'react';
import { Plus, Trash2, Zap } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { keys, useWorkflows, type ChannelWithMeta, type WorkflowView } from '@/hooks/queries';
import { useUiStore } from '@/stores/ui-store';
import { Dialog } from './dialog';

/**
 * Workflow builder: "when a message is posted in #X (optionally containing a
 * keyword), post a message to #Y". A small but real automation over the
 * existing message-posted event.
 */
export function WorkflowsDialog({
  workspaceId,
  channels,
  onClose,
}: {
  workspaceId: string;
  channels: ChannelWithMeta[];
  onClose: () => void;
}) {
  const workflows = useWorkflows(workspaceId);
  const qc = useQueryClient();
  const pushToast = useUiStore((s) => s.pushToast);
  const [creating, setCreating] = useState(false);

  const refresh = () => qc.invalidateQueries({ queryKey: keys.workflows(workspaceId) });

  const remove = async (id: string) => {
    try {
      await api('DELETE', `/workflows/${id}`);
      await refresh();
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Could not delete', 'error');
    }
  };

  const toggle = async (wf: WorkflowView) => {
    try {
      await api('PUT', `/workflows/${wf.id}`, {
        name: wf.name,
        trigger: wf.trigger,
        enabled: !wf.enabled,
        config: wf.config,
      });
      await refresh();
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Could not update', 'error');
    }
  };

  const nameFor = (id: string) => channels.find((c) => c.id === id)?.name ?? 'unknown';

  return (
    <Dialog title="Workflows" onClose={onClose} wide>
      <p className="mb-3 text-sm text-gray-500 dark:text-gray-400">
        Automate routine posts. Rules run when someone sends a message.
      </p>

      <ul className="mb-4 space-y-2">
        {(workflows.data ?? []).map((wf) => (
          <li
            key={wf.id}
            className="flex items-start gap-3 rounded-lg border border-gray-200 p-3 dark:border-gray-700"
            data-testid="workflow-row"
          >
            <Zap size={16} className={wf.enabled ? 'mt-0.5 text-accent' : 'mt-0.5 text-gray-300'} />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold">{wf.name}</div>
              <div className="text-[12px] text-gray-500">
                When a message{wf.config.keyword ? ` containing “${wf.config.keyword}”` : ''} is posted
                in <strong>#{nameFor(wf.config.channelId)}</strong> → post to{' '}
                <strong>#{nameFor(wf.config.actionChannelId)}</strong>
              </div>
            </div>
            <label className="flex shrink-0 items-center gap-1 text-[12px] text-gray-500">
              <input type="checkbox" checked={wf.enabled} onChange={() => void toggle(wf)} />
              On
            </label>
            <button
              onClick={() => void remove(wf.id)}
              title="Delete"
              className="shrink-0 rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/30"
            >
              <Trash2 size={15} />
            </button>
          </li>
        ))}
        {(workflows.data ?? []).length === 0 && !creating && (
          <li className="rounded-lg border border-dashed border-gray-300 p-4 text-center text-sm text-gray-500 dark:border-gray-600">
            No workflows yet.
          </li>
        )}
      </ul>

      {creating ? (
        <WorkflowForm
          workspaceId={workspaceId}
          channels={channels}
          onDone={async () => {
            setCreating(false);
            await refresh();
          }}
          onCancel={() => setCreating(false)}
        />
      ) : (
        <button
          onClick={() => setCreating(true)}
          className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-white hover:bg-accent-hover"
          data-testid="new-workflow"
        >
          <Plus size={15} /> New workflow
        </button>
      )}
    </Dialog>
  );
}

function WorkflowForm({
  workspaceId,
  channels,
  onDone,
  onCancel,
}: {
  workspaceId: string;
  channels: ChannelWithMeta[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const pushToast = useUiStore((s) => s.pushToast);
  const [name, setName] = useState('');
  const [channelId, setChannelId] = useState(channels[0]?.id ?? '');
  const [keyword, setKeyword] = useState('');
  const [actionChannelId, setActionChannelId] = useState(channels[0]?.id ?? '');
  const [actionText, setActionText] = useState('');
  const [busy, setBusy] = useState(false);

  const inputCls =
    'w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm outline-none focus:border-accent dark:border-gray-600 dark:bg-gray-800';

  const submit = async () => {
    if (!name.trim() || !channelId || !actionChannelId || !actionText.trim()) {
      pushToast('Fill in the name, channels and message.', 'error');
      return;
    }
    setBusy(true);
    try {
      await api('POST', `/workspaces/${workspaceId}/workflows`, {
        name: name.trim(),
        trigger: 'message_posted',
        enabled: true,
        config: { channelId, keyword: keyword.trim() || undefined, actionChannelId, actionText: actionText.trim() },
      });
      onDone();
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Could not create workflow', 'error');
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
      <input
        className={`${inputCls} mb-2`}
        placeholder="Workflow name (e.g. Deploy notifier)"
        value={name}
        onChange={(e) => setName(e.target.value)}
        autoFocus
      />
      <div className="mb-2 grid grid-cols-2 gap-2">
        <label className="text-xs font-medium text-gray-500">
          When posted in
          <select className={`${inputCls} mt-1`} value={channelId} onChange={(e) => setChannelId(e.target.value)}>
            {channels.map((c) => (
              <option key={c.id} value={c.id}>#{c.name}</option>
            ))}
          </select>
        </label>
        <label className="text-xs font-medium text-gray-500">
          Containing (optional)
          <input className={`${inputCls} mt-1`} placeholder="keyword" value={keyword} onChange={(e) => setKeyword(e.target.value)} />
        </label>
      </div>
      <label className="mb-2 block text-xs font-medium text-gray-500">
        Post to
        <select className={`${inputCls} mt-1`} value={actionChannelId} onChange={(e) => setActionChannelId(e.target.value)}>
          {channels.map((c) => (
            <option key={c.id} value={c.id}>#{c.name}</option>
          ))}
        </select>
      </label>
      <textarea
        className={`${inputCls} mb-3 resize-y`}
        rows={2}
        placeholder="Message to post"
        value={actionText}
        onChange={(e) => setActionText(e.target.value)}
      />
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-800">
          Cancel
        </button>
        <button
          onClick={() => void submit()}
          disabled={busy}
          className="rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
          data-testid="save-workflow"
        >
          {busy ? 'Saving…' : 'Create workflow'}
        </button>
      </div>
    </div>
  );
}
