# remuse

A Kotlin recreation of the Meta Muse Android app UI (com.facebook.aura), for study and demo.
Pure UI: no backend, no real accounts. All screens run on in-memory fake state so the whole
product can be demoed offline.

Monorepo layout:

```
android/   Android app (Kotlin + Jetpack Compose, Material3)
docs/      UI spec, APK teardown notes, reference material index
```

## Ground rules

- Reference screenshots live in `~/.local/share/openmuse-pi/muse-ref/` and contain the
  owner's personal data. Never copy or commit them; use them only as visual reference.
- No Meta assets (icons, images, fonts, sounds) may be copied from the APK into this repo.
  Recreate shapes and values in code.
- Fake state is the only state. Every screen must render and be navigable without network.
