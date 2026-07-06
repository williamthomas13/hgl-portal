-- =============================================================================
-- HGL Portal: email delivery events (Resend webhook)
-- =============================================================================
-- Stores bounce/complaint events from Resend. The weekly admin digest reports
-- hard bounces on student emails (bad addresses collected at registration)
-- and any spam complaints.
-- =============================================================================

create table if not exists public.email_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,          -- e.g. email.bounced, email.complained
  email_address text not null,       -- the affected recipient
  subject text,
  resend_email_id text,
  bounce_type text,                  -- Permanent (hard) / Transient (soft)
  payload jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_email_events_created
  on public.email_events(created_at);

create index if not exists idx_email_events_type
  on public.email_events(event_type);

-- This Supabase project auto-enables RLS on new tables — turn it off
-- explicitly until the auth phase.
alter table public.email_events disable row level security;
