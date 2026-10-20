# Google Calendar (two-way)

**Profile → Google Calendar → Connect.** Google asks for permission to *see and edit events*
(`calendar.events`, with offline access so syncing continues while you're away). Uses the same Google OAuth
client as "Continue with Google" — in Google Cloud Console also enable the **Google Calendar API** for the
project, and add the `.../auth/calendar.events` scope to the consent screen. Callback:
`<PUBLIC_API_URL>/auth/oauth/google/callback` (already registered for sign-in).

## Backstages → Google

Every Backstages meeting you're invited to and haven't declined is copied into **your own** Google
Calendar: title, agenda, a "Join in Backstages" link, and a pop-up reminder at the meeting's own reminder
time. Copies are personal — nobody is added as a Google attendee, so Google never emails anyone.
Renames, time changes, declines and cancellations follow automatically; a copy you delete in Google is put
back on the next sync (Backstages is the source of truth). Meetings are copied up to 60 days ahead;
recurring meetings appear one occurrence at a time, as they're scheduled in Backstages. Untick
"Add my Backstages meetings to this calendar" to remove the copies; Disconnect removes them too.

The sync runs on every meeting change and every 15 minutes, so anything missed heals itself.

## Google → Backstages

Your Google events (recurring ones included):

- show greyed in your Backstages calendar (toggle "My Google Calendar events"),
- count as busy time for teammates you share your calendar with (titles only with "Full details"; events
  marked *Free* don't count), and in "My day",
- set your status to "In a meeting" while one is happening.

Events Backstages created are recognised and skipped, so nothing shows twice. If you also linked an ICS
feed, Google Calendar is used instead while connected.

If Google stops accepting our access (you removed it in your Google account), the card says so — reconnect
to resume.
