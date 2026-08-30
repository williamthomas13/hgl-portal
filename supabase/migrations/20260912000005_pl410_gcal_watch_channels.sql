-- PL-410: Google Calendar push channels — near-instant drift detection. One
-- row per watched tutor calendar: our minted channel id + high-entropy token
-- (Google echoes both on every push; anything unmatched is noise, never
-- data), Google's resource id + expiry (channels live ~a week — the hourly
-- sweep re-arms expiring ones), the webhook URL registered (a URL change,
-- e.g. the DNS cutover, makes the sweep re-register), and last_push_at (the
-- burst debounce stamp: a mass-delete's flurry of pushes coalesces into ONE
-- audit pass). tutor_id is a PLAIN uuid — no FK (the batch-40 PostgREST
-- rule). RLS on with no policies: service-role plumbing, nothing client-side
-- reads it (the gcal_connection pattern). Idempotent.

create table if not exists gcal_watch_channels (
  id uuid primary key default gen_random_uuid(),
  tutor_id uuid not null,
  calendar_id text not null,
  channel_id text not null unique,
  channel_token text not null,
  resource_id text,
  expiration timestamptz,
  webhook_url text,
  last_push_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists gcal_watch_channels_tutor on gcal_watch_channels (tutor_id);
alter table gcal_watch_channels enable row level security;

notify pgrst, 'reload schema';
