'use client';

import { useState } from 'react';
import { ArrowLeftRight, Trash2 } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ChannelShareDto, ChannelShareInviteDto, IncomingSharedChannelDto } from '@backstages/shared';
import { api } from '@/lib/api';
import { keys, useChannels } from '@/hooks/queries';
import { useUiStore } from '@/stores/ui-store';
import { inputCls, OneTimeSecret, primaryBtn, secondaryBtn } from './account-security';

const errText = (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback);

/**
 * Channels shared between workspaces. Everyone sees what was shared into this
 * workspace (and can join); admins share channels out and accept invites.
 */
export function SharedChannelsSettings({ workspaceId, isAdmin }: { workspaceId: string; isAdmin: boolean }) {
  return (
    <div className="max-h-[65vh] space-y-4 overflow-y-auto pr-1">
      <p className="text-[13px] text-gray-500">
        Work with another organization in one channel. People from the partner workspace can read and post there, but
        never see the rest of this workspace, its integrations or its admin tools.
      </p>
      <IncomingSection workspaceId={workspaceId} />
      {isAdmin && <AcceptSection workspaceId={workspaceId} />}
      {isAdmin && <OutgoingSection workspaceId={workspaceId} />}
    </div>
  );
}

function Box({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-line p-3 dark:border-line">
      <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
        <ArrowLeftRight size={15} />
        {title}
      </h3>
      {children}
    </section>
  );
}

function IncomingSection({ workspaceId }: { workspaceId: string }) {
  const qc = useQueryClient();
  const pushToast = useUiStore((s) => s.pushToast);
  const key = ['shared-incoming', workspaceId];
  const incoming = useQuery({
    queryKey: key,
    queryFn: () => api<IncomingSharedChannelDto[]>('GET', `/workspaces/${workspaceId}/shared-channels`),
  });

  const join = async (c: IncomingSharedChannelDto) => {
    try {
      await api('POST', `/shared-channels/${c.shareId}/join`);
      await Promise.all([
        qc.invalidateQueries({ queryKey: key }),
        qc.invalidateQueries({ queryKey: keys.channels(workspaceId) }),
      ]);
      pushToast(`Joined #${c.name}.`, 'success');
    } catch (err) {
      pushToast(errText(err, 'Could not join'), 'error');
    }
  };

  return (
    <Box title="Shared with this workspace">
      <ul className="space-y-1.5">
        {(incoming.data ?? []).map((c) => (
          <li key={c.shareId} className="flex items-center gap-2 rounded-md border border-line px-2.5 py-2 text-[13px] dark:border-line">
            <span className="font-medium">#{c.name}</span>
            <span className="text-xs text-gray-500">from {c.host.name}</span>
            <span className="ml-auto">
              {c.isMember ? (
                <span className="text-xs text-gray-500">Joined</span>
              ) : (
                <button className={secondaryBtn} onClick={() => void join(c)} disabled={c.isArchived} data-testid={`join-shared-${c.name}`}>
                  Join
                </button>
              )}
            </span>
          </li>
        ))}
        {incoming.data?.length === 0 && (
          <li className="rounded-md border border-dashed border-line-strong p-3 text-center text-sm text-gray-500 dark:border-line-strong">
            No channels have been shared with this workspace.
          </li>
        )}
      </ul>
    </Box>
  );
}

function AcceptSection({ workspaceId }: { workspaceId: string }) {
  const qc = useQueryClient();
  const pushToast = useUiStore((s) => s.pushToast);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);

  const accept = async () => {
    setBusy(true);
    try {
      const res = await api<IncomingSharedChannelDto>('POST', `/workspaces/${workspaceId}/shared-channels/accept`, {
        token: token.trim(),
      });
      setToken('');
      await qc.invalidateQueries({ queryKey: ['shared-incoming', workspaceId] });
      pushToast(`#${res.name} from ${res.host.name} is now shared with this workspace.`, 'success');
    } catch (err) {
      pushToast(errText(err, 'Could not accept the invite'), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box title="Accept an invite">
      <p className="mb-2 text-[13px] text-gray-500">Paste the invite another workspace's admin sent you.</p>
      <div className="flex gap-2">
        <input
          className={inputCls}
          placeholder="bs_share_…"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          aria-label="Shared channel invite"
          autoComplete="off"
        />
        <button className={primaryBtn} onClick={() => void accept()} disabled={busy || token.trim().length < 10}>
          Accept
        </button>
      </div>
    </Box>
  );
}

function OutgoingSection({ workspaceId }: { workspaceId: string }) {
  const qc = useQueryClient();
  const pushToast = useUiStore((s) => s.pushToast);
  const channels = useChannels(workspaceId);
  const shareable = (channels.data ?? []).filter((c) => c.workspaceId === workspaceId && !c.isPrivate && !c.isDefault);
  const [channelId, setChannelId] = useState('');
  const selected = channelId || shareable[0]?.id || '';
  const key = ['channel-shares', selected];
  const shares = useQuery({
    queryKey: key,
    queryFn: () => api<ChannelShareDto[]>('GET', `/channels/${selected}/shares`),
    enabled: !!selected,
  });
  const [invite, setInvite] = useState<string | null>(null);

  const create = async () => {
    try {
      const res = await api<ChannelShareInviteDto>('POST', `/channels/${selected}/shares`);
      setInvite(res.token);
      await qc.invalidateQueries({ queryKey: key });
    } catch (err) {
      pushToast(errText(err, 'Could not create an invite'), 'error');
    }
  };
  const revoke = async (id: string) => {
    try {
      await api('DELETE', `/channel-shares/${id}`);
      await Promise.all([
        qc.invalidateQueries({ queryKey: key }),
        qc.invalidateQueries({ queryKey: keys.channels(workspaceId) }),
      ]);
    } catch (err) {
      pushToast(errText(err, 'Could not end the share'), 'error');
    }
  };

  return (
    <Box title="Share a channel">
      {shareable.length === 0 ? (
        <p className="text-[13px] text-gray-500">Join a public channel (other than the default one) to share it.</p>
      ) : (
        <>
          <div className="mb-2 flex gap-2">
            <select
              className={inputCls}
              value={selected}
              onChange={(e) => {
                setChannelId(e.target.value);
                setInvite(null);
              }}
              aria-label="Channel to share"
            >
              {shareable.map((c) => (
                <option key={c.id} value={c.id}>
                  #{c.name}
                </option>
              ))}
            </select>
            <button className={primaryBtn} onClick={() => void create()} data-testid="create-share-invite">
              Create invite
            </button>
          </div>
          {invite && (
            <div className="mb-2">
              <OneTimeSecret
                label="Send this invite to an admin of the other workspace. It works once and expires in 7 days."
                value={invite}
                onDone={() => setInvite(null)}
              />
            </div>
          )}
          <ul className="space-y-1">
            {(shares.data ?? [])
              .filter((s) => s.status !== 'revoked')
              .map((s) => (
                <li key={s.id} className="flex items-center gap-2 text-[13px]">
                  <span className="font-medium">{s.partner?.name ?? 'Pending invite'}</span>
                  <span className="text-xs text-gray-500">{s.status}</span>
                  <button
                    onClick={() => void revoke(s.id)}
                    className="ml-auto rounded p-1 text-gray-400 hover:text-red-500"
                    aria-label={s.partner ? `Stop sharing with ${s.partner.name}` : 'Cancel invite'}
                  >
                    <Trash2 size={14} />
                  </button>
                </li>
              ))}
          </ul>
        </>
      )}
    </Box>
  );
}
