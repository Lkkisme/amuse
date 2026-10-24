-- Account security (#30): the PIN that authorizes sensitive actions, and the devices let in.

-- migrate:up

-- The PIN, as a scrypt hash only (none yet: both null). `used`: when it was last entered right, or set (the 7-day
-- reminder counts from it); `later`: the reminders wait until then; `wrong`: wrong tries since the last right one or the
-- last lockout; `lockouts`: lockouts since the last right one (each lasts twice the one before); `locked`: no tries
-- until then; `minutes`: how long an unlock lasts after the last sensitive action. One row, made here, so an instance
-- from before the PIN has it too, with no PIN.
create table pin (
  id integer primary key check (id = 1),
  salt text,
  hash text,
  used text,
  later text,
  wrong integer not null default 0,
  lockouts integer not null default 0,
  locked text,
  minutes integer not null default 5 check (minutes in (1, 5, 15, 30)),
  check ((salt is null) = (hash is null))
) strict;
insert into pin (id) values (1);

-- The devices that came in with the password. `digest`: the hash of the device's own cookie (null for one signed in
-- before this, until it next comes); `trusted`: it may open sessions; `asked`: when the password was last given on it
-- while it was not trusted (it waits for a trusted device's approval); `agent` and `address`: what it said it is, and
-- where it came from, for the card a trusted device approves it on.
create table devices (
  id text primary key,
  digest text unique,
  trusted integer not null check (trusted in (0, 1)),
  asked text,
  agent text not null,
  address text not null,
  at text not null,
  seen text not null
) strict, without rowid;

-- Every session belongs to a device now, and goes with it. The sessions open before this were opened with the
-- password, on devices that are the owner's: each becomes a trusted device of its own.
insert into devices (id, digest, trusted, asked, agent, address, at, seen)
  select 'before-' || position, null, 1, null, '', '', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now') from sessions;
alter table sessions rename to sessions_before;
create table sessions (
  position integer primary key autoincrement,
  digest text not null unique,
  device text not null references devices (id) on delete cascade
) strict;
insert into sessions (position, digest, device) select position, digest, 'before-' || position from sessions_before;
drop table sessions_before;
create index sessions_device on sessions (device);

-- migrate:down
alter table sessions rename to sessions_after;
create table sessions (
  position integer primary key autoincrement,
  digest text not null unique
) strict;
insert into sessions (position, digest) select position, digest from sessions_after;
drop table sessions_after;
drop table devices;
drop table pin;
