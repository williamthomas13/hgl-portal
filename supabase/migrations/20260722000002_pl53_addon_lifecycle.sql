-- =============================================================================
-- HGL Portal — PL-53: add-on hours lifecycle
-- =============================================================================
-- (b) family-shared availability rows carry source='parent' (the tokenized
--     availability page); (d) the class instructor's handoff note lands on
--     the student record — visible to the Ops Director during matching and
--     to the assigned tutor before the first session.
--
-- IDEMPOTENT: safe to re-run.
-- =============================================================================

alter table public.student_availability
  drop constraint if exists student_availability_source_check;
alter table public.student_availability
  add constraint student_availability_source_check
  check (source in ('intake', 'staff', 'parent'));

alter table public.students
  add column if not exists tutoring_handoff_note text,
  add column if not exists tutoring_handoff_by text,
  add column if not exists tutoring_handoff_at timestamptz;

comment on column public.students.tutoring_handoff_note is
  'PL-53d: the class instructor''s handoff for 1-on-1 continuation — what was '
  'covered, strengths, what to work on next. Written from the final-session '
  'attendance screen; read by the Ops Director when matching and by the '
  'assigned tutor before the first session.';

notify pgrst, 'reload schema';
