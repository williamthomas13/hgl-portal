-- PL-111: required session notes for 1-on-1 sessions.
--
-- One short note per tutoring session, attached to the STUDENT's durable
-- history. Read surfaces: the teaching tutor, any tutor who has taught the
-- student (the handoff file — PL-112 substitutes extend this), the parent
-- (parent-visible by design), and staff. Idempotent: safe to re-run.

create table if not exists public.session_notes (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null unique references public.tutoring_sessions(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  tutor_id uuid not null references public.instructors(id) on delete cascade,
  note text not null,
  next_time text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists session_notes_student_idx on public.session_notes (student_id);
create index if not exists session_notes_tutor_idx on public.session_notes (tutor_id);

alter table public.session_notes enable row level security;

drop policy if exists "admin all" on public.session_notes;
create policy "admin all" on public.session_notes
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- The teaching tutor writes their own note, and only for a session that is
-- genuinely theirs.
drop policy if exists "tutor insert own" on public.session_notes;
create policy "tutor insert own" on public.session_notes
  for insert to authenticated
  with check (
    exists (
      select 1 from public.instructors i
      where i.id = tutor_id and lower(i.email) = public.jwt_email()
    )
    and exists (
      select 1 from public.tutoring_sessions ts
      where ts.id = session_id and ts.tutor_id = tutor_id
    )
  );

drop policy if exists "tutor update own" on public.session_notes;
create policy "tutor update own" on public.session_notes
  for update to authenticated
  using (
    exists (
      select 1 from public.instructors i
      where i.id = tutor_id and lower(i.email) = public.jwt_email()
    )
  )
  with check (
    exists (
      select 1 from public.instructors i
      where i.id = tutor_id and lower(i.email) = public.jwt_email()
    )
  );

-- Any tutor who has a session with the student reads the student's whole
-- note history — the handoff file. (PL-112 substitute coverage rides this:
-- a covering tutor gets a session row, which opens the history.)
drop policy if exists "tutor read taught students" on public.session_notes;
create policy "tutor read taught students" on public.session_notes
  for select to authenticated
  using (
    exists (
      select 1 from public.tutoring_sessions ts
      join public.instructors i on i.id = ts.tutor_id
      where ts.student_id = session_notes.student_id
        and lower(i.email) = public.jwt_email()
    )
  );

-- Parents read their own student's notes (parent-visible by design).
drop policy if exists "parent read own student" on public.session_notes;
create policy "parent read own student" on public.session_notes
  for select to authenticated
  using (
    exists (
      select 1 from public.students st
      join public.families f on f.id = st.family_id
      where st.id = session_notes.student_id
        and lower(f.parent_email) = public.jwt_email()
    )
  );
