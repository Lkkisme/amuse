-- The PIN is optional (#66): `off` is the owner's choice not to have one, which is not the same as never having set one.
-- With it off, sensitive actions go through, nothing is asked and no reminder comes back, until a PIN is set again
-- (which clears it). An instance from before this has no choice recorded, so it is not off: it is asked for a PIN as it
-- was. The row's `id` check stays the one place that says there is one row.

-- migrate:up

alter table pin add column off integer not null default 0 check (off in (0, 1));

-- migrate:down

alter table pin drop column off;
