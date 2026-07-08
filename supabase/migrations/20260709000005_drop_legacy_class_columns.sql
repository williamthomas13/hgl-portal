-- =============================================================================
-- HGL Portal: drop legacy class columns (Phase 5 prerequisite, spec §7)
-- =============================================================================
-- classes.school_nickname / instructor_name / instructor_email were kept
-- through the July 7 addendum as write-through copies while reads migrated to
-- the canonical paths (schools via school_id, instructors via instructor_id).
-- Every read is now switched (app sweep in the same commit), so the columns
-- go — before the Phase 5 copy-a-class feature exists, so a copy can never
-- propagate deprecated fields.
--
-- Prerequisite inside this file: instructor_class_ids() still matched the
-- legacy email column; it becomes FK-only FIRST. instructor_student_ids()
-- and can_view_class() already delegate to it (20260709000002), and no other
-- policy or function touches the dropped columns.
--
-- DATA NOTE (checked in prod before writing this): exactly one class —
-- asf-sat-prep-spring26, already completed — carries a free-text
-- instructor_name ('Eric') with no email, so it could never be backfilled
-- into instructors (email is the natural key) and its display name is lost
-- by this drop. The class shows "Not yet assigned" in admin afterwards;
-- reassign from the dropdown if it matters. Every other class was linked by
-- the 20260709000002 backfill.
--
-- IDEMPOTENT: create-or-replace + drop-if-exists throughout.
-- =============================================================================

-- 1. Instructor RLS goes FK-only (was: legacy email column OR the FK)
create or replace function public.instructor_class_ids()
returns setof uuid
language sql stable
security definer
set search_path = public
as $$
  select c.id from public.classes c
  join public.instructors i on i.id = c.instructor_id
  where lower(i.email) = public.jwt_email()
$$;

-- 2. Drop the legacy columns (dependent indexes drop automatically)
alter table public.classes drop column if exists school_nickname;
alter table public.classes drop column if exists instructor_name;
alter table public.classes drop column if exists instructor_email;

-- PostgREST: pick up the shrunken row shape + redefined function
notify pgrst, 'reload schema';
