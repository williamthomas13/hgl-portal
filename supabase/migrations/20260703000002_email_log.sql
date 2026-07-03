-- =============================================================================
-- HGL Portal: Email log
-- =============================================================================
-- One row per automated email actually sent. The dedupe_key is the guard that
-- lets both the Stripe webhook (which Stripe retries on failure) and the daily
-- reminder cron re-run safely without emailing anyone twice:
--   confirmation:<enrollment_id>
--   class_starting:<enrollment_id>
--   session_reminder:<enrollment_id>:<session_id>
--
-- RLS intentionally off, consistent with the rest of the schema until the
-- auth phase adds real policies.
-- =============================================================================

create table if not exists public.email_log (
  id uuid primary key default gen_random_uuid(),
  dedupe_key text unique not null,
  email_type text not null,
  enrollment_id uuid references public.enrollments(id) on delete set null,
  session_id uuid references public.sessions(id) on delete set null,
  recipients text[] not null,
  sent_at timestamptz not null default now()
);

create index if not exists idx_email_log_enrollment_id
  on public.email_log(enrollment_id);

-- This Supabase project auto-enables RLS on newly created tables
-- (that is what silently locked schools/sessions after the foundation
-- migration), so turn it off explicitly.
alter table public.email_log disable row level security;
