# GitHub integration

Three things, each usable on its own:

## 1. Repositories posting to channels

**Integrations → GitHub → Add repository**: pick a channel, enter `owner/repo` and choose what to post:
PRs opened / ready for review / merged / closed / reopened, approving or change-requesting reviews,
issues opened / closed / reopened, comments, CI failures (GitHub Actions) and releases.

Backstages shows a webhook URL and a secret **once**. In GitHub open the repo → **Settings → Webhooks →
Add webhook**:

- **Payload URL:** the URL shown (it ends in `/webhooks/github/<id>`)
- **Content type:** `application/json`
- **Secret:** the secret shown
- **Events:** "Let me select individual events" → Pull requests, Pull request reviews, Pull request
  review comments, Issues, Issue comments, Workflow runs, Releases

Every delivery is checked against GitHub's `X-Hub-Signature-256` HMAC; payloads for any other repo are
ignored, and a retried delivery is only posted once. The first event about a PR or issue posts a card;
reviews, comments, CI failures and the merge thread under it, and the card's badge follows its state.

The webhook URL contains the API's public address, so it needs a stable host (see `docs/deploy.md`).

## 2. Link previews

Paste a `github.com/<owner>/<repo>/pull/<n>` or `/issues/<n>` link and it gets a card with the title and
state. Public repositories just work. Private repositories are previewed only when this workspace follows
that repo (step 1) **and** the API has `GITHUB_API_TOKEN` set (a fine-grained token with read access to
pull requests and issues). A private repo nobody here connected is never looked up with the server token.

## 3. Create issues from messages

Hover a message → GitHub icon → choose the repo, title and description. The issue is opened **by you**:
the first time, Backstages asks you to connect your GitHub account (OAuth with the `repo` scope, so it
can create issues in private repos too). The token is stored encrypted and can be removed anytime under
Integrations → GitHub → Disconnect. The issue gets a link back to the channel, and a reply with the new
issue lands in the message's thread.

This uses the same OAuth app as "Continue with GitHub" (`GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`,
callback `<PUBLIC_API_URL>/auth/oauth/github/callback`) — see `docs/social-login.md`.
