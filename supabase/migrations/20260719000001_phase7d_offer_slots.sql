-- =============================================================================
-- HGL Portal — Phase 7d addendum: pick-from-offered-slots parent reschedule
-- (docs/PHASE7_SPEC.md v1.4 §8, added July 15, 2026)
-- =============================================================================
-- For the ≥24h case the portal now OFFERS the parent 2–3 candidate replacement
-- slots instead of "request and wait". Candidates come from the tutor's Google
-- freebusy intersected with Ops-Director-approved OFFER WINDOWS — a per-tutor
-- weekly mask edited in the tutors panel. The tutor's calendar itself is never
-- exposed; the parent only ever sees the pre-approved options (no-self-booking
-- principle). Existing RLS on instructors/tutoring_sessions already covers
-- both columns (staff all / instructor self / family reads via service role).
--
-- IDEMPOTENT: safe to re-run.
-- =============================================================================

alter table public.instructors
  add column if not exists offer_windows jsonb not null default '[]'::jsonb;

comment on column public.instructors.offer_windows is
  'Phase 7d §8: Ops-Director-approved weekly windows the portal may offer '
  'parents for self-serve reschedules. Array of {weekday 1=Mon…7=Sun, '
  'start_time "HH:MM", end_time "HH:MM"} on the tutor''s local wall clock '
  '(instructors.timezone). Empty array = unset — the portal falls back to the '
  'tutor''s existing recurring-session hours ±2h.';

alter table public.tutoring_sessions
  add column if not exists parent_rescheduled_at timestamptz;

comment on column public.tutoring_sessions.parent_rescheduled_at is
  'Phase 7d §8: set on the ORIGINAL session when the family completed the '
  'reschedule themselves by tapping an offered slot in the portal. Feeds the '
  'Ops Director recent-activity list on /admin/tutoring ("nothing happens '
  'invisibly"); staff-executed reschedules leave this null.';

-- PostgREST: pick up the new columns
notify pgrst, 'reload schema';
