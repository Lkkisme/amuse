# Changelog

What changed in each release of Amuse, for the people who run it. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/) (before 1.0, a minor version may change how things work).

## [Unreleased]

### Added
- The browser can run on the chat's model ("Same as chat", now the default), as background work already could; Settings says so when the chat's model cannot see pictures.
- An Android client shares the web UI and conversations, supports file transfers and microphone access, and allows screenshots; device unlock is optional.
- Amuse can use an existing Paseo / Codex Qwen environment, showing its saved conversations and running tasks while keeping its model, context size and tools.
- A native Windows browser can be watched and taken over from the phone or web UI, with browser permissions and saved logins; sandbox terminals and shared tools also work on Windows.

### Changed
- Settings › Models gives each role (chat, browser, background) a group of its own, with a row for its provider, its model and its thinking, each named; the provider is chosen first, so the same model from two providers is no longer listed twice. The thinking row is always there, and says when a model has to be chosen first or does not think.
- Sheets close with the same round button as the rest of the app, and a task's details open in a wider sheet.
- The terminal's lines are a little taller, so Chinese characters are no longer cut off at the top.
- The connected-backend status, PIN controls and native browser viewer follow the selected English or Simplified Chinese language.

### Fixed
- On a wider screen, the Amuse avatar flies into its panel and back again when the panel opens and closes.
- Starting Amuse on Windows keeps it running after the launching terminal closes, and can start Docker Desktop when the sandbox is cold, including an explicit owner-configured backend launch.
- An owner-requested restart restores the browser pages that were open, without reopening pages the owner closed or replacing the saved conversations.

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
