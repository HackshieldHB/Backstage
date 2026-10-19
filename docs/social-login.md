# Sign in with Google / GitHub

Backstages supports three ways to create an account and sign in:

- **Email & password** — always on.
- **Continue with Google** — shown when `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` are set on the API.
- **Continue with GitHub** — shown when `GITHUB_CLIENT_ID` + `GITHUB_CLIENT_SECRET` are set.

The buttons appear on the sign-in and sign-up pages automatically once a provider is configured.
People can also connect or disconnect Google/GitHub later under **Account security → Sign-in methods**.

> Callback URLs contain your **API** address. Quick-tunnel URLs change on every run, so for social
> sign-in use a stable address (a named Cloudflare tunnel or a server — see `docs/deploy.md`).

## Google

1. [Google Cloud Console](https://console.cloud.google.com/) → create (or pick) a project.
2. **APIs & Services → OAuth consent screen**: choose *External*, fill in the app name and support
   email. Scopes: `openid`, `email`, `profile` (all non-sensitive). Publish the app when you're ready
   for anyone to sign in (while in *Testing*, only listed test users can).
3. **APIs & Services → Credentials → Create credentials → OAuth client ID** → *Web application*.
   - **Authorized redirect URI:** `https://<your-api-host>/auth/oauth/google/callback`
4. Copy the client ID and secret into the API env as `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.

## GitHub

1. GitHub → **Settings → Developer settings → OAuth Apps → New OAuth App**
   (or under an organization's settings).
2. **Homepage URL:** your web address. **Authorization callback URL:**
   `https://<your-api-host>/auth/oauth/github/callback`
3. Generate a client secret. Put both in `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`.

Backstages asks GitHub for `read:user user:email` and only uses a **verified** email address
(GitHub's private `noreply` relay addresses are ignored, since we can't email them).

## How accounts are matched

- Each Google/GitHub account is remembered by the provider's permanent user id, so changing your
  email at Google/GitHub doesn't create a second Backstages account.
- The first time, Backstages looks for an account with the same **verified** email:
  - none → a new account is created (email already verified);
  - an account whose email is verified → the provider is connected to it;
  - an account whose email was **never confirmed** → refused. Someone could have registered your
    address first; sign in with the password (or use *Forgot password*) to prove it's yours, then
    connect Google/GitHub from Account security.
- If your account has two-factor authentication on, you're still asked for the code.
- If your organization requires single sign-on for your email domain, social sign-in is refused.
- To connect an account with a **different** email (e.g. a personal GitHub), use
  **Account security → Sign-in methods → Connect** while signed in.
- You can't disconnect your only way to sign in; set a password first.

## Security notes

Authorization-code flow with PKCE (S256), single-use `state`, and a `nonce` for Google's ID token,
which is signature-checked against Google's published keys. Sign-in is bound to the browser that
started it (an HttpOnly cookie), linking is confirmed by the signed-in session, and no tokens are put
in URLs — the callback hands the web app a one-time code that expires after two minutes.
"Log in with Atlassian" now follows the same rules.
