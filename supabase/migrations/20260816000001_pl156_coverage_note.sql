-- PL-156: when a substitute accepts, the requesting tutor's outcome email
-- gains a "Send {subFirstName} a note" button. The note is emailed to the
-- substitute AND kept here, so it rides the coverage handoff bundle the sub
-- already receives (PL-112) instead of living only in one inbox — context
-- said once should sit with the handoff it belongs to.
--
-- Declined/withdrawn requests never get a note (nothing to hand off), so
-- these columns stay null for them. Idempotent.

alter table public.coverage_requests
  add column if not exists handoff_note text,
  add column if not exists handoff_note_at timestamptz;

comment on column public.coverage_requests.handoff_note is
  'PL-156: the requesting tutor''s hand-over note to the substitute (accepted requests only).';
comment on column public.coverage_requests.handoff_note_at is
  'PL-156: when the note was sent; also the once-only guard on the tokenized form.';
