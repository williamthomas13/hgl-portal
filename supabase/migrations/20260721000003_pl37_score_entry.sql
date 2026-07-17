-- =============================================================================
-- HGL Portal — PL-37: manual milestone score entry on the roster
-- =============================================================================
-- The Synap CSV importer is dead (decision July 19: Synap's own reporting
-- covers the detail); staff/instructors hand-enter the few headline numbers
-- instead. student_scores already exists — this adds the recorded_by stamp
-- and lets instructors WRITE scores for their own roster (they could already
-- read them).
--
-- IDEMPOTENT: safe to re-run.
-- =============================================================================

alter table public.student_scores
  add column if not exists recorded_by text;

comment on column public.student_scores.recorded_by is
  'PL-37: email of the staff member/instructor who hand-entered the score.';

drop policy if exists "instructor record roster scores" on public.student_scores;
create policy "instructor record roster scores" on public.student_scores
  for insert to authenticated
  with check (student_id in (select public.instructor_student_ids()));

drop policy if exists "instructor edit roster scores" on public.student_scores;
create policy "instructor edit roster scores" on public.student_scores
  for update to authenticated
  using (student_id in (select public.instructor_student_ids()))
  with check (student_id in (select public.instructor_student_ids()));

drop policy if exists "instructor delete roster scores" on public.student_scores;
create policy "instructor delete roster scores" on public.student_scores
  for delete to authenticated
  using (student_id in (select public.instructor_student_ids()));

notify pgrst, 'reload schema';
