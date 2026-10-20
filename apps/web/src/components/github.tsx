'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import {
  GITHUB_EVENTS,
  GITHUB_EVENT_LABELS,
  type ChannelDto,
  type CreatedGithubSubscriptionDto,
  type GithubConnectionDto,
  type GithubEvent,
  type GithubIssueCreatedDto,
  type GithubSubscriptionDto,
} from '@backstages/shared';
import { api } from '@/lib/api';
import { useUiStore } from '@/stores/ui-store';
import { Dialog } from './dialog';
import { GithubIcon } from './auth/social-buttons';
import { OneTimeSecret } from './account-security';

const input =
  'w-full rounded-md border border-line-strong bg-elevated px-2.5 py-1.5 text-sm text-ink outline-none focus:border-accent';
const primary =
  'rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50';
const secondary =
  'rounded-md border border-line-strong px-3 py-1.5 text-sm font-medium text-ink hover:bg-hovered disabled:opacity-50';

const DEFAULT_EVENTS: GithubEvent[] = ['pr_opened', 'pr_ready', 'pr_merged', 'pr_review', 'issue_opened', 'ci_failed', 'release'];

export function useGithubConnection() {
  return useQuery({
    queryKey: ['github-connection'],
    queryFn: () => api<GithubConnectionDto>('GET', '/me/github'),
    staleTime: 60_000,
  });
}

export function useGithubSubscriptions(workspaceId: string) {
  return useQuery({
    queryKey: ['github-subscriptions', workspaceId],
    queryFn: () => api<GithubSubscriptionDto[]>('GET', `/workspaces/${workspaceId}/github/subscriptions`),
    enabled: !!workspaceId,
  });
}

async function startConnect(pushToast: (m: string, k?: 'error') => void) {
  try {
    const { url } = await api<{ url: string }>('POST', '/me/github/connect');
    window.location.href = url; // back to /app?github-connect=…
  } catch (e) {
    pushToast(e instanceof Error ? e.message : 'Could not start connecting GitHub', 'error');
  }
}

/** "Create GitHub issue" from a message, as the signed-in person. */
export function CreateGithubIssueDialog({
  workspaceId,
  messageId,
  defaultTitle,
  defaultBody,
  onClose,
}: {
  workspaceId: string;
  messageId?: string;
  defaultTitle: string;
  defaultBody?: string;
  onClose: () => void;
}) {
  const pushToast = useUiStore((s) => s.pushToast);
  const connection = useGithubConnection();
  const subs = useGithubSubscriptions(workspaceId);
  const repos = [...new Set((subs.data ?? []).map((s) => s.repo))];
  const [repo, setRepo] = useState('');
  const [title, setTitle] = useState(defaultTitle.split('\n')[0].slice(0, 256));
  const [body, setBody] = useState(defaultBody ?? '');
  const [busy, setBusy] = useState(false);
  const chosenRepo = repo || repos[0] || '';

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await api<GithubIssueCreatedDto>('POST', '/github/issues', {
        repo: chosenRepo.trim(),
        title: title.trim(),
        body: body.trim() || undefined,
        messageId,
      });
      pushToast(`Created ${res.repo}#${res.number}`, 'success');
      onClose();
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Could not create the issue', 'error');
      void connection.refetch();
      setBusy(false);
    }
  };

  return (
    <Dialog title="Create GitHub issue" onClose={onClose}>
      {connection.isLoading ? (
        <p className="text-sm text-ink-3">Loading…</p>
      ) : !connection.data?.connected ? (
        <div className="flex flex-col gap-3 text-sm" data-testid="github-connect-prompt">
          <p className="text-ink-2">
            Connect your GitHub account so the issue is opened by you. Backstages asks for repository access to create
            issues; you can disconnect anytime.
          </p>
          <button className={`${primary} flex items-center justify-center gap-2`} onClick={() => void startConnect(pushToast)}>
            <GithubIcon /> Connect GitHub
          </button>
        </div>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-3" data-testid="github-issue-form">
          <p className="text-xs text-ink-3">Creating as @{connection.data.login}</p>
          <label className="flex flex-col gap-1 text-[13px] text-ink-2">
            Repository
            <input
              className={input}
              list="github-repos"
              placeholder="owner/repo"
              value={repo || repos[0] || ''}
              onChange={(e) => setRepo(e.target.value)}
              required
              data-testid="github-issue-repo"
            />
            <datalist id="github-repos">
              {repos.map((r) => (
                <option key={r} value={r} />
              ))}
            </datalist>
          </label>
          <label className="flex flex-col gap-1 text-[13px] text-ink-2">
            Title
            <input className={input} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={256} required />
          </label>
          <label className="flex flex-col gap-1 text-[13px] text-ink-2">
            Description <span className="text-[11.5px] text-ink-3">(a link back to this conversation is added)</span>
            <textarea className={`${input} resize-y`} rows={4} value={body} onChange={(e) => setBody(e.target.value)} maxLength={20000} />
          </label>
          <div className="flex justify-end gap-2">
            <button type="button" className={secondary} onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className={primary} disabled={busy || !title.trim() || !chosenRepo.trim()} data-testid="github-issue-submit">
              {busy ? 'Creating…' : 'Create issue'}
            </button>
          </div>
        </form>
      )}
    </Dialog>
  );
}

/** Integrations → GitHub: channel subscriptions + your own GitHub account. */
export function GithubSettings({ workspaceId, channels }: { workspaceId: string; channels: ChannelDto[] }) {
  const qc = useQueryClient();
  const pushToast = useUiStore((s) => s.pushToast);
  const subs = useGithubSubscriptions(workspaceId);
  const connection = useGithubConnection();
  const [channelId, setChannelId] = useState('');
  const [repo, setRepo] = useState('');
  const [events, setEvents] = useState<GithubEvent[]>(DEFAULT_EVENTS);
  const [created, setCreated] = useState<CreatedGithubSubscriptionDto | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ['github-subscriptions', workspaceId] });

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await api<CreatedGithubSubscriptionDto>('POST', '/github/subscriptions', { channelId, repo: repo.trim(), events });
      setCreated(res);
      setRepo('');
      await refresh();
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Could not add the repository', 'error');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (s: GithubSubscriptionDto) => {
    if (!window.confirm(`Stop posting ${s.repo} to #${s.channelName}?`)) return;
    try {
      await api('DELETE', `/github/subscriptions/${s.id}`);
      await refresh();
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Could not remove', 'error');
    }
  };

  const toggle = (ev: GithubEvent) => setEvents((cur) => (cur.includes(ev) ? cur.filter((x) => x !== ev) : [...cur, ev]));

  return (
    <div className="space-y-5 text-sm" data-testid="github-settings">
      <section>
        <h3 className="mb-1 font-semibold text-ink">Your GitHub account</h3>
        {connection.data && !connection.data.available ? (
          <p className="text-xs text-ink-3">An admin needs to set GITHUB_CLIENT_ID/SECRET on the server first.</p>
        ) : connection.data?.connected ? (
          <div className="flex items-center gap-2">
            <GithubIcon />
            <span className="flex-1">Connected as @{connection.data.login} — you can create issues from messages.</span>
            <button
              className={secondary}
              onClick={async () => {
                await api('DELETE', '/me/github');
                await connection.refetch();
              }}
            >
              Disconnect
            </button>
          </div>
        ) : (
          <button className={`${secondary} flex items-center gap-2`} onClick={() => void startConnect(pushToast)} data-testid="github-connect">
            <GithubIcon /> Connect GitHub to create issues
          </button>
        )}
      </section>

      <section>
        <h3 className="mb-1 font-semibold text-ink">Repositories posting to channels</h3>
        <p className="mb-2 text-xs text-ink-3">
          Pull requests, reviews, issues, CI failures and releases show up as cards; follow-ups thread under each PR or issue.
        </p>
        <ul className="mb-3 space-y-1.5">
          {(subs.data ?? []).map((s) => (
            <li key={s.id} className="flex items-center gap-2 rounded-md border border-line p-2">
              <GithubIcon />
              <span className="min-w-0 flex-1 truncate">
                <span className="font-medium">{s.repo}</span>
                <span className="text-ink-3"> → #{s.channelName} · {s.events.length} event types</span>
              </span>
              <button onClick={() => void remove(s)} className="rounded p-1 text-ink-3 hover:text-red-500" aria-label={`Remove ${s.repo}`}>
                <Trash2 size={14} />
              </button>
            </li>
          ))}
          {subs.isSuccess && subs.data.length === 0 && <li className="text-xs text-ink-3">No repositories yet.</li>}
        </ul>

        {created ? (
          <div className="rounded-lg border border-accent/40 bg-accent/5 p-3" data-testid="github-webhook-setup">
            <p className="mb-2 font-medium text-ink">
              Now add a webhook in GitHub: <span className="font-mono">{created.repo}</span> → Settings → Webhooks → Add webhook
            </p>
            <ol className="mb-2 list-decimal space-y-1 pl-5 text-xs text-ink-2">
              <li>
                Payload URL: <code className="break-all">{created.webhookUrl}</code>
              </li>
              <li>Content type: application/json</li>
              <li>Secret: the value below (shown only once)</li>
              <li>
                Events: “Let me select individual events” → Pull requests, Pull request reviews, Pull request review comments, Issues,
                Issue comments, Workflow runs, Releases
              </li>
            </ol>
            <OneTimeSecret label="Webhook secret" value={created.webhookSecret} onDone={() => setCreated(null)} />
          </div>
        ) : (
          <form onSubmit={add} className="space-y-2 rounded-lg border border-line p-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <select className={input} value={channelId} onChange={(e) => setChannelId(e.target.value)} required aria-label="Channel">
                <option value="">Post to channel…</option>
                {channels
                  .filter((c) => !c.isArchived)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      #{c.name}
                    </option>
                  ))}
              </select>
              <input className={input} placeholder="owner/repo" value={repo} onChange={(e) => setRepo(e.target.value)} required aria-label="Repository" />
            </div>
            <fieldset className="grid gap-1 sm:grid-cols-2">
              <legend className="mb-1 text-xs text-ink-3">Post about</legend>
              {GITHUB_EVENTS.map((ev) => (
                <label key={ev} className="flex items-center gap-2 text-xs text-ink-2">
                  <input type="checkbox" checked={events.includes(ev)} onChange={() => toggle(ev)} />
                  {GITHUB_EVENT_LABELS[ev]}
                </label>
              ))}
            </fieldset>
            <button type="submit" className={primary} disabled={busy || !channelId || !repo.trim() || events.length === 0}>
              {busy ? 'Adding…' : 'Add repository'}
            </button>
          </form>
        )}
      </section>
    </div>
  );
}
