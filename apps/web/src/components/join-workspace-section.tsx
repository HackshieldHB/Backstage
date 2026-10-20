'use client';

import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Globe, Link2, Users } from 'lucide-react';
import type { JoinableWorkspaceDto, JoinWorkspaceResultDto, MyInvitationDto } from '@backstages/shared';
import { api } from '@/lib/api';
import { inviteTokenFrom } from '@/lib/invite-link';
import { keys } from '@/hooks/queries';

const input =
  'w-full rounded-md border border-line-strong bg-elevated px-3 py-2 text-sm text-ink outline-none focus:border-accent';
const secondary =
  'shrink-0 rounded-md border border-line-strong px-3 py-1.5 text-sm font-medium text-ink hover:bg-hovered disabled:opacity-50';

function WorkspaceBadge({ name }: { name: string }) {
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-sm font-bold text-accent">
      {name.charAt(0).toUpperCase()}
    </span>
  );
}

/**
 * "Join an existing workspace": invitations sent to your email, workspaces open
 * to your verified email domain (join or ask to join), and invite links.
 * `onJoined` gets the workspace id to open.
 */
export function JoinWorkspaceSection({
  onJoined,
  onError,
}: {
  onJoined: (workspaceId: string) => void;
  onError: (msg: string | null) => void;
}) {
  const qc = useQueryClient();
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const invitations = useQuery({
    queryKey: ['my-invitations'],
    queryFn: () => api<MyInvitationDto[]>('GET', '/me/invitations'),
  });
  const joinable = useQuery({
    queryKey: ['joinable-workspaces'],
    queryFn: () => api<JoinableWorkspaceDto[]>('GET', '/me/joinable-workspaces'),
  });
  const linkToken = useMemo(() => inviteTokenFrom(link), [link]);

  const done = async (workspaceId: string) => {
    await qc.invalidateQueries({ queryKey: keys.workspaces });
    onJoined(workspaceId);
  };

  const run = async (key: string, fn: () => Promise<void>, fallback: string) => {
    setBusy(key);
    onError(null);
    try {
      await fn();
    } catch (err) {
      onError(err instanceof Error ? err.message : fallback);
      void invitations.refetch();
      void joinable.refetch();
    } finally {
      setBusy(null);
    }
  };

  const acceptInvite = (inv: MyInvitationDto) =>
    run(
      inv.id,
      async () => {
        const ws = await api<{ id: string }>('POST', `/me/invitations/${inv.id}/accept`, undefined, { retry: false });
        await done(ws.id);
      },
      'Could not join that workspace',
    );

  const joinDomain = (w: JoinableWorkspaceDto) =>
    run(
      w.id,
      async () => {
        const res = await api<JoinWorkspaceResultDto>('POST', `/workspaces/${w.id}/join`, undefined, { retry: false });
        if (res.status === 'joined') await done(res.workspaceId);
        else await joinable.refetch();
      },
      'Could not join that workspace',
    );

  const joinLink = (token: string) =>
    run(
      'link',
      async () => {
        const ws = await api<{ id: string }>('POST', '/invites/accept', { token }, { retry: false });
        await done(ws.id);
      },
      'That invite link is not valid',
    );

  const invites = invitations.data ?? [];
  const open = (joinable.data ?? []).filter((w) => !invites.some((i) => i.workspace.id === w.id));
  const loading = invitations.isLoading || joinable.isLoading;

  return (
    <div data-testid="join-workspace-section">
      {loading ? (
        <p className="mb-4 text-sm text-ink-3">Looking for workspaces you can join…</p>
      ) : invites.length + open.length > 0 ? (
        <ul className="mb-4 space-y-2">
          {invites.map((inv) => (
            <li key={inv.id} className="flex items-center gap-3 rounded-lg border border-line p-3">
              <WorkspaceBadge name={inv.workspace.name} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-ink">{inv.workspace.name}</span>
                <span className="block truncate text-xs text-ink-3">
                  {inv.invitedBy} invited you · {inv.workspace.memberCount} member{inv.workspace.memberCount === 1 ? '' : 's'}
                </span>
              </span>
              <button className={secondary} disabled={busy !== null} onClick={() => void acceptInvite(inv)} data-testid="welcome-accept-invite">
                {busy === inv.id ? 'Joining…' : 'Join'}
              </button>
            </li>
          ))}
          {open.map((w) => (
            <li key={w.id} className="flex items-center gap-3 rounded-lg border border-line p-3" data-testid="joinable-workspace">
              <WorkspaceBadge name={w.name} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-ink">{w.name}</span>
                <span className="flex items-center gap-1 truncate text-xs text-ink-3">
                  <Globe size={11} /> Open to @{w.domain} · {w.memberCount} member{w.memberCount === 1 ? '' : 's'}
                </span>
              </span>
              {w.requestStatus === 'PENDING' ? (
                <span className="shrink-0 text-xs font-medium text-amber-600 dark:text-amber-400">Request sent</span>
              ) : (
                <button className={secondary} disabled={busy !== null} onClick={() => void joinDomain(w)} data-testid="join-domain-workspace">
                  {busy === w.id
                    ? '…'
                    : w.policy === 'AUTO'
                      ? 'Join'
                      : w.requestStatus === 'DENIED'
                        ? 'Ask again'
                        : 'Ask to join'}
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mb-4 flex items-start gap-2 rounded-lg bg-hovered px-3 py-2 text-sm text-ink-2">
          <Users size={15} className="mt-0.5 shrink-0" />
          No invitations or open workspaces for your email yet. Ask a teammate to invite you, or paste an invite link below.
        </p>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (linkToken) void joinLink(linkToken);
        }}
      >
        <label className="mb-1 flex items-center gap-1.5 text-sm font-medium text-ink-2" htmlFor="join-link">
          <Link2 size={14} /> Have an invite link?
        </label>
        <div className="flex gap-2">
          <input
            id="join-link"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="https://…/invite/…"
            className={input}
            data-testid="welcome-invite-link"
          />
          <button type="submit" className={secondary} disabled={!linkToken || busy !== null}>
            {busy === 'link' ? 'Joining…' : 'Join'}
          </button>
        </div>
        {link.trim() && !linkToken && <p className="mt-1 text-xs text-red-600">That doesn&apos;t look like an invite link.</p>}
      </form>
    </div>
  );
}
