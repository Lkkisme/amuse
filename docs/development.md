# Development

Monorepo layout (mise monorepo; `mise run check`, `mise run generate`):

```
protocol/  the contract: zod schemas → TS types, JSON Schema, OpenRPC, Kotlin (JSON-RPC 2.0 over WebSocket)
core/      the pure rules (decide) and the host that runs them; no IO
db/        the database: opening it, the migration runner, the migrations (SQL and TypeScript), schema.sql, upgrade fixtures
api/       the server: JSON-RPC, the live browser relay, the stores (journal, chats, rules, access …), the data commands
pi/        the chat and browser agents (Pi)
browser/   the auto-browser pool, and desktop sizing
sandbox/   Amuse's own machine: its image (Dockerfile), control daemon and the client the agents use
composio/  connections (Composio)
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
- Every change someone running Amuse would notice goes in `CHANGELOG.md` under Unreleased, in the same
  commit: what it does for them, in a line, not how it was done. A release moves Unreleased under its version
  and date, tags it (`vX.Y.Z`) and publishes the section as the GitHub release's notes.
- The server reads that changelog at start (`api/src/whats-new.ts`): the bullets under Added and Changed are what it tells the user about after an update, once each, in the chat. Write them for the user, and leave an operator-only bullet (an `amuse-admin` command) out of those two sections.

## Develop

```
mise run dev     # API (restarts on change) + Vite with HMR, from ~/.config/remuse/dev.env
mise run check   # type-check and test every package
mise run //api:try   # a throwaway API for live tests (own port, temp journal)
```

## The database

The server keeps its own state in one SQLite file, `amuse.db` in the data folder (`AMUSE_DATA`, or the folder of
`AMUSE_JOURNAL`; `/data` in Docker), through Node's built-in `node:sqlite`, so there is no dependency to add. In
Node 24 the module is Stability 1.2, "release candidate" (nodejs.org/api/sqlite.html), and it prints no
ExperimentalWarning. SQLite is 3.53 there, with FTS5. The file is opened one way (`db/src/open.ts`): WAL, foreign
keys on, a 5 s `busy_timeout`, `synchronous = full` (every commit is on disk when it returns), mode 600.

What is in it: the journal (`events`, append-only, one row per event, replayed one row at a time; the host keeps
only the latest 1000 events of a chat to catch a client up, and sends a snapshot to one further behind), chats,
the rules, the password and its sessions, the defaults set up, the index of sent files. What stays as files: the
workspace (Amuse's memory, goals, skills and the user's files). The Vault (the user's long-term secrets, and the keys of
the models, speech and Composio, with the model choice) is in it too, with every secret value sealed: its key is a file
in a folder of its own (`AMUSE_SECRETS_DIR`, the `vault-key` volume), never in `/data`. The image sets it; in development
set it in `~/.config/remuse/dev.env` to a folder apart from the data (without it, the key is made in `secret-key/` beside the
data, with a warning), and compose.yaml's `secrets` service makes the volume's folder for uid 1000.

Replay is not the bottleneck yet: 620,000 events (about a year of use) replay in 1.3 s. If that changes, the next step
is a snapshot of each chat's state with the last event it covers, but a snapshot is only a cache of the events and
has to be thrown away whenever the reducer (`protocol/src/events.ts`) changes, so it is not built until it is needed.
Full-text search (FTS5) is not used: `recall` searches the chats' state in memory, and `memory_search` searches
Markdown files that Amuse and the user edit as files, so an index would have to follow every such edit.

Tests that need a folder take it from `tempFolder()` in `@amuse/db` (db/src/testing.ts), which removes it when the process ends; `migratedDatabase()` does the same.

Commands, beside the server: `amuse-admin <command>`, run as the container's default user, not as root (on the image's PATH, so `docker compose exec amuse amuse-admin …`; in development `node api/src/admin.ts --data <folder> …`). The name `amuse` is kept for a client on the user's own computer (#39):

```
migrate [--dry-run]   run the pending migrations now, or list them and what each touches
rollback --yes        undo the newest migration (it needs a migrate:down), after a copy; never applies pending ones
retire-old-files      rename old files left beside a database that imported them, if they are exactly what was imported
export [chat]         the chat's journal as JSONL (the main chat by default), each event as it was stored
chats                 the chats and how many events each has
reset-password        forget the master password; the next visit sets one
schema                write db/schema.sql
restore-secret-files  write keys.json and sandbox-secrets.json back from their sealed copies in the database
forget-secret-files --yes   delete those sealed copies
reset-vault --yes     forget everything in the Vault (its key is lost for good), after a copy, so a new key can be made
```

### Migrations

`db/migrations/<14-digit timestamp>_<name>.sql` in dbmate's format (`-- migrate:up`, `-- migrate:down`), and
`<timestamp>_<name>.ts` for what SQL cannot do. They are one sequence, ordered by timestamp. `schema_migrations(version)`
is dbmate's table, so the dbmate CLI can be pointed at the same file for the SQL ones in development; it ignores the
TypeScript ones, so run Amuse's runner for anything that has them.

At every start, before anything opens the data, `api/src/data.ts` checks the folders (`preflight`: the data folder,
`backups/`, `workspace/`; each with the hint to show if it is wrong), opens the database and runs `migrate`:

- a database with a migration this code does not have is refused, naming the version it needs;
- the old files (`events.jsonl`, `access.json` …) beside a database that has already imported them are refused too, since
  an older version run on this data starts empty with no password: the page says so, and `amuse-admin retire-old-files`
  finishes an interrupted rename for files that are exactly what was imported;
- `AMUSE_DATA` empty, or naming another folder than `AMUSE_JOURNAL`'s, is refused: the old files are read from where
  the journal is, and never imported into another folder's database;
- if the database already has migrations applied and some are pending, it is copied first, online, to
  `backups/<time>-pre-migrate.db` (mode 600; a new database has nothing to copy; a copy that fails is removed, and the
  newest five are kept);
- each migration runs in a transaction of its own with its row in `schema_migrations`; a failure rolls that one back
  and stops the start;
- when the start stops for a reason it can name, the server still listens and answers every request with a plain page
  (`api/src/startup.ts`, English and Chinese) that says which step failed and what to do, and nothing else: it is seen
  before anyone has signed in, so no path and none of what SQLite, zod or `JSON.parse` said is on it. The details go to
  the server's log. The reasons are values
  (`Problem` in `db/src/problem.ts`), and their words are a typed catalog in `startup.ts`: add the words for a new
  kind there, or it does not compile.

To add a migration, give it a timestamp later than the newest (`date -u +%Y%m%d%H%M%S`) and write one of:

- SQL: `-- migrate:up` and `-- migrate:down` sections. Tables are `strict`. Then `amuse-admin schema` (`node api/src/admin.ts schema` in development) rewrites
  `db/schema.sql`; a test checks that it matches what the migrations leave.
- TypeScript: export `up(context)`, `describe(context)` (what it would touch, in words, without changing anything: the dry
  run prints it) and, if it can be undone, `down(context)`. `context.db` is inside the migration's transaction, so all
  or nothing. `up` may return a function that runs after the commit, for what a transaction cannot cover (renaming
  files); if that fails it is logged and the migration stands, so keep it to steps that can be repeated. Read old
  files without editing them, check what you wrote by reading it back, and throw to roll back. A migration is a
  frozen snapshot of what it knew: read old shapes with schemas of its own (`db/src/legacy/frozen.ts`, which imports
  nothing from core or the protocol; a test checks), not the live stores. Migration 1 validates an event line by its shape
  only and stores the event's text exactly as written, so a field this version does not know is never dropped; the live schema reads it at
  replay.

The Vault is an example of both kinds: `20261023110000_vault.sql` makes its tables, and `20261023110100_import_secrets.ts`
moves `keys.json`, `models.json` and `sandbox-secrets.json` into them (the work is in `db/src/legacy/vault.ts`, which has
its own frozen copy of how a value is sealed; a test in `api/` checks that it opens in the live Vault). Sealing is
synchronous (`node:crypto`), as `up` must be. The two files that held secrets in the open are deleted after the import is
read back and every secret opened again; the database keeps them only sealed (`imported_secret_files`), and `amuse-admin
restore-secret-files` and `forget-secret-files` bring them back or delete them. `Context.secretsDir` is the key's folder.
Anything that needs a folder checked at start (a key folder) adds a `Requirement` to the `preflight` list in `data.ts`, with
a `Hint`: the Vault's is `key-folder`. A store takes `db`, writes in `transaction()` (a savepoint when a caller has one
open), and does what reaches the sandbox first and takes it back if a step fails (`api/src/secret-store.ts`).

### Upgrade fixtures

`db/fixtures/<version>/data/` is a data folder as that release wrote it, with fake values only, made with the
release's own code (see `db/fixtures/README.md`). `api/src/upgrade.test.ts` starts every fixture on the current code, so
the whole chain runs from each one, and checks what it kept. At each release, add its fixture and the facts to check
(for #30: that an upgraded instance with no PIN asks for one).
