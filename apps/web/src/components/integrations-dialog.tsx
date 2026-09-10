'use client';

import { useState } from 'react';
import { Copy, Plus, Trash2, Webhook, Terminal, Mail } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import type { ChannelDto, ChannelEmailDto } from '@backstages/shared';
import { api } from '@/lib/api';
import { keys, useCustomCommands, useWebhooks } from '@/hooks/queries';
import { Dialog } from './dialog';

const input =
  'w-full rounded-md border border-line-strong px-2.5 py-1.5 text-sm outline-none focus:border-accent dark:border-line dark:bg-gray-800';

export function IntegrationsDialog({
  workspaceId,
  channels,
  onClose,
}: {
  workspaceId: string;
  channels: ChannelDto[];
  onClose: () => void;
}) {
  const [tab, setTab] = useState<'webhooks' | 'commands' | 'email'>('webhooks');
  const tabs: { id: typeof tab; label: string; icon: React.ReactNode }[] = [
    { id: 'webhooks', label: 'Webhooks', icon: <Webhook size={14} /> },
    { id: 'commands', label: 'Commands', icon: <Terminal size={14} /> },
    { id: 'email', label: 'Email', icon: <Mail size={14} /> },
  ];

  return (
    <Dialog title="Integrations" onClose={onClose} wide>
      <div className="mb-3 flex gap-1 border-b border-line">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={
              tab === t.id
                ? 'flex items-center gap-1.5 border-b-2 border-accent px-3 py-1.5 text-sm font-semibold text-accent'
                : 'flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-500 hover:text-gray-800 dark:hover:text-gray-200'
            }
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {tab === 'webhooks' && <WebhooksTab workspaceId={workspaceId} channels={channels} />}
      {tab === 'commands' && <CommandsTab workspaceId={workspaceId} />}
      {tab === 'email' && <EmailTab channels={channels} />}
    </Dialog>
  );
}

function CopyRow({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-1">
      <code className="min-w-0 flex-1 truncate rounded bg-gray-100 px-2 py-1 text-[11px] dark:bg-gray-800">
        {value}
      </code>
      <button
        onClick={() => {
          void navigator.clipboard?.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800"
        title="Copy"
      >
        <Copy size={13} />
      </button>
      {copied && <span className="text-[11px] font-medium text-green-600">✓</span>}
    </div>
  );
}

function WebhooksTab({ workspaceId, channels }: { workspaceId: string; channels: ChannelDto[] }) {
  const qc = useQueryClient();
  const hooks = useWebhooks(workspaceId);
  const [name, setName] = useState('');
  const [channelId, setChannelId] = useState(channels[0]?.id ?? '');

  const create = async () => {
    if (!name.trim() || !channelId) return;
    await api('POST', `/workspaces/${workspaceId}/webhooks`, { name: name.trim(), channelId });
    await qc.invalidateQueries({ queryKey: keys.webhooks(workspaceId) });
    setName('');
  };
  const remove = async (id: string) => {
    await api('DELETE', `/webhooks/${id}`);
    await qc.invalidateQueries({ queryKey: keys.webhooks(workspaceId) });
  };

  return (
    <div>
      <p className="mb-2 text-xs text-gray-500">
        Let external tools (CI, monitoring, cron) POST JSON <code>{'{ "text": "..." }'}</code> to a URL and it posts into a channel.
      </p>
      <div className="mb-3 flex gap-2">
        <input className={input} placeholder="Name (e.g. Deploy bot)" value={name} onChange={(e) => setName(e.target.value)} data-testid="webhook-name" />
        <select className={input} value={channelId} onChange={(e) => setChannelId(e.target.value)}>
          {channels.map((c) => (
            <option key={c.id} value={c.id}>#{c.name}</option>
          ))}
        </select>
        <button onClick={() => void create()} className="shrink-0 rounded-md bg-accent px-3 text-sm font-semibold text-white hover:bg-accent-hover" data-testid="create-webhook">
          <Plus size={14} />
        </button>
      </div>
      <ul className="space-y-2">
        {(hooks.data ?? []).map((h) => (
          <li key={h.id} className="rounded-lg border border-line p-2 dark:border-line">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-sm font-medium">{h.name}</span>
              <button onClick={() => void remove(h.id)} className="rounded p-1 text-gray-400 hover:text-red-600">
                <Trash2 size={13} />
              </button>
            </div>
            <CopyRow value={h.url} />
          </li>
        ))}
        {hooks.isSuccess && hooks.data.length === 0 && (
          <li className="py-3 text-center text-xs text-gray-400">No webhooks yet.</li>
        )}
      </ul>
    </div>
  );
}

function CommandsTab({ workspaceId }: { workspaceId: string }) {
  const qc = useQueryClient();
  const commands = useCustomCommands(workspaceId);
  const [trigger, setTrigger] = useState('');
  const [responseText, setResponseText] = useState('');

  const create = async () => {
    if (!trigger.trim() || !responseText.trim()) return;
    await api('POST', `/workspaces/${workspaceId}/custom-commands`, {
      trigger: trigger.trim(),
      description: '',
      responseText: responseText.trim(),
    });
    await qc.invalidateQueries({ queryKey: keys.customCommands(workspaceId) });
    setTrigger('');
    setResponseText('');
  };
  const remove = async (id: string) => {
    await api('DELETE', `/custom-commands/${id}`);
    await qc.invalidateQueries({ queryKey: keys.customCommands(workspaceId) });
  };

  return (
    <div>
      <p className="mb-2 text-xs text-gray-500">
        Define a slash command that posts a canned response. Type <code>/trigger</code> in any channel.
      </p>
      <div className="mb-3 space-y-2">
        <div className="flex items-center gap-1">
          <span className="text-sm text-gray-400">/</span>
          <input className={input} placeholder="trigger" value={trigger} onChange={(e) => setTrigger(e.target.value)} data-testid="command-trigger" />
        </div>
        <textarea className={input} rows={2} placeholder="Response text…" value={responseText} onChange={(e) => setResponseText(e.target.value)} />
        <button onClick={() => void create()} className="rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-white hover:bg-accent-hover" data-testid="create-command">
          Add command
        </button>
      </div>
      <ul className="space-y-1">
        {(commands.data ?? []).map((c) => (
          <li key={c.id} className="flex items-center gap-2 rounded-md border border-line px-2 py-1.5 dark:border-line">
            <code className="rounded bg-gray-100 px-1.5 text-xs font-semibold dark:bg-gray-800">/{c.trigger}</code>
            <span className="min-w-0 flex-1 truncate text-xs text-gray-500">{c.responseText}</span>
            <button onClick={() => void remove(c.id)} className="rounded p-1 text-gray-400 hover:text-red-600">
              <Trash2 size={13} />
            </button>
          </li>
        ))}
        {commands.isSuccess && commands.data.length === 0 && (
          <li className="py-3 text-center text-xs text-gray-400">No custom commands yet.</li>
        )}
      </ul>
    </div>
  );
}

function EmailTab({ channels }: { channels: ChannelDto[] }) {
  const [channelId, setChannelId] = useState(channels[0]?.id ?? '');
  const [address, setAddress] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reveal = async () => {
    setBusy(true);
    try {
      const r = await api<ChannelEmailDto>('GET', `/channels/${channelId}/email`);
      setAddress(r.address);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <p className="mb-2 text-xs text-gray-500">
        Get a per-channel email address. Emails forwarded there (via your mail provider) post as messages.
      </p>
      <div className="mb-3 flex gap-2">
        <select className={input} value={channelId} onChange={(e) => { setChannelId(e.target.value); setAddress(null); }}>
          {channels.map((c) => (
            <option key={c.id} value={c.id}>#{c.name}</option>
          ))}
        </select>
        <button onClick={() => void reveal()} disabled={busy} className="shrink-0 rounded-md bg-accent px-3 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50">
          {busy ? '…' : 'Get address'}
        </button>
      </div>
      {address && <CopyRow value={address} />}
    </div>
  );
}
