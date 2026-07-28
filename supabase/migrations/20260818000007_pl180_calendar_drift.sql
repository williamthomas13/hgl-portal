-- PL-180: calendar-side edits to tutoring session events are DETECTED and
-- resolved deliberately, never silently adopted. One row per drifted
-- session, refreshed by the daily sweep and the tutoring-page scan; deleted
-- when resolved (adopt or revert) or when the drift disappears. Idempotent.
create table if not exists public.calendar_drift (
  session_id uuid primary key references public.tutoring_sessions(id) on delete cascade,
  tutor_id uuid not null references public.instructors(id) on delete cascade,
  gcal_event_id text not null,
  portal_starts_at timestamptz not null,
  portal_ends_at timestamptz not null,
  -- null start = the event was deleted by hand in Google
  cal_starts_at timestamptz,
  cal_ends_at timestamptz,
  detected_at timestamptz not null default now()
);

alter table public.calendar_drift enable row level security;

do $$ begin
  create policy calendar_drift_staff_read on public.calendar_drift
    for select using (
      exists (
        select 1 from public.profiles p
        where p.id = auth.uid() and p.role in ('admin', 'manager')
      )
    );
exception when duplicate_object then null; end $$;
