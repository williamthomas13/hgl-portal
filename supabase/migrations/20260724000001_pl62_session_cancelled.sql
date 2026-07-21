-- PL-62: family-driven proposal edits need an honest terminal status for a
-- proposed session the family drops (or vacates by moving) BEFORE anything
-- is confirmed. 'rescheduled' implies a replacement and feeds timecard
-- queries; deleting the row lets a cycle re-run resurrect the slot. So:
-- 'cancelled' — never billed, never paid, blocks re-materialization.
-- Idempotent: drops and re-adds the check constraint.

alter table public.tutoring_sessions
  drop constraint if exists tutoring_sessions_status_check;

alter table public.tutoring_sessions
  add constraint tutoring_sessions_status_check
  check (status in ('proposed', 'confirmed', 'completed', 'rescheduled', 'forfeited', 'no_show', 'cancelled'));
