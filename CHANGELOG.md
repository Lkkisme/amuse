# Changelog

What changed in each release of Amuse, for the people who run it. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/) (before 1.0, a minor version may change how things work).

## [Unreleased]

### Upgrade notes
- **Your data moves into one database on first start.** The conversation history, chats, permissions, password, defaults and the index of sent files are imported from the old files into `amuse.db` in the data folder, which is checked against the old files before they are renamed to `<name>.bak` (`events.jsonl.bak`, `chats.json.bak`, …) and kept, never deleted. Nothing to do; delete the `.bak` files once you are happy. The keys, the model choice and the sandbox's secrets stay as the files they were.
- **Never run an older version of Amuse on this data.** It does not know the database: it would start with no history and no password, and the next visitor could set one. Amuse refuses to start if the old files turn up beside the database again (an interrupted update, or an older version that was run), and its address says what to do; `amuse-admin retire-old-files` finishes an interrupted rename, once the files are exactly what was imported.
- If the move cannot finish, Amuse does not start, and its address shows a page that says which step failed and what to do (the server's log has the details); your data is as it was.
- To go back to the version before this one anyway, after stopping Amuse: delete `amuse.db`, `amuse.db-wal` and `amuse.db-shm`, rename every `*.bak` back to its name (`events.jsonl.bak` → `events.jsonl`, `chats/<id>.jsonl.bak` → `chats/<id>.jsonl`, …), and start the older version. What was said since the update is lost; export it first with `amuse-admin export`.
- **Forgot the password** is now `docker compose exec amuse amuse-admin reset-password` (deleting `access.json` no longer does anything). Run `amuse-admin` as the container's default user.
- Before an update that changes the database, Amuse copies it to `backups/` in the data folder, and keeps the last five such copies.

### Added
- What the server keeps (the history, chats, permissions, password and the rest) is in one database file: a crash can no longer leave several files half written, Amuse's memory use grows with what your chats hold, not with every event ever recorded (the history is read as it is replayed, not held as a file), and the file can be copied while Amuse runs.
- `amuse-admin`, a command on the server: list what an update will change before it runs (`migrate --dry-run`), export a chat's history as JSONL (`export`), and reset the password. A chat deleted while Amuse is still working in it no longer stops the server.
- Amuse can write to you in the middle of long work: it answers a message you send while it is busy, and says what it is starting before something that takes a while, instead of going quiet until it is done.
- The browser can run on the chat's model ("Same as chat", now the default), as background work already could; Settings says so when the chat's model cannot see pictures.
- On a phone, swipe to open and close the sidebar and the Amuse panel: right on the chat opens the sidebar (more readily from the left edge), left opens the Amuse panel, and the opposite swipe closes whichever is open. The page follows your finger and settles open or closed by how far it came and how fast you let go, on the same curve as the ☰ button (it snaps with reduced motion). Vertical scrolling is never taken over, and the gesture stays out of the browser viewer and terminal, sheets, text fields, selected text, code blocks that can still scroll sideways, and the screen edges your phone uses for Back. (#43)

### Changed
- Long chats cost less and answer sooner: each turn is laid out so the model's provider can reuse what it already read of the chat, and the conversation Amuse is shown changes at its end instead of from its start (older parts move to a shorter form a few thousand characters at a time, not with every message). (#37)
- Settings › Models gives each role (chat, browser, background) a group of its own, with a row for its provider, its model and its thinking, each named; the provider is chosen first, so the same model from two providers is no longer listed twice. The thinking row is always there, and says when a model has to be chosen first or does not think.
- Sheets close with the same round button as the rest of the app, and a task's details open in a wider sheet.
- The terminal's lines are a little taller, so Chinese characters are no longer cut off at the top.

### Fixed
- The status under Amuse's avatar glides to its new size and changes its line with a crossfade, instead of snapping and flickering; the brief "responding" line between two tools no longer flashes in.
- The chat keeps its least width when the window is made narrower after the browser panel was dragged wide; widened again, the panel comes back to the width it was dragged to.
- Amuse can cancel a schedule you no longer want: it looks the schedules up with their full ids instead of going by what it remembered of them.
- On a wider screen, the Amuse avatar flies into its panel and back again when the panel opens and closes.

## [0.1.0] - 2026-10-21

The first release.

### Added
- Chat with Amuse in a main chat and side chats, on a desktop or a phone (an installable web app), in English or Simplified Chinese.
- A pool of real Chrome browsers Amuse operates for you, which you watch live and take over; logins you make there are kept per site.
- Connections to Gmail, Calendar, Slack, GitHub and many more through Composio, with your own key; several accounts per service.
- Permissions per connection and kind of action, and for the browser by kind of action with exceptions per site.
- A sandbox: a Debian machine of Amuse's own, reaching the public internet only, with terminals (herdr) shared with you and credentials that never pass through the chat.
- Memory, goals, schedules and skills; voice input through OpenAI, Groq, Fireworks or your own speech server.

[Unreleased]: https://github.com/Microwave-WYB/amuse/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Microwave-WYB/amuse/releases/tag/v0.1.0
