'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Link2, Mail, Plus, Users } from 'lucide-react';
import type { MyInvitationDto, UserDto } from '@backstages/shared';
import { api } from '@/lib/api';
import { inviteTokenFrom } from '@/lib/invite-link';
import { keys, useWorkspaces } from '@/hooks/queries';
import { useAuthStore } from '@/stores/auth-store';
import { Avatar } from '@/components/avatar';

const PENDING_INVITE = 'bs.pendingInvite';

const input =
  'w-full rounded-md border border-line-strong bg-elevated px-3 py-2 text-sm text-ink outline-none focus:border-accent';
const primary =
  'flex w-full items-center justify-center gap-1.5 rounded-md bg-accent px-3 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50';
const secondary =
  'rounded-md border border-line-strong px-3 py-1.5 text-sm font-medium text-ink hover:bg-hovered disabled:opacity-50';

function takePendingInvite(): string | null {
  try {
    const token = window.localStorage.getItem(PENDING_INVITE);
    if (token) window.localStorage.removeItem(PENDING_INVITE);
    return token;
  } catch {
    return null;
  }
}

/**
 * First-run flow after signing up (Google/GitHub/Atlassian/SSO or email):
 *   1. confirm your name (pre-filled from the provider) — social sign-ups only;
 *   2. create a workspace, or join one you were invited to / have a link for.
 * Then on to the app. People who already have both are sent straight to /app.
 */
export default function WelcomePage() {
  const router = useRouter();
  const { user, loading, setUser, logout } = useAuthStore();
  const workspaces = useWorkspaces();
  const [error, setError] = useState<string | null>(null);
  const joining = useRef(false);

  const hasWorkspace = (workspaces.data?.length ?? 0) > 0;
  const step: 'profile' | 'workspace' | 'done' = !user
    ? 'profile'
    : user.needsOnboarding
      ? 'profile'
      : workspaces.isSuccess && !hasWorkspace
        ? 'workspace'
        : 'done';

  useEffect(() => {
    if (!loading && !user) router.replace('/login');
  }, [loading, user, router]);

  /** Accept an invite link and go to that workspace. */
  const joinWithToken = async (token: string) => {
    joining.current = true;
    setError(null);
    try {
      const ws = await api<{ id: string }>('POST', '/invites/accept', { token }, { retry: false });
      router.replace(`/app?ws=${ws.id}`);
    } catch (e) {
      joining.current = false;
      setError(e instanceof Error ? e.message : 'That invite link is not valid');
    }
  };

  // Once the profile is done: an invite opened before signing up wins; otherwise
  // anyone who already has a workspace goes to the app.
  useEffect(() => {
    if (!user || user.needsOnboarding || !workspaces.isSuccess || joining.current) return;
    const pending = takePendingInvite();
    if (pending) {
      void joinWithToken(pending);
      return;
    }
    if (hasWorkspace) router.replace('/app');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, workspaces.isSuccess, hasWorkspace]);

  if (loading || !user || step === 'done' || (step === 'workspace' && workspaces.isLoading)) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-canvas">
        <div className="animate-pulse text-lg font-semibold text-sidebar dark:text-white">Backstages</div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-start justify-center bg-canvas px-4 py-10 sm:items-center">
      <div className="w-full max-w-3xl">
        <div className="mb-6 text-center">
          <div className="text-lg font-bold text-sidebar dark:text-white">Backstages</div>
          <p className="mt-1 text-xs text-ink-3">
            Step {step === 'profile' ? 1 : 2} of 2 · {step === 'profile' ? 'Your profile' : 'Your workspace'}
          </p>
        </div>
        {error && (
          <p className="mx-auto mb-4 max-w-md rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300" role="alert">
            {error}
          </p>
        )}
        {step === 'profile' ? (
          <ProfileStep user={user} onDone={setUser} onError={setError} />
        ) : (
          <WorkspaceStep onJoinToken={joinWithToken} onError={setError} />
        )}
        <p className="mt-6 text-center text-xs text-ink-3">
          Signed in as {user.email} ·{' '}
          <button className="text-accent hover:underline" onClick={() => void logout()}>
            Use a different account
          </button>
        </p>
      </div>
    </main>
  );
}

function ProfileStep({
  user,
  onDone,
  onError,
}: {
  user: UserDto;
  onDone: (u: UserDto) => void;
  onError: (msg: string | null) => void;
}) {
  const [name, setName] = useState(user.displayName);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    onError(null);
    try {
      onDone(await api<UserDto>('POST', '/me/onboarding', { displayName: name.trim() }));
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Could not save your name');
      setBusy(false);
    }
  };
  return (
    <form
      onSubmit={submit}
      className="mx-auto max-w-md rounded-xl border border-line bg-surface p-6 shadow-sm"
      data-testid="welcome-profile"
    >
      <div className="mb-5 flex flex-col items-center text-center">
        <Avatar user={{ ...user, displayName: name || user.displayName }} size="lg" />
        <h1 className="mt-3 text-lg font-semibold text-ink">Welcome! What should we call you?</h1>
        <p className="mt-1 text-sm text-ink-2">This is how teammates see you in chats and meetings. You can change it later.</p>
      </div>
      <label className="mb-1 block text-sm font-medium text-ink-2" htmlFor="welcome-name">
        Your name
      </label>
      <input
        id="welcome-name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={80}
        autoFocus
        required
        className={input}
        data-testid="welcome-name"
      />
      <p className="mb-4 mt-2 flex items-center gap-1.5 text-xs text-ink-3">
        <Mail size={12} /> {user.email}
      </p>
      <button type="submit" disabled={busy || !name.trim()} className={primary} data-testid="welcome-continue">
        {busy ? 'Saving…' : 'Continue'}
      </button>
    </form>
  );
}

function WorkspaceStep({
  onJoinToken,
  onError,
}: {
  onJoinToken: (token: string) => Promise<void>;
  onError: (msg: string | null) => void;
}) {
  const router = useRouter();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const invitations = useQuery({
    queryKey: ['my-invitations'],
    queryFn: () => api<MyInvitationDto[]>('GET', '/me/invitations'),
  });
  const linkToken = useMemo(() => inviteTokenFrom(link), [link]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy('create');
    onError(null);
    try {
      const ws = await api<{ id: string }>('POST', '/workspaces', { name: name.trim() });
      await qc.invalidateQueries({ queryKey: keys.workspaces });
      router.replace(`/app?ws=${ws.id}`);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Could not create the workspace');
      setBusy(null);
    }
  };

  const accept = async (inv: MyInvitationDto) => {
    setBusy(inv.id);
    onError(null);
    try {
      const ws = await api<{ id: string }>('POST', `/me/invitations/${inv.id}/accept`, undefined, { retry: false });
      await qc.invalidateQueries({ queryKey: keys.workspaces });
      router.replace(`/app?ws=${ws.id}`);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Could not join that workspace');
      setBusy(null);
      void invitations.refetch();
    }
  };

  const invites = invitations.data ?? [];
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <section className="rounded-xl border border-line bg-surface p-6 shadow-sm" data-testid="welcome-join">
        <h2 className="mb-1 flex items-center gap-2 text-base font-semibold text-ink">
          <Users size={18} /> Join an existing workspace
        </h2>
        <p className="mb-4 text-sm text-ink-2">Your team already uses Backstages? Join them.</p>

        {invitations.isLoading ? (
          <p className="mb-4 text-sm text-ink-3">Looking for invitations…</p>
        ) : invites.length > 0 ? (
          <ul className="mb-4 space-y-2">
            {invites.map((inv) => (
              <li key={inv.id} className="flex items-center gap-3 rounded-lg border border-line p-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-sm font-bold text-accent">
                  {inv.workspace.name.charAt(0).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink">{inv.workspace.name}</span>
                  <span className="block truncate text-xs text-ink-3">
                    {inv.invitedBy} invited you · {inv.workspace.memberCount} member{inv.workspace.memberCount === 1 ? '' : 's'}
                  </span>
                </span>
                <button className={secondary} disabled={busy !== null} onClick={() => void accept(inv)} data-testid="welcome-accept-invite">
                  {busy === inv.id ? 'Joining…' : 'Join'}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mb-4 rounded-lg bg-hovered px-3 py-2 text-sm text-ink-2">
            No invitations for your email yet. Ask a teammate to invite you, or paste an invite link below.
          </p>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!linkToken) return;
            setBusy('link');
            void onJoinToken(linkToken).finally(() => setBusy(null));
          }}
        >
          <label className="mb-1 flex items-center gap-1.5 text-sm font-medium text-ink-2" htmlFor="welcome-link">
            <Link2 size={14} /> Have an invite link?
          </label>
          <div className="flex gap-2">
            <input
              id="welcome-link"
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
      </section>

      <section className="rounded-xl border border-line bg-surface p-6 shadow-sm" data-testid="welcome-create">
        <h2 className="mb-1 flex items-center gap-2 text-base font-semibold text-ink">
          <Building2 size={18} /> Create a new workspace
        </h2>
        <p className="mb-4 text-sm text-ink-2">Starting fresh? Make a home for your team&apos;s chats, meetings and work.</p>
        <form onSubmit={create}>
          <label className="mb-1 block text-sm font-medium text-ink-2" htmlFor="welcome-ws-name">
            Workspace name
          </label>
          <input
            id="welcome-ws-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Acme Inc."
            maxLength={80}
            className={`${input} mb-4`}
            data-testid="workspace-name"
          />
          <button type="submit" disabled={busy !== null || !name.trim()} className={primary} data-testid="workspace-create">
            <Plus size={15} /> {busy === 'create' ? 'Creating…' : 'Create workspace'}
          </button>
        </form>
      </section>
    </div>
  );
}
