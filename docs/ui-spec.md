# remuse UI spec

Everything below is replicated from reference screenshots in
`~/.local/share/openmuse-pi/muse-ref/` (visual reference only — never commit them).

## Screens (in build order)

| # | Screen | Reference | Notes |
|---|--------|-----------|-------|
| 1 | Main chat | `00-home`, `12-mobile`, `14-mobile-chat` | Single feed: messages, assistant narration, inline cards. Composer pill at bottom; send arrow becomes stop square while "responding". |
| 2 | Task run cards | `01-task-start`, `02-run-1..6` | Task card in feed: icon, title, status line (Working / Waiting for you / Completed / Failed), open-detail affordance. |
| 3 | Form/input request | `03-form-1..8` | Task asks for input; inline form fields inside the feed. |
| 4 | Desktop viewer | `04-desktop`, `06-card-desktop`, `07-viewer` | Embedded live desktop/browser viewer card + full-screen viewer with header. |
| 5 | Takeover | `05-takeover-1..9`, `10-control`, `13-mobile-control` | Take control / You're in control / Hand back states; Stop and Done buttons. |
| 6 | Waiting / done states | `08-now`, `09-waiting`, `11-done` | Status pill at top of chat; terminal card states. |
| 7 | Settings | `20-settings`, `21-settings-page` | Settings modal/page: General, Connectors, Permissions, Secure store. |
| 8 | Secure store | `22-secure-store`, `23-add-credential` | Credential list by domain + add form. |
| 9 | Permissions | `24-permissions`, `25-websites`, `26-website-detail`, `27-site-dropdown` | Global defaults + per-site Allow/Ask/Deny rows. |
| 10 | Connectors | `28-connectors`, `29-gmail-connector`, `30-gmail-perms`, `40-connectors`, `41-connectors-scrolled`, `42-after-connect` | Connector list, per-connector capability rows (Read / Write and delete, Allow/Ask/Deny). |
| 11 | Connection request | `50-connreq-1..5`, `51-connreq-1..6`, `52-connreq-desktop`, `53-connreq-click`, `54-closed` | Agent-initiated connector connect card in chat: icon, name, "Connector" subtitle, full-width Connect button, pre-connect explainer modal. |

Drawer (mobile): Muse-style drawer, no bottom nav bar: Main chat, Tasks (plain list),
Settings. Everything else happens inside the chat feed as cards.

## Fake state design

- One `FakeMuseRepository` (in-memory, `StateFlow`-driven) is the single source of truth.
- Seeded demo content: a running task (plan with progress), a task waiting for input (form),
  a completed browser task card, an approval card (Ask), a connection request card,
  and a finished conversation history.
- Interactions that mutate state must work locally: sending a message appends an echo
  reply; approving resolves the card; connect opens the explainer modal; take over toggles
  viewer header state; Stop/Done transitions statuses. A "reset demo" action restores seeds.
- The composer's running/stop switch and status pill are driven by a fake "assistant
  thinking" timer so the demo animates.

## Non-goals

No networking, no auth, no real connectors, no VM/browser backends, no push. Every "live"
element is a scripted fake.

## Design rules

- Concentric corners: a control near a rounded corner shares its center. Container radius =
  the control's inset + the control's radius. Sheets and modals: close button 12px in, 32px
  round (radius 16) → 28px corners, on mobile drawers and desktop modals alike.
  The composer follows it too: its plus, mic and send buttons are 36px at an 8px inset in the
  52px pill, so each sits on the center of a rounded end.
- Shadows are soft: wide blur, low opacity, only from the `--shadow-*` tokens (float, raised,
  sheet, drawer). A shadow falls on the chat, never on its own companion: the avatar's shadow
  lies under its name badge.
- A run whose browser is gone (stopped, or released 30 minutes after it ended) is only a
  record: its card shows no page and no button, and it leaves the viewer's tabs. The top-right
  browser button is always there and opens the viewer; with no browser, the viewer says so.
- The right side holds one panel at a time. Tapping Muse's avatar docks the Muse panel there (the
  avatar travels into it: a view transition); the browser button gives the side to the browser
  (the avatar goes back), and becomes the browser's collapse button in its top-right corner (it
  travels there too). With the browser open, Muse's panel floats over the chat instead. On a
  desktop the browser's left edge drags to resize it (the chat keeps at least 360px).
- Buttons show the pointer cursor.
