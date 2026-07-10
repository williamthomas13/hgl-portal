-- =============================================================================
-- HGL Portal — Feature B1: instructor attendance
-- (docs/COMMS_ATTENDANCE_PARENT_SPEC.md §B1)
-- =============================================================================
-- One row per (session × enrollment). Model per spec's stated preference:
-- present boolean + arrived_late/left_early booleans (composable), with
-- optional minutes for precision. Tracking threshold (decided July 10):
-- under 10 minutes is NOT tracked — the student is simply Present; the
-- minutes columns therefore enforce >= 10, and a bare Late/Left-early tap
-- (minutes null) is interpreted as exactly 10 by the computation.
--
-- RLS (spec cross-cutting §3, on the EXISTING Phase 3 helper functions):
--   staff full CRUD · instructors read/write only their classes' records ·
--   parents read their own students' · counselors read their school's.
--
-- IDEMPOTENT: re-runnable as a set.
-- =============================================================================

create table if not exists public.attendance_records (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  enrollment_id uuid not null references public.enrollments(id) on delete cascade,
  present boolean not null default true,
  arrived_late boolean not null default false,
  left_early boolean not null default false,
  minutes_late integer check (minutes_late is null or minutes_late >= 10),
  minutes_left_early integer check (minutes_left_early is null or minutes_left_early >= 10),
  note text,
  recorded_by text,
  recorded_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (session_id, enrollment_id),
  -- Absent rows carry no late/early flags; minutes only ride their flag.
  check (present or (not arrived_late and not left_early)),
  check (minutes_late is null or arrived_late),
  check (minutes_left_early is null or left_early)
);

create index if not exists idx_attendance_session on public.attendance_records (session_id);
create index if not exists idx_attendance_enrollment on public.attendance_records (enrollment_id);

alter table public.attendance_records enable row level security;

drop policy if exists "staff all" on public.attendance_records;
create policy "staff all" on public.attendance_records
  for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- Instructors: full CRUD, but only for enrollments in their own classes.
drop policy if exists "instructor own classes" on public.attendance_records;
create policy "instructor own classes" on public.attendance_records
  for all to authenticated
  using (
    exists (
      select 1 from public.enrollments e
      where e.id = enrollment_id
        and e.class_id in (select public.instructor_class_ids())
    )
  )
  with check (
    exists (
      select 1 from public.enrollments e
      where e.id = enrollment_id
        and e.class_id in (select public.instructor_class_ids())
    )
  );

-- Parents: read-only, own students.
drop policy if exists "parent own students" on public.attendance_records;
create policy "parent own students" on public.attendance_records
  for select to authenticated
  using (
    exists (
      select 1 from public.enrollments e
      where e.id = enrollment_id
        and e.student_id in (select public.family_student_ids())
    )
  );

-- Counselors: read-only, their school's students (decided July 10).
drop policy if exists "counselor school read" on public.attendance_records;
create policy "counselor school read" on public.attendance_records
  for select to authenticated
  using (
    exists (
      select 1 from public.enrollments e
      join public.classes c on c.id = e.class_id
      where e.id = enrollment_id
        and c.school_id in (select public.counselor_school_ids())
    )
  );

notify pgrst, 'reload schema';
