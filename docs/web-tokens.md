# Muse web design tokens (measured)

Source: production CSS `/_next/static/chunks/3ffyf_e7ohm04.css` (deploy dpl_911L3xJU94X9gGG2wCqnwkEnyD2D)
fetched 2026-10-20, plus `<html>` inline vars from the live muse.ai page. These are exact
values from Meta's CSS, not eyeballed from screenshots. Web-first per owner decision;
mobile calibration comes later.

## Chat tokens (from `<html>` inline style, light/blue accent)

| token | value |
|---|---|
| `--chat-user-text` | `#111112` |
| `--chat-user-bubble` | `#B8DBFE` |
| `--chat-agent-text` | `#111112` |
| `--chat-agent-bubble` | `#FFFFFF` |
| `--chat-background` | `#EBF4FF` (served live; CSS default = `--bg-secondary`) |
| accent | `data-accent-color="blue"` → light `#0064d4`, dark `#1793ff` |

Note: the user bubble color varies by accent theme (seen `#cbe5ff`, `#B8DBFE`; dark `#0074e8`).

## Semantic scale (light / dark)

| token | light | dark |
|---|---|---|
| bg-primary | `#fcfcfc` (off-white) | `#181819` (ai-gray-1075) |
| bg-secondary | `#f3f4f5` (ai-gray-050) | `#28292b` (ai-gray-1000) |
| fill-primary | `#ffffff` | `#323435` (ai-gray-950) |
| fill-secondary | `#f3f4f5` | `#28292b` |
| fill-tertiary | `#f3f4f5` | `#5c5e61` (ai-gray-700) |
| text-primary / icon-primary | `#111112` (ai-gray-1100) | `#ffffff` |
| text-secondary / icon-secondary | `#00040996` (ai-gray-a650, ~60% alpha black-blue) | `#00060f70`-family alpha |
| text-tertiary | `#0007115e` (ai-gray-a400) | alpha variant |
| fill-divider | `#000c1e17` (black-a100) | white-a100 variant |
| fill-blue | accent → `#0064d4` | accent-dark → `#1793ff` |
| fill-outline | `#43a9ff` (blue-400) | `#2d9dff` (blue-450) |

## Core scales

ai-gray: 025 `#fafafa`, 050 `#f3f4f5`, 075 `#eeeff0`, 100 `#e9eaeb`, 150 `#e0e2e4`,
200 `#d1d3d5`, 300 `#b5b7bb`, 400 `#a1a4a8`, 500 `#8f9296`, 600 `#717477`, 700 `#5c5e61`,
800 `#4b4d4f`, 900 `#383b3d`, 950 `#323435`, 1000 `#28292b`, 1075 `#181819`, 1100 `#111112`.
Alpha variants `--ai-gray-aNNN` are `#000814`-based with hex alpha, e.g. a650 = `#00040996`.

blue: 050 `#e6f7ff` … 450 `#2d9dff`, 500 `#1793ff`, 650 `#0064d4`, 1100 `#00102c`.

Fonts: `optimisticAI` (body), `optimisticText` (UI text), `optimisticMono` (mono),
`hatchLetterCaveat` (handwritten accents). Free metric-compatible stand-in for remuse:
Inter (body) + JetBrains Mono; do not bundle Meta font files.

Accent theme system: `data-accent-color` ∈ blue/indigo/green/red/purple/pink/orange/monochrome,
each mapping `--accent` (light `-650`) and `--accent-dark` (dark `-500`). remuse: blue only.

## Usage notes

- Theme switching is a `.light` / `.dark` / `.dark-elevated` class on a container; map to
  two Compose color schemes (dark-elevated = bg `#28292b`, fill `#323435`).
- Chat layout tokens live on `<html>` inline style — they are per-theme and accent-dependent;
  treat the five `--chat-*` values as the composer/bubble contract.
- Everything else (spacing, radii, shadows) follows Tailwind v4 defaults (4px base unit).

## Dark theme and status colors (measured 2026-10-20, same CSS file)

`.dark` (web; the Android app's dark theme is true black and differs):

| token | dark |
|---|---|
| bg-primary / bg-secondary | `#181819` (ai-gray-1075) |
| fill-primary / fill-secondary | `#28292b` (ai-gray-1000) |
| fill-tertiary | `#525456` (ai-gray-750) |
| fill-secondary-elevated | `#ffffff1f` (white-a100) |
| text/icon-secondary | `#f2f7ff87` (ai-gray-dark-a550) |
| text/icon-tertiary | `#f1f6ff61` (ai-gray-dark-a700) |
| fill-divider | `#ffffff1f` (white-a100) |
| chat-agent-bubble | `#252628` |
| chat-user-bubble | `#0074e8` |

Status text colors (light / dark): success `#008200` / `#07b123`, warning `#c65323` /
`#f1916e`, destructive `#c01f37` / `#fa4758`. Light fill-divider is `#0000001a` (black-a100).
The earlier dark text-secondary entry (`#00060f70`) was wrong: dark uses the light-on-dark
`ai-gray-dark-aNNN` scale.
