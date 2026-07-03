-- =============================================================================
-- HGL Portal: Foundation schema migration
-- =============================================================================
-- Adds: schools, school_counselors, sessions tables.
-- Alters: students, classes, enrollments to add missing fields.
-- Backfills: schools rows from existing classes.school_nickname values.
--
-- Safe to run on an existing database. All ALTERs are `if not exists`
-- and the schools backfill uses `on conflict do nothing`.
--
-- Row-Level Security is intentionally NOT enabled here. Auth is a later phase.
-- Keep the Supabase anon key out of any public context until then.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Schools and counselors
-- -----------------------------------------------------------------------------
create table if not exists public.schools (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  nickname text unique not null,
  contact_email text,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.school_counselors (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  first_name text not null,
  last_name text not null,
  email text unique not null,
  phone text,
  created_at timestamptz not null default now()
);

create index if not exists idx_school_counselors_school_id
  on public.school_counselors(school_id);

-- -----------------------------------------------------------------------------
-- 2. Students: email, school link, grade level
-- -----------------------------------------------------------------------------
alter table public.students
  add column if not exists student_email text;

alter table public.students
  add column if not exists school_id uuid
  references public.schools(id) on delete set null;

alter table public.students
  add column if not exists grade_level text;

create index if not exists idx_students_school_id
  on public.students(school_id);

-- -----------------------------------------------------------------------------
-- 3. Classes: real school FK, instructor email, location, Synap group
-- -----------------------------------------------------------------------------
alter table public.classes
  add column if not exists school_id uuid
  references public.schools(id) on delete set null;

alter table public.classes
  add column if not exists instructor_email text;

alter table public.classes
  add column if not exists default_location text;

alter table public.classes
  add column if not exists synap_group text;

create index if not exists idx_classes_school_id
  on public.classes(school_id);

-- Backfill schools from existing class.school_nickname values
-- (one school row per distinct nickname; safe to re-run)
insert into public.schools (name, nickname)
select distinct school_nickname, school_nickname
  from public.classes
 where school_nickname is not null
on conflict (nickname) do nothing;

-- Link existing classes to their newly-created school rows
update public.classes c
   set school_id = s.id
  from public.schools s
 where c.school_nickname = s.nickname
   and c.school_id is null;

-- -----------------------------------------------------------------------------
-- 4. Sessions (the class meeting calendar)
-- -----------------------------------------------------------------------------
create table if not exists public.sessions (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete cascade,
  session_date date not null,
  start_time time,
  end_time time,
  location text,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists idx_sessions_class_id
  on public.sessions(class_id);

create index if not exists idx_sessions_date
  on public.sessions(session_date);

-- -----------------------------------------------------------------------------
-- 5. Enrollments: proper Stripe session tracking for reliable webhook matching
-- -----------------------------------------------------------------------------
alter table public.enrollments
  add column if not exists stripe_session_id text unique;

alter table public.enrollments
  add column if not exists stripe_payment_intent_id text;

alter table public.enrollments
  add column if not exists paid_at timestamptz;

create index if not exists idx_enrollments_stripe_session
  on public.enrollments(stripe_session_id);

create index if not exists idx_enrollments_student_id
  on public.enrollments(student_id);

create index if not exists idx_enrollments_class_id
  on public.enrollments(class_id);
