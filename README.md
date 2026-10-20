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

## Develop

```
mise run dev     # API (restarts on change) + Vite with HMR, from ~/.config/remuse/dev.env
mise run check   # type-check and test every package
mise run //api:try   # a throwaway API for live tests (own port, temp journal)
```

## Deploy (Docker)

The `remuse` container serves the web app, `/rpc` and `/live`; browsers run in an
auto-browser pool (`compose.browsers.yaml`: pairs of a headful Chromium desktop and its
controller, one browser run per pair). The secrets between them — the controllers' token and the
key encrypting saved logins — are generated on first start and kept in the `secrets` volume.

```
cp deploy/remuse.env.example deploy/remuse.env   # set REMUSE_TOKEN and the model
PI_AUTH=~/path/to/pi/auth.json COMPOSIO_KEY=~/path/to/composio.key \
  docker compose --env-file deploy/remuse.env up -d --build
```

The auto-browser images (`auto-browser-browser-node`, `auto-browser-controller`) come from the
auto-browser repo (`docker compose build` there) or its ghcr images (`AB_NODE_IMAGE`,
`AB_CONTROLLER_IMAGE`).

It listens on 127.0.0.1:8080 (`REMUSE_PUBLISH_PORT` to change); put `tailscale serve` or a
reverse proxy in front. Open `https://<host>/#token=<REMUSE_TOKEN>` once per device; the
token is kept on the device and removed from the address bar. The conversation lives in
the `remuse-data` volume.
