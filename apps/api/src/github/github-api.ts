/** Minimal GitHub REST client (fixed host, short timeouts). */

const API = 'https://api.github.com';
const TIMEOUT_MS = 8000;

export class GithubApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function headers(token?: string): Record<string, string> {
  return {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'Backstages/1.0',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function call<T>(method: 'GET' | 'POST', path: string, token?: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { ...headers(token), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    let message = `GitHub ${method} ${path}: HTTP ${res.status}`;
    try {
      const j = (await res.json()) as { message?: string };
      if (j.message) message = j.message;
    } catch {
      /* keep the status text */
    }
    throw new GithubApiError(res.status, message);
  }
  return (await res.json()) as T;
}

export interface GithubItemSummary {
  kind: 'pr' | 'issue';
  number: number;
  title: string;
  url: string;
  /** open | closed | merged | draft */
  state: string;
}

/** A PR or issue's title + state (PRs need the pulls endpoint for merged/draft). */
export async function fetchItem(
  repo: string,
  kind: 'pr' | 'issue',
  number: number,
  token?: string,
): Promise<GithubItemSummary> {
  if (kind === 'pr') {
    const pr = await call<{ title: string; html_url: string; state: string; merged?: boolean; draft?: boolean }>(
      'GET',
      `/repos/${repo}/pulls/${number}`,
      token,
    );
    return {
      kind,
      number,
      title: pr.title,
      url: pr.html_url,
      state: pr.merged ? 'merged' : pr.draft && pr.state === 'open' ? 'draft' : pr.state,
    };
  }
  const issue = await call<{ title: string; html_url: string; state: string; pull_request?: unknown }>(
    'GET',
    `/repos/${repo}/issues/${number}`,
    token,
  );
  return { kind: issue.pull_request ? 'pr' : 'issue', number, title: issue.title, url: issue.html_url, state: issue.state };
}

export async function createIssue(
  token: string,
  repo: string,
  input: { title: string; body?: string },
): Promise<{ number: number; html_url: string }> {
  return call('POST', `/repos/${repo}/issues`, token, { title: input.title, body: input.body ?? '' });
}

/** github.com PR / issue links in a message: owner/repo + number. */
export function findGithubLinks(text: string, max = 3): { repo: string; kind: 'pr' | 'issue'; number: number; url: string }[] {
  const out: { repo: string; kind: 'pr' | 'issue'; number: number; url: string }[] = [];
  const re = /https?:\/\/github\.com\/([A-Za-z0-9][A-Za-z0-9-]{0,38})\/([A-Za-z0-9._-]{1,100})\/(pull|issues)\/(\d{1,9})(?![\w-])/g;
  const seen = new Set<string>();
  for (const m of text.matchAll(re)) {
    const repo = `${m[1]}/${m[2]}`.toLowerCase();
    const kind = m[3] === 'pull' ? 'pr' : 'issue';
    const number = Number(m[4]);
    const key = `${repo}#${number}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ repo, kind, number, url: m[0] });
    if (out.length >= max) break;
  }
  return out;
}
