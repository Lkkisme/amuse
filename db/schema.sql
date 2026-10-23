CREATE TABLE schema_migrations (version varchar(255) primary key);
CREATE TABLE chats (
  id text primary key,
  title text not null,
  at text not null,
  updated text not null
) strict, without rowid;
CREATE TABLE events (
  chat text not null references chats (id) on delete cascade,
  seq integer not null,
  event text not null,
  primary key (chat, seq)
) strict, without rowid;
CREATE TABLE access (
  id integer primary key check (id = 1),
  salt text not null,
  hash text not null
) strict;
CREATE TABLE sessions (
  position integer primary key autoincrement,
  digest text not null unique
) strict;
CREATE TABLE app_rules (
  app text not null,
  kind text not null,
  permission text not null check (permission in ('allow', 'ask', 'deny')),
  primary key (app, kind)
) strict, without rowid;
CREATE TABLE browser_rules (
  action text primary key,
  permission text not null check (permission in ('allow', 'ask', 'deny'))
) strict, without rowid;
CREATE TABLE site_rules (
  site text primary key,
  never integer not null check (never in (0, 1)),
  visit text check (visit in ('allow', 'ask', 'deny')),
  submit text check (submit in ('allow', 'ask', 'deny')),
  download text check (download in ('allow', 'ask', 'deny')),
  upload text check (upload in ('allow', 'ask', 'deny'))
) strict, without rowid;
CREATE TABLE defaults_set (
  key text primary key
) strict, without rowid;
CREATE TABLE sent (
  id text primary key,
  by text not null check (by in ('user', 'muse')),
  attachment text not null
) strict, without rowid;
CREATE TABLE imported_files (
  name text primary key,
  bytes integer not null,
  sha256 text not null,
  imported_at text not null
) strict, without rowid;

-- Dbmate schema migrations
INSERT INTO schema_migrations (version) VALUES
  ('20261023100000'),
  ('20261023100100');
