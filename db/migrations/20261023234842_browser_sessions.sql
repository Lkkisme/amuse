-- The browsers open on a controller, so a restart adopts their sessions again instead of leaving them behind.

-- migrate:up

-- One row per open browser: the node it leases and the session it runs in. A run the pool closes takes its row with
-- it; the start reconciles what is left (browser/src/pool.ts).
create table browser_sessions (
  id text primary key,
  node text not null,
  session text not null
) strict, without rowid;

-- migrate:down

drop table browser_sessions;
