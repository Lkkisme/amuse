-- The server's own state, which used to be loose files beside events.jsonl.
-- STRICT tables: a column holds what it says it holds.

-- migrate:up

-- The chats. The main chat always exists: the host writes to its journal before it has saved the list.
create table chats (
  id text primary key,
  title text not null,
  at text not null,
  updated text not null
) strict, without rowid;
insert into chats (id, title, at, updated) values ('main', '', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

-- The journal: append-only. A chat's events, numbered 1, 2, 3 … without gaps, each the event as JSON.
-- A deleted chat takes its events with it.
create table events (
  chat text not null references chats (id) on delete cascade,
  seq integer not null,
  event text not null,
  primary key (chat, seq)
) strict, without rowid;

-- The one master password (a scrypt hash), and the sessions it opened (hashes of them), oldest first.
create table access (
  id integer primary key check (id = 1),
  salt text not null,
  hash text not null
) strict;
create table sessions (
  position integer primary key autoincrement,
  digest text not null unique
) strict;

-- What the agent may do with connections, and in the browser (core/policy.ts).
create table app_rules (
  app text not null,
  kind text not null,
  permission text not null check (permission in ('allow', 'ask', 'deny')),
  primary key (app, kind)
) strict, without rowid;
create table browser_rules (
  action text primary key,
  permission text not null check (permission in ('allow', 'ask', 'deny'))
) strict, without rowid;
create table site_rules (
  site text primary key,
  never integer not null check (never in (0, 1)),
  visit text check (visit in ('allow', 'ask', 'deny')),
  submit text check (submit in ('allow', 'ask', 'deny')),
  download text check (download in ('allow', 'ask', 'deny')),
  upload text check (upload in ('allow', 'ask', 'deny'))
) strict, without rowid;

-- The schedules every instance starts with that have been set up (so each is set up once).
create table defaults_set (
  key text primary key
) strict, without rowid;

-- The files sent in the chat, by id: the attachment as JSON, and who sent it.
create table sent (
  id text primary key,
  by text not null check (by in ('user', 'muse')),
  attachment text not null
) strict, without rowid;

-- The old files that were imported, as they were: kept so an import can be checked, and shown never to repeat.
create table imported_files (
  name text primary key,
  bytes integer not null,
  sha256 text not null,
  imported_at text not null
) strict, without rowid;

-- migrate:down
drop table imported_files;
drop table sent;
drop table defaults_set;
drop table site_rules;
drop table browser_rules;
drop table app_rules;
drop table sessions;
drop table access;
drop table events;
drop table chats;
