-- The Vault: the long-term secrets Amuse keeps for the user (protocol/src/secrets.ts says what an entry is), and the model
-- choice, which used to be models.json. A secret field's value is sealed (AES-256-GCM, api/src/seal.ts) with a key that is
-- not in this file: it lives in a folder of its own, apart from the data. STRICT tables: a column holds what it says it holds.

-- migrate:up

-- A value sealed when the Vault was first used, which only the right key opens: a wrong key is found at the start, not
-- when a secret is wanted.
create table vault_check (
  id integer primary key check (id = 1),
  sealed text not null
) strict;

-- An entry: a name (one each, however it is cased), whether the system keeps it (a provider's sign-in), a note.
create table secrets (
  id text primary key,
  name text not null,
  managed integer not null check (managed in (0, 1)),
  note text not null,
  created text not null
) strict, without rowid;
create unique index secrets_name on secrets (lower(name));

-- An entry's plain fields, in order. `value` is the text, or a file's bytes in base64.
create table secret_plain (
  entry text not null references secrets (id) on delete cascade,
  position integer not null,
  name text not null,
  role text check (role is null or role = 'username'),
  kind text not null check (kind in ('text', 'file')),
  value text not null,
  filename text,
  primary key (entry, name)
) strict, without rowid;

-- An entry's secret fields, in order. `sealed` is the value; the rest is what may be shown (a hint, a file's name and size)
-- and when and how the field was last used.
create table secret_fields (
  entry text not null references secrets (id) on delete cascade,
  position integer not null,
  name text not null,
  role text check (role is null or role = 'password'),
  kind text not null check (kind in ('text', 'file')),
  filename text,
  size integer not null check (size >= 0),
  hint text,
  sealed text not null,
  last_at text,
  last_how text check (last_how is null or last_how in ('sandbox', 'server')),
  last_what text,
  primary key (entry, name)
) strict, without rowid;

-- Where a field goes: a variable (name) or a file (path, and a variable for its path) in the sandbox, or a service of the
-- server's (service, target).
create table secret_uses (
  id text primary key,
  entry text not null references secrets (id) on delete cascade,
  position integer not null,
  field text not null,
  kind text not null check (kind in ('env', 'file', 'server')),
  name text,
  path text,
  env text,
  service text,
  target text
) strict, without rowid;

-- What each use takes for itself: a variable, a file, a service. One use to a claim, so two fields cannot have the same
-- variable or the same service, whatever the code above this does.
create table secret_claims (
  claim text primary key,
  use text not null references secret_uses (id) on delete cascade
) strict, without rowid;

-- The models chosen for the chat, the browser and background work, and how much each thinks (one row, as JSON).
create table model_choice (
  id integer primary key check (id = 1),
  choice text not null
) strict;

-- keys.json and sandbox-secrets.json as they were when the Vault took them in, sealed with the Vault's key (never as they
-- were written: no plaintext copy is kept). `amuse-admin restore-secret-files` writes them back; `forget-secret-files` deletes them.
create table imported_secret_files (
  name text primary key,
  sealed text not null
) strict, without rowid;

-- What the sandbox could not be told to forget (it was out of reach when a secret was removed): a variable or a file in its
-- home, to be taken out the next time it is reached. Names only, never a value.
create table sandbox_cleanup (
  kind text not null check (kind in ('env', 'file')),
  target text not null,
  primary key (kind, target)
) strict, without rowid;

-- migrate:down
drop table sandbox_cleanup;
drop table imported_secret_files;
drop table model_choice;
drop table secret_claims;
drop table secret_uses;
drop table secret_fields;
drop table secret_plain;
drop index secrets_name;
drop table secrets;
drop table vault_check;
