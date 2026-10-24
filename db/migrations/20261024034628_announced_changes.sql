-- What an update brought that the user has been told about: one row per changelog entry, by the hash of its bullet
-- (api/src/whats-new.ts). An empty table is an instance that has never announced anything: its first start records
-- every entry as seen and says nothing, so a fresh install, or this very update, does not dump the whole history.

-- migrate:up

create table announced_changes (
  hash text primary key
) strict, without rowid;

-- migrate:down

drop table announced_changes;
