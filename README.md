# remuse

A Kotlin recreation of the Meta Muse Android app UI (com.facebook.aura), for study and demo.
Pure UI: no backend, no real accounts. All screens run on in-memory fake state so the whole
product can be demoed offline.

Monorepo layout (mise monorepo; `mise run check`, `mise run generate`):

```
protocol/  the contract: zod schemas → TS types, JSON Schema, OpenRPC (JSON-RPC 2.0 over WebSocket)
web/       web app (Vite + React)
android/   Android app (Kotlin + Jetpack Compose), paused
docs/      UI spec, measured design tokens, reference notes
```

## Ground rules

- Reference screenshots live in `~/.local/share/openmuse-pi/muse-ref/` and contain the
  owner's personal data. Never copy or commit them; use them only as visual reference.
- No Meta assets (icons, images, fonts, sounds) may be copied from the APK into this repo.
  Recreate shapes and values in code.
- Fake state is the only state. Every screen must render and be navigable without network.
