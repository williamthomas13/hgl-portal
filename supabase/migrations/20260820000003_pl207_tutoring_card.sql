-- PL-207: the parent-portal 1-on-1 tutoring card becomes a state machine.
-- Three columns on enrollment_addons:
--   tutoring_timing          — the family's explicit start preference from
--                              the card ('immediate' | 'after_class'), shown
--                              to the Ops Director so intent is unambiguous.
--   tutoring_timing_set_at   — when they chose.
--   portal_kickoff_done_at   — the family completed the card flow in the
--                              portal (shared availability from the card or
--                              chose a timing) — suppresses the post-class
--                              tutoring-kickoff emails for this add-on
--                              (E8 scheduling + nudge); the NON-purchaser
--                              post-class offer (#8) is unaffected.
-- Idempotent.

alter table public.enrollment_addons
  add column if not exists tutoring_timing text;

do $$ begin
  alter table public.enrollment_addons
    add constraint enrollment_addons_tutoring_timing_check
    check (tutoring_timing in ('immediate', 'after_class'));
exception when duplicate_object then null; end $$;

alter table public.enrollment_addons
  add column if not exists tutoring_timing_set_at timestamptz;

alter table public.enrollment_addons
  add column if not exists portal_kickoff_done_at timestamptz;
