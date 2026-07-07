-- =============================================================================
-- HGL Portal: Phase 4 — portal views, counselor digests, classroom requests,
-- score display groundwork, instructor defaults (docs/PHASE4_SPEC.md)
-- =============================================================================
-- Adds:
--   student_scores        — Synap score display layer (§6); ships dark until
--                           ingestion exists. All three portal views read it.
--   instructors            — per-instructor defaults, keyed by email (§5);
--                           default_meeting_link auto-fills online classrooms.
--   classroom_requests     — state for the counselor classroom-request loop (§4b).
--   school_counselors.digest_frequency / digest_last_sent_at — §4a digests.
--
-- The parent/counselor/instructor READ policies for existing tables already
-- shipped in 20260707000003 (keyed off the JWT email claim, not profiles.role)
-- — Phase 4 portal views sit directly on them. This migration only adds
-- policies for the new tables.
--
-- Reminder for this project: Supabase auto-enables RLS on new tables; these
-- tables get real policies below, so that's what we want.
-- =============================================================================
-- IDEMPOTENT (July 7): every create policy is preceded by drop policy if
-- exists, so the file is safe to re-run against a database where it (or any
-- part of it) already applied — re-running the whole migration set in order
-- must never error.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. student_scores (§6 display layer; ingestion decided separately)
-- -----------------------------------------------------------------------------
create table if not exists public.student_scores (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  class_id uuid references public.classes(id) on delete set null,
  test_label text not null,                 -- e.g. "Diagnostic 1", "SAT Practice 2"
  section_scores jsonb,                     -- e.g. {"Reading & Writing": 620, "Math": 580}
  total numeric,
  taken_at date,
  source text not null default 'manual',    -- manual | synap_csv | synap_api
  created_at timestamptz not null default now()
);

create index if not exists idx_student_scores_student_id on public.student_scores(student_id);
create index if not exists idx_student_scores_class_id on public.student_scores(class_id);

alter table public.student_scores enable row level security;

-- staff full CRUD (admin + manager)
drop policy if exists "staff all" on public.student_scores;
create policy "staff all" on public.student_scores
  for all to authenticated
  using (public.is_staff()) with check (public.is_staff());
-- parent: own kids' scores
drop policy if exists "parent own students scores" on public.student_scores;
create policy "parent own students scores" on public.student_scores
  for select to authenticated
  using (student_id in (select public.family_student_ids()));
-- instructor: scores of students enrolled in own classes
drop policy if exists "instructor roster scores" on public.student_scores;
create policy "instructor roster scores" on public.student_scores
  for select to authenticated
  using (student_id in (select public.instructor_student_ids()));
-- counselor: scores of students at own school (decided: counselors DO see scores)
drop policy if exists "counselor school scores" on public.student_scores;
create policy "counselor school scores" on public.student_scores
  for select to authenticated
  using (
    student_id in (
      select s.id from public.students s
      where s.school_id in (select public.counselor_school_ids())
    )
  );

-- -----------------------------------------------------------------------------
-- 2. instructors — per-instructor defaults (§5). Keyed by email to match the
--    classes.instructor_email linkage; no FK to auth (instructors may never
--    have logged in).
-- -----------------------------------------------------------------------------
create table if not exists public.instructors (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  name text,
  default_meeting_link text,
  created_at timestamptz not null default now()
);

alter table public.instructors enable row level security;

drop policy if exists "staff all" on public.instructors;
create policy "staff all" on public.instructors
  for all to authenticated
  using (public.is_staff()) with check (public.is_staff());
drop policy if exists "instructor self" on public.instructors;
create policy "instructor self" on public.instructors
  for select to authenticated
  using (lower(email) = public.jwt_email());

-- -----------------------------------------------------------------------------
-- 3. classroom_requests — one row per ask (§4b). Writes happen server-side
--    (cron creates/nudges, tokenized form answers, admin sets room →
--    auto-cancel); staff read/update it from the admin UI.
-- -----------------------------------------------------------------------------
create table if not exists public.classroom_requests (
  id uuid primary key default gen_random_uuid(),
  class_id uuid unique not null references public.classes(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'answered', 'cancelled')),
  requested_at timestamptz not null default now(),
  nudge_count int not null default 0,
  last_nudge_at timestamptz,
  answered_at timestamptz,
  answered_by text,                          -- counselor email that submitted
  answer text,                               -- free text, e.g. "Room C19 in the high school"
  created_at timestamptz not null default now()
);

alter table public.classroom_requests enable row level security;

drop policy if exists "staff all" on public.classroom_requests;
create policy "staff all" on public.classroom_requests
  for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- -----------------------------------------------------------------------------
-- 4. Counselor digest preferences (§4a). Self-serve via tokenized links —
--    no login, so writes go through the service role; no new policy needed.
-- -----------------------------------------------------------------------------
alter table public.school_counselors
  add column if not exists digest_frequency text not null default 'weekly'
  check (digest_frequency in ('weekly', 'biweekly', 'monthly', 'paused'));

alter table public.school_counselors
  add column if not exists digest_last_sent_at timestamptz;

-- PostgREST: pick up the new tables + columns
notify pgrst, 'reload schema';
