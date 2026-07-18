-- =============================================================================
-- HGL Portal — PL-53d: assigned tutors can read their 1-on-1 students
-- =============================================================================
-- instructor_student_ids() only covered class rosters, so a tutor whose
-- 1-on-1 student never took their class couldn't read the student row (their
-- session list's student join came back empty) — and couldn't see the
-- handoff note written for them. Extend the helper to include students the
-- caller actively tutors; every policy built on it inherits the fix.
--
-- IDEMPOTENT: safe to re-run.
-- =============================================================================

create or replace function public.instructor_student_ids()
returns setof uuid
language sql stable
security definer
set search_path = public
as $$
  select e.student_id from public.enrollments e
  where e.class_id in (select public.instructor_class_ids())
  union
  select te.student_id from public.tutoring_engagements te
  join public.instructors i on i.id = te.tutor_id
  where lower(i.email) = public.jwt_email()
$$;

notify pgrst, 'reload schema';
