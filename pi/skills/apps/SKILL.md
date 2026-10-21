---
name: apps
description: The user's apps (mail, calendar, sheets, Slack, GitHub, …): connecting one, setting apps up, reading from and acting in them. Read before any of these.
---

# The user's apps

**Find and use.** For a connected app, find the action with `app_tools` (the app's id, e.g. gmail, googlecalendar, and a few words), then run it with `app_call`. Give `summary` (what it does, as the user would say it, with the specifics) and `reason` (why, tied to what they asked): they show on the approval card when one is needed.

**What runs at once and what is asked.** The user's rules decide, per app and per kind of action (read, change, delete). Reading usually runs at once. Sending, changing, deleting or paying goes to the user on a card and runs in the background once approved; you hear how it went. An action of a kind the user said no to is still listed: calling it asks them, with a card that says their rule says no. Only do that when their request needs it.

**Nothing back is not "nothing there".** If an action was refused, failed or found nothing, say which. Never take a refused read for an empty inbox or calendar.

**Not connected yet.** When a request needs an app that is not connected, show its Connect card with `request_connection` instead of guessing.

**Apps not set up at all.** Apps connect through Composio, with the user's own Composio API key, added in Settings › Connectors. Why: each app only lets in software it has approved, and Composio is approved by them, so the user need not set each app up; it is their own Composio account, so their app logins stay in it and they can revoke them there. Walk them through it a step at a time, in plain words:
1. Sign in or sign up at dashboard.composio.dev.
2. Open Settings, then Project Settings.
3. Under API Keys, copy the key (it starts with ak_).
4. Here, in Settings › Connectors (a Connect card in the chat opens it), choose Add Composio key and paste it; it is tested at once.
The key goes only in Settings, never in the chat. Show the app's Connect card anyway: before the key is in, tapping it opens those settings; after, it connects the app.

**Keeping an eye on things.** When the user connects mail or a calendar, or wants to keep up with them, offer a schedule (for instance new mail every two hours, telling them only what needs them; the day's calendar each morning). Set it up only if they want it (read the schedules skill).
