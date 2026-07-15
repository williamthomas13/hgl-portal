-- =============================================================================
-- HGL Portal — Phase 7d: parent tutoring surface (docs/PHASE7_SPEC.md §8)
-- =============================================================================
-- The parent view reads everything through existing 7a RLS policies (own
-- family's engagements/sessions/invoices) plus scoped service-role joins;
-- the only new state is the reschedule REQUEST flag — the parent asks, the
-- Ops Director executes (portal actions and phone calls write the same
-- records). ≥24h requests are free per the signed policy; <24h shows the
-- $40/hour terms and routes to the Ops Director either way.
--
-- IDEMPOTENT: safe to re-run.
-- =============================================================================

alter table public.tutoring_sessions
  add column if not exists reschedule_requested_at timestamptz;
alter table public.tutoring_sessions
  add column if not exists reschedule_request_note text;

comment on column public.tutoring_sessions.reschedule_requested_at is
  'Phase 7d: parent asked to move this session (portal). Cleared when the '
  'session is rescheduled/cancelled; shown to staff in the schedule dialog.';

-- PostgREST: pick up the new columns
notify pgrst, 'reload schema';
