-- PL-213: access lifecycle — instructor identity requires instructors.active.
-- deriveRoles (login) gets the same filter in code; these are the RLS
-- policies that key off instructor identity, recreated with the active
-- check so an inactive instructor's existing session reads nothing either.
-- History stays intact (nothing deleted); reactivating restores access.
-- Plus: team_access_audit — every Team-access grant/revoke writes a line.
-- Idempotent.

-- session_notes: tutor writes own note
drop policy if exists "tutor update own" on public.session_notes;
create policy "tutor update own" on public.session_notes
  for update to authenticated
  using (
    exists (
      select 1 from public.instructors i
      where i.id = tutor_id and lower(i.email) = public.jwt_email() and i.active
    )
  )
  with check (
    exists (
      select 1 from public.instructors i
      where i.id = tutor_id and lower(i.email) = public.jwt_email() and i.active
    )
  );

-- session_notes: tutor reads taught students' history
drop policy if exists "tutor read taught students" on public.session_notes;
create policy "tutor read taught students" on public.session_notes
  for select to authenticated
  using (
    exists (
      select 1 from public.tutoring_sessions ts
      join public.instructors i on i.id = ts.tutor_id
      where ts.student_id = session_notes.student_id
        and lower(i.email) = public.jwt_email()
        and i.active
    )
  );

-- coverage_requests: tutor reads own side
drop policy if exists "tutor read own" on public.coverage_requests;
create policy "tutor read own" on public.coverage_requests
  for select to authenticated
  using (
    exists (
      select 1 from public.instructors i
      where (i.id = requesting_tutor_id or i.id = candidate_tutor_id)
        and lower(i.email) = public.jwt_email()
        and i.active
    )
  );

-- student_materials: tutor/instructor reads taught students
drop policy if exists "tutor read taught students" on public.student_materials;
create policy "tutor read taught students" on public.student_materials
  for select to authenticated
  using (
    exists (
      select 1 from public.tutoring_sessions ts
      join public.instructors i on i.id = ts.tutor_id
      where ts.student_id = student_materials.student_id
        and lower(i.email) = public.jwt_email()
        and i.active
    ) or exists (
      select 1 from public.enrollments en
      join public.classes c on c.id = en.class_id
      join public.instructors i on i.id = c.instructor_id
      where en.student_id = student_materials.student_id
        and lower(i.email) = public.jwt_email()
        and i.active
    )
  );

-- Team access audit: who changed whose access, when. Writes happen through
-- the admin-only API under service role; admins read it in the panel.
create table if not exists public.team_access_audit (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),
  actor_email text not null,
  action text not null,
  target_email text not null,
  detail text
);

alter table public.team_access_audit enable row level security;

do $$ begin
  create policy "admin read" on public.team_access_audit
    for select to authenticated using (public.is_admin());
exception when duplicate_object then null; end $$;
