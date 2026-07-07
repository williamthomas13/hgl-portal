-- =============================================================================
-- HGL Portal: instructors become an entity (admin UX addendum, step 3)
-- =============================================================================
-- The instructors table itself shipped in 20260708000001 (email, name,
-- default_meeting_link — PHASE4_SPEC §5). This migration makes it the source
-- of truth for WHO teaches a class:
--   * classes.instructor_id FK → instructors (on delete set null)
--   * backfill instructors rows from the legacy classes.instructor_name /
--     instructor_email text values, then link classes by email match
--   * instructor RLS matches through EITHER the legacy email column or the
--     FK, so auth stays correct while reads migrate
--
-- classes.instructor_name / instructor_email are KEPT and still written on
-- class creation (copied from the chosen instructors row) until every read is
-- switched — same transition pattern as classes.school_nickname. Dropping
-- them is a pre-launch cleanup runbook item.
--
-- Classes with a name but NO email can't be matched to an instructors row
-- (email is the natural key); they keep instructor_id null and render from
-- the legacy name column.
--
-- IDEMPOTENT: guarded creates, on-conflict/skip-existing backfills,
-- create-or-replace functions.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Backfill instructors from the legacy text columns
-- -----------------------------------------------------------------------------
insert into public.instructors (email, name)
select lower(trim(c.instructor_email)), max(c.instructor_name)
  from public.classes c
 where c.instructor_email is not null and trim(c.instructor_email) <> ''
 group by lower(trim(c.instructor_email))
on conflict (email) do nothing;

-- Fill in names on pre-existing instructors rows that never got one.
update public.instructors i
   set name = sub.name
  from (
    select lower(trim(instructor_email)) as email, max(instructor_name) as name
      from public.classes
     where instructor_email is not null and trim(instructor_email) <> ''
     group by lower(trim(instructor_email))
  ) sub
 where lower(i.email) = sub.email
   and (i.name is null or i.name = '');

-- -----------------------------------------------------------------------------
-- 2. classes.instructor_id FK + backfill by email match
-- -----------------------------------------------------------------------------
alter table public.classes
  add column if not exists instructor_id uuid
  references public.instructors(id) on delete set null;

create index if not exists idx_classes_instructor_id
  on public.classes(instructor_id);

update public.classes c
   set instructor_id = i.id
  from public.instructors i
 where c.instructor_id is null
   and c.instructor_email is not null
   and lower(trim(c.instructor_email)) = lower(i.email);

-- -----------------------------------------------------------------------------
-- 3. Instructor RLS: match legacy email column OR the FK (transition-safe —
--    editing an instructor's email on the instructors row must not strand
--    their access to classes linked by id)
-- -----------------------------------------------------------------------------
create or replace function public.instructor_class_ids()
returns setof uuid
language sql stable
security definer
set search_path = public
as $$
  select id from public.classes
  where lower(instructor_email) = public.jwt_email()
  union
  select c.id from public.classes c
  join public.instructors i on i.id = c.instructor_id
  where lower(i.email) = public.jwt_email()
$$;

create or replace function public.instructor_student_ids()
returns setof uuid
language sql stable
security definer
set search_path = public
as $$
  select e.student_id from public.enrollments e
  where e.class_id in (select public.instructor_class_ids())
$$;

create or replace function public.can_view_class(cid uuid)
returns boolean
language sql stable
security definer
set search_path = public
as $$
  select public.is_admin()
    or cid in (select public.instructor_class_ids())
    or exists (
      select 1 from public.classes c
      where c.id = cid and c.school_id in (select public.counselor_school_ids())
    )
    or exists (
      select 1 from public.enrollments e
      join public.students s on s.id = e.student_id
      join public.families f on f.id = s.family_id
      where e.class_id = cid and lower(f.parent_email) = public.jwt_email()
    )
$$;

comment on column public.classes.instructor_name is
  'DEPRECATED (July 2026): kept in sync from instructors via instructor_id at '
  'write time until reads are switched; drop in the pre-launch cleanup runbook.';
comment on column public.classes.instructor_email is
  'DEPRECATED (July 2026): kept in sync from instructors via instructor_id at '
  'write time until reads are switched; drop in the pre-launch cleanup runbook.';

-- PostgREST: pick up the new column + redefined functions
notify pgrst, 'reload schema';
