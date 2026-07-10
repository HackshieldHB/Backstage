# Atlassian integration setup

Connecting a Backstages workspace to an Atlassian (Jira/Confluence) site makes **every member
of that site chattable in Backstages**: existing accounts are linked by verified email, everyone
else appears immediately as a *provisional member* who activates on their first
"Log in with Atlassian" or email-invite signup.

## 1. Create the OAuth 2.0 (3LO) app

1. Go to <https://developer.atlassian.com/console/myapps/> → **Create** → **OAuth 2.0 integration**.
2. Under **Permissions**, add the **Jira API** and grant at least these scopes:
   - `read:jira-user` — member directory sync (user search API)
   - `read:jira-work` — issue status cards, link unfurling, `/jira` command
   - `write:jira-work` — "Create Jira issue from message"
   - `offline_access` — refresh tokens (tokens are rotated server-side)
3. For "Log in with Atlassian" SSO, also enable the **User identity API** (`read:me`).
4. Under **Authorization**, set the callback URL to:

   ```
   https://<your-api-host>/atlassian/callback      (dev: http://localhost:3001/atlassian/callback)
   ```

5. Copy the client id and secret into `apps/api/.env`:

   ```env
   ATLASSIAN_CLIENT_ID=...
   ATLASSIAN_CLIENT_SECRET=...
   ATLASSIAN_REDIRECT_URI=http://localhost:3001/atlassian/callback
   TOKEN_ENCRYPTION_KEY=<64 hex chars>   # encrypts all Atlassian tokens at rest (AES-256-GCM)
   ```

## 2. Connect a workspace

A workspace **OWNER or ADMIN** opens the workspace's Atlassian settings in the app and clicks
**Connect Atlassian** (`GET /workspaces/:id/atlassian/connect-url` → Atlassian consent →
`/atlassian/callback`). The first site returned by `accessible-resources` is connected, the
tokens are stored encrypted, and an initial **member directory sync** runs immediately.

- **Sync now**: `POST /workspaces/:id/atlassian/sync` (ADMIN+), also exposed as a button.
- **Nightly resync**: a BullMQ job (`0 3 * * *`) resyncs every connected workspace; users who
  left or were deactivated on the Atlassian site get their membership flagged
  (`deactivatedAt`), returners are reactivated.

## 3. Register the Jira webhook

Backstages receives Jira events on:

```
POST https://<your-api-host>/webhooks/jira/<connectionId>
Header: x-backstages-secret: <webhookSecret>
```

`connectionId` and `webhookSecret` come from the `AtlassianConnection` row (shown in the
workspace's Atlassian settings). In Jira: **Settings → System → WebHooks → Create**, URL as
above, and select the events:

- Issue: **created**, **updated** (assignee and status changes are detected via the changelog)
- Comment: **created**

Requests without the exact secret are rejected (constant-time comparison).

## 4. What the events do

| Event | Behavior |
| --- | --- |
| Issue assigned | The linked assignee gets a personal **"Jira" DM** + notification |
| Issue created / status changed / comment created | A **card** is posted to every channel subscribed to that project (per-channel event filters via `POST /channels/:id/jira/subscriptions`); follow-up events for the same issue **thread under the first card** |
| Dedup | A user who was DM'd for an event never gets an unread badge from the same event's channel card |

## 5. Extras

- **Link unfurling**: pasted `https://<site>/browse/KEY-123` URLs render live status cards
  (summary, status, type, priority). Confluence `/wiki/` links render as simple link cards.
- **`/jira KEY-123`** in the composer posts an issue status card to the channel.
- **Create Jira issue from message**: hover a message → Jira action, or
  `POST /messages/:id/create-jira-issue { projectKey }` — the confirmation threads under the
  source message.
