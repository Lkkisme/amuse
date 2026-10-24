# Upgrade fixtures

One folder per released version: `db/fixtures/<version>/data/` is a data folder as that release writes it
(`/data` in Docker), with fake values only. `api/src/upgrade.test.ts` runs the whole migration chain from every
folder here, and checks that nothing the release kept is lost. Later work leans on it (for example, that an
upgraded instance with no PIN asks for one).

## Adding one, at each release

1. Make a data folder with that release's own code, not by hand: `git archive vX.Y.Z | tar -x -C /tmp/amuse-vX`, link
   its dependencies, and run a script like the previous fixture's `make.txt` (it drives the release's own stores: a few
   messages in the main chat and a side chat, a password, keys, rules, an upload). Only fake values: the password, the
   keys and the secrets must be made up, and say so in their names.
2. Copy the result to `db/fixtures/<version>/data/` and keep the script as `db/fixtures/<version>/make.txt`.
3. List what the test should find in it in `facts` in `api/src/upgrade.test.ts`, and run `mise run //api:check`.

Never copy a real instance's data here.

## What is in 0.1.0

| File | Fake value |
| --- | --- |
| `access.json` | the master password is `fixture-password-0.1.0`; two sessions are open |
| `keys.json` | an OpenRouter key and a Composio key, both made up |
| `models.json` | the chat model `openrouter/fake-model` |
| `sandbox-secrets.json` | one made-up token for `GH_TOKEN` (all three of these end up in the Vault; `keys.json` and this file are deleted once imported) |
| `events.jsonl`, `chats/`, `chats.json` | the main chat and one side chat, scripted by the demo ports |
| `rules.json`, `defaults.json`, `sent.json` | a few rules, the four first defaults, one uploaded photo |
| `workspace/` | a memory file, a skill, the uploaded photo |
