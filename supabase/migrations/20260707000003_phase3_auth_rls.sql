-- =============================================================================
-- HGL Portal: Phase 3 — Supabase Auth roles + real Row-Level Security
-- =============================================================================
-- Adds: profiles table (one row per auth user, role column), signup trigger,
-- security-definer helper functions, and RLS policies on every table.
--
-- Access model (SPEC v2.3 §2):
--   service_role  — all server code (API routes, webhooks, cron). Bypasses RLS.
--   admin         — full CRUD on everything (the /admin UI queries as this role).
--   instructor    — read own classes, sessions, rosters (Phase 4 views).
--   counselor     — read own school's classes/students/enrollments (Phase 4).
--   parent        — read own family, students, enrollments, add-ons (Phase 4).
--   anon          — NOTHING. Public pages now go through server API routes.
--
-- Role linkage is by email: profiles are matched to classes.instructor_email,
-- school_counselors.email, and families.parent_email via the JWT email claim.
-- Helpers are SECURITY DEFINER so policies never recurse through RLS.
--
-- MUST be applied only after the Phase 3 app code is deployed — the old build
-- talks to the DB with the anon key and dies the moment these policies land.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Profiles: one row per auth user, carries the role
-- -----------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique not null,
  full_name text,
  role text not null default 'parent'
    check (role in ('admin', 'instructor', 'counselor', 'parent')),
  created_at timestamptz not null default now()
);

-- Auto-create a profile on signup (default role: parent).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    lower(new.email),
    coalesce(new.raw_user_meta_data ->> 'full_name', null)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- -----------------------------------------------------------------------------
-- 2. Helper functions (SECURITY DEFINER: read across tables without RLS
--    recursion; STABLE: evaluated once per statement)
-- -----------------------------------------------------------------------------
create or replace function public.jwt_email()
returns text
language sql stable
as $$
  select lower(coalesce(auth.jwt() ->> 'email', ''))
$$;

create or replace function public.user_role()
returns text
language sql stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.is_admin()
returns boolean
language sql stable
security definer
set search_path = public
as $$
  select coalesce(
    (select role = 'admin' from public.profiles where id = auth.uid()),
    false
  )
$$;

-- Schools this counselor belongs to.
create or replace function public.counselor_school_ids()
returns setof uuid
language sql stable
security definer
set search_path = public
as $$
  select school_id from public.school_counselors
  where lower(email) = public.jwt_email()
$$;

-- Classes this instructor teaches.
create or replace function public.instructor_class_ids()
returns setof uuid
language sql stable
security definer
set search_path = public
as $$
  select id from public.classes
  where lower(instructor_email) = public.jwt_email()
$$;

-- Families billed to this parent's email.
create or replace function public.family_ids()
returns setof uuid
language sql stable
security definer
set search_path = public
as $$
  select id from public.families
  where lower(parent_email) = public.jwt_email()
$$;

-- Students in this parent's families.
create or replace function public.family_student_ids()
returns setof uuid
language sql stable
security definer
set search_path = public
as $$
  select s.id from public.students s
  join public.families f on f.id = s.family_id
  where lower(f.parent_email) = public.jwt_email()
$$;

-- Students enrolled in classes this instructor teaches.
create or replace function public.instructor_student_ids()
returns setof uuid
language sql stable
security definer
set search_path = public
as $$
  select e.student_id from public.enrollments e
  join public.classes c on c.id = e.class_id
  where lower(c.instructor_email) = public.jwt_email()
$$;

-- Can the current user see this class? (admin / its instructor / a counselor
-- at its school / a parent with a student enrolled in it)
create or replace function public.can_view_class(cid uuid)
returns boolean
language sql stable
security definer
set search_path = public
as $$
  select public.is_admin()
    or exists (
      select 1 from public.classes c
      where c.id = cid and lower(c.instructor_email) = public.jwt_email()
    )
    or exists (
      select 1 from public.classes c
      join public.school_counselors sc on sc.school_id = c.school_id
      where c.id = cid and lower(sc.email) = public.jwt_email()
    )
    or exists (
      select 1 from public.enrollments e
      join public.students s on s.id = e.student_id
      join public.families f on f.id = s.family_id
      where e.class_id = cid and lower(f.parent_email) = public.jwt_email()
    )
$$;

grant execute on function
  public.jwt_email(),
  public.user_role(),
  public.is_admin(),
  public.counselor_school_ids(),
  public.instructor_class_ids(),
  public.family_ids(),
  public.family_student_ids(),
  public.instructor_student_ids(),
  public.can_view_class(uuid)
to authenticated, anon;

-- -----------------------------------------------------------------------------
-- 3. Drop the Gemini-era allow-all policies
-- -----------------------------------------------------------------------------
drop policy if exists "Allow public insert" on public.classes;
drop policy if exists "Allow public read" on public.classes;
drop policy if exists "Allow public update" on public.classes;
drop policy if exists "Enable all for enrollments" on public.enrollments;
drop policy if exists "Enable all for families" on public.families;
drop policy if exists "Enable all for students" on public.students;

-- -----------------------------------------------------------------------------
-- 4. Enable RLS everywhere (no anon policies exist → anon sees nothing)
-- -----------------------------------------------------------------------------
alter table public.profiles          enable row level security;
alter table public.schools           enable row level security;
alter table public.school_counselors enable row level security;
alter table public.classes           enable row level security;
alter table public.sessions          enable row level security;
alter table public.families          enable row level security;
alter table public.students          enable row level security;
alter table public.enrollments       enable row level security;
alter table public.tutoring_packages enable row level security;
alter table public.enrollment_addons enable row level security;
alter table public.email_log         enable row level security;
alter table public.email_events      enable row level security;

-- -----------------------------------------------------------------------------
-- 5. Policies
-- -----------------------------------------------------------------------------

-- profiles: users read their own row; admins manage all rows
create policy "own profile" on public.profiles
  for select to authenticated
  using (id = auth.uid());
create policy "admin all" on public.profiles
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- schools: reference data readable by any signed-in role; admin manages
create policy "authenticated read" on public.schools
  for select to authenticated
  using (true);
create policy "admin all" on public.schools
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- school_counselors: counselors see their own row; admin manages
create policy "counselor self" on public.school_counselors
  for select to authenticated
  using (lower(email) = public.jwt_email());
create policy "admin all" on public.school_counselors
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- classes / sessions: visible per can_view_class; admin manages
create policy "role-scoped read" on public.classes
  for select to authenticated
  using (public.can_view_class(id));
create policy "admin all" on public.classes
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy "role-scoped read" on public.sessions
  for select to authenticated
  using (public.can_view_class(class_id));
create policy "admin all" on public.sessions
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- families: parents see their own family; admin manages
create policy "parent own family" on public.families
  for select to authenticated
  using (lower(parent_email) = public.jwt_email());
create policy "admin all" on public.families
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- students: parent sees own kids, counselor own school, instructor own rosters
create policy "parent own students" on public.students
  for select to authenticated
  using (family_id in (select public.family_ids()));
create policy "counselor school students" on public.students
  for select to authenticated
  using (school_id in (select public.counselor_school_ids()));
create policy "instructor roster students" on public.students
  for select to authenticated
  using (id in (select public.instructor_student_ids()));
create policy "admin all" on public.students
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- enrollments: parent own kids', instructor own classes', counselor own school's
create policy "parent own enrollments" on public.enrollments
  for select to authenticated
  using (student_id in (select public.family_student_ids()));
create policy "instructor class enrollments" on public.enrollments
  for select to authenticated
  using (class_id in (select public.instructor_class_ids()));
create policy "counselor school enrollments" on public.enrollments
  for select to authenticated
  using (
    class_id in (
      select c.id from public.classes c
      where c.school_id in (select public.counselor_school_ids())
    )
  );
create policy "admin all" on public.enrollments
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- tutoring_packages: price list, readable by any signed-in role; admin manages
create policy "authenticated read" on public.tutoring_packages
  for select to authenticated
  using (true);
create policy "admin all" on public.tutoring_packages
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- enrollment_addons: parents see add-ons on their own enrollments; admin manages
create policy "parent own addons" on public.enrollment_addons
  for select to authenticated
  using (
    enrollment_id in (
      select e.id from public.enrollments e
      where e.student_id in (select public.family_student_ids())
    )
  );
create policy "admin all" on public.enrollment_addons
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- email_log / email_events: internal plumbing, admin read only (server code
-- writes via service_role, which bypasses RLS)
create policy "admin read" on public.email_log
  for select to authenticated
  using (public.is_admin());
create policy "admin read" on public.email_events
  for select to authenticated
  using (public.is_admin());

-- PostgREST: pick up the new table + functions
notify pgrst, 'reload schema';
