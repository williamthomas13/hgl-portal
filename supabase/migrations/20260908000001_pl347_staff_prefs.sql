-- PL-347: per-staff UI preferences — a tiny key/value store keyed by staff
-- email, created for the snapshot card's persisted reporting-period lens
-- (key 'report_snapshot_period'). app_settings is GLOBAL; this is the
-- per-person twin. IDEMPOTENT: re-runnable as a set.
--
-- The portal degrades gracefully while this is unapplied (preference reads
-- and writes are wrapped server-side and fall back to the default lens), so
-- it can ship dark and be applied whenever convenient.

create table if not exists public.staff_prefs (
  email text not null,
  key text not null,
  value text not null,
  updated_at timestamptz not null default now(),
  primary key (email, key)
);

comment on table public.staff_prefs is
  'PL-347: per-staff UI preferences (e.g. report_snapshot_period). Written via staff-gated API routes.';

alter table public.staff_prefs enable row level security;
drop policy if exists "staff all" on public.staff_prefs;
create policy "staff all" on public.staff_prefs
  for all using (public.is_staff()) with check (public.is_staff());

notify pgrst, 'reload schema';
