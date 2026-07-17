-- =============================================================================
-- HGL Portal — Availability & matching (PL-19, docs/AVAILABILITY_MATCHING_SPEC.md)
-- =============================================================================
-- Structured student availability, captured on the public intake form and the
-- New Student Schedule wizard, powering ranked slot suggestions inside the
-- wizard. Suggestions only — the Ops Director's judgment wins (7a rule).
--
-- Weekday convention: 1 = Monday … 7 = Sunday, matching RecurrenceSlot and
-- offer_windows everywhere else in this codebase (the spec sketch said 0–6;
-- consistency with the existing convention wins to keep one weekday scheme).
--
-- IDEMPOTENT: safe to re-run.
-- =============================================================================

create table if not exists public.student_availability (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  weekday int not null check (weekday between 1 and 7),
  start_time time not null,
  end_time time not null check (end_time > start_time),
  -- The FAMILY's timezone — captured with the ranges because student and
  -- tutor timezones differ; the matcher normalizes across zones.
  timezone text not null,
  source text not null check (source in ('intake', 'staff')),
  updated_at timestamptz not null default now(),
  updated_by text
);

comment on table public.student_availability is
  'PL-19: when a student is usually free for tutoring, one row per weekly '
  'time range on the family''s local wall clock. Multiple ranges per weekday '
  'allowed. NO rows = unknown (never treated as "unavailable"). Written by '
  'the public intake form (source=intake, service role) and the New Student '
  'Schedule wizard (source=staff).';

create index if not exists student_availability_student_idx
  on public.student_availability (student_id);

alter table public.student_availability enable row level security;

-- Staff read/write from the wizard (browser client). Intake submissions go
-- through the service role and bypass RLS. No tutor/parent policies for v1 —
-- parent self-serve editing is explicitly out of scope.
drop policy if exists "staff all" on public.student_availability;
create policy "staff all" on public.student_availability
  for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- PostgREST: pick up the new table
notify pgrst, 'reload schema';
