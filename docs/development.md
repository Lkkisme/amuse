# Development

Monorepo layout (mise monorepo; `mise run check`, `mise run generate`):

```
protocol/  the contract: zod schemas → TS types, JSON Schema, OpenRPC, Kotlin (JSON-RPC 2.0 over WebSocket)
core/      the pure rules (decide) and the host that runs them; no IO
api/       the server: JSON-RPC, the live browser relay, the journal
pi/        the chat and browser agents (Pi)
browser/   the auto-browser pool, and desktop sizing
sandbox/   Amuse's own machine: its image (Dockerfile), control daemon and the client the agents use
composio/  app connections
demo/      scripted ports and seed, for the demo and tests
web/       web app (Vite + React)
docs/      UI spec, measured design tokens, reference notes
```

## Ground rules

- Reference screenshots live in `~/.local/share/openmuse-pi/muse-ref/` and contain the
  owner's personal data. Never copy or commit them; use them only as visual reference.
- No Meta assets (icons, images, fonts, sounds) may be copied from the APK into this repo.
  Recreate shapes and values in code.
- Every screen must render and be navigable in the demo (no server, scripted ports).

## Develop

```
mise run dev     # API (restarts on change) + Vite with HMR, from ~/.config/remuse/dev.env
mise run check   # type-check and test every package
mise run //api:try   # a throwaway API for live tests (own port, temp journal)
```
