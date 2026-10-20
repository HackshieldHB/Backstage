import { createHmac } from 'crypto';
import { describeGithubEvent, verifyGithubSignature } from './github-events.service';
import { findGithubLinks } from './github-api';

const pr = (over: Record<string, unknown> = {}) => ({
  number: 12,
  title: 'Add login',
  html_url: 'https://github.com/acme/app/pull/12',
  state: 'open',
  draft: false,
  merged: false,
  user: { login: 'octocat' },
  head: { ref: 'feature' },
  base: { ref: 'main' },
  ...over,
});

describe('describeGithubEvent', () => {
  it('maps pull request lifecycle events', () => {
    expect(describeGithubEvent('pull_request', { action: 'opened', pull_request: pr(), sender: { login: 'octocat' } })).toMatchObject({
      event: 'pr_opened',
      item: { kind: 'pr', number: 12, state: 'open' },
      text: 'PR #12 opened by octocat (feature → main): Add login',
    });
    // Drafts wait for "ready for review".
    expect(describeGithubEvent('pull_request', { action: 'opened', pull_request: pr({ draft: true }) })).toBeNull();
    expect(describeGithubEvent('pull_request', { action: 'ready_for_review', pull_request: pr() })?.event).toBe('pr_ready');
    expect(
      describeGithubEvent('pull_request', { action: 'closed', pull_request: pr({ merged: true, state: 'closed' }), sender: { login: 'bob' } }),
    ).toMatchObject({ event: 'pr_merged', item: { state: 'merged' }, text: 'PR #12 merged by bob: Add login' });
    expect(describeGithubEvent('pull_request', { action: 'closed', pull_request: pr({ state: 'closed' }) })?.event).toBe('pr_closed');
    expect(describeGithubEvent('pull_request', { action: 'labeled', pull_request: pr() })).toBeNull();
  });

  it('only posts decisive reviews', () => {
    const base = { action: 'submitted', pull_request: pr() };
    expect(describeGithubEvent('pull_request_review', { ...base, review: { state: 'APPROVED', user: { login: 'ann' } } })?.text).toBe(
      'ann ✅ approved PR #12: Add login',
    );
    expect(describeGithubEvent('pull_request_review', { ...base, review: { state: 'changes_requested' } })?.event).toBe('pr_review');
    expect(describeGithubEvent('pull_request_review', { ...base, review: { state: 'commented' } })).toBeNull();
  });

  it('maps issues, comments, CI failures and releases', () => {
    const issue = { number: 7, title: 'Crash', html_url: 'https://github.com/acme/app/issues/7', state: 'open', user: { login: 'eve' } };
    expect(describeGithubEvent('issues', { action: 'opened', issue })?.text).toBe('Issue #7 opened by eve: Crash');
    expect(describeGithubEvent('issues', { action: 'closed', issue: { ...issue, state: 'closed', state_reason: 'not_planned' }, sender: { login: 'ann' } })?.text).toBe(
      'Issue #7 closed as not planned by ann: Crash',
    );
    expect(
      describeGithubEvent('issue_comment', { action: 'created', issue: { ...issue, pull_request: {} }, comment: { body: 'LGTM\nmore', user: { login: 'zed' } } }),
    ).toMatchObject({ event: 'comment', item: { kind: 'pr', number: 7 }, text: 'zed commented on PR #7: LGTM' });
    expect(
      describeGithubEvent('workflow_run', {
        action: 'completed',
        workflow_run: { name: 'CI', conclusion: 'failure', head_branch: 'feature', head_commit: { message: 'fix\nbody' }, pull_requests: [{ number: 12 }] },
      }),
    ).toMatchObject({ event: 'ci_failed', item: { kind: 'pr', number: 12 }, text: '❌ CI failed on feature — fix' });
    expect(describeGithubEvent('workflow_run', { action: 'completed', workflow_run: { conclusion: 'success' } })).toBeNull();
    expect(
      describeGithubEvent('release', { action: 'published', release: { tag_name: 'v1.2.0', name: 'Spring', html_url: 'u' }, sender: { login: 'ann' } })?.text,
    ).toBe('🚀 Release v1.2.0 — Spring published by ann');
    expect(describeGithubEvent('star', { action: 'created' })).toBeNull();
  });
});

describe('verifyGithubSignature', () => {
  const body = Buffer.from('{"zen":"Keep it logically awesome."}');
  const sig = `sha256=${createHmac('sha256', 's3cret').update(body).digest('hex')}`;
  it('accepts the exact payload signed with the secret', () => {
    expect(verifyGithubSignature('s3cret', body, sig)).toBe(true);
  });
  it('rejects anything else', () => {
    expect(verifyGithubSignature('other', body, sig)).toBe(false);
    expect(verifyGithubSignature('s3cret', Buffer.from(`${body} `), sig)).toBe(false);
    expect(verifyGithubSignature('s3cret', body, undefined)).toBe(false);
    expect(verifyGithubSignature('s3cret', undefined, sig)).toBe(false);
    expect(verifyGithubSignature('s3cret', body, sig.replace('sha256=', 'sha1='))).toBe(false);
  });
});

describe('findGithubLinks', () => {
  it('finds PR and issue links, de-duplicated and capped', () => {
    const text =
      'see https://github.com/Acme/App/pull/12 and https://github.com/acme/app/pull/12#discussion and https://github.com/acme/app/issues/7 ' +
      'not https://github.com/acme/app/blob/main/x.ts nor https://github.com/acme/app/pull/123abc';
    expect(findGithubLinks(text)).toEqual([
      { repo: 'acme/app', kind: 'pr', number: 12, url: 'https://github.com/Acme/App/pull/12' },
      { repo: 'acme/app', kind: 'issue', number: 7, url: 'https://github.com/acme/app/issues/7' },
    ]);
  });
});
