-- =============================================================================
-- HGL Portal: registration close date
-- =============================================================================
-- Public registration (and new waitlist offers) close after the class's
-- first session by default. registration_close_date overrides per class:
-- set it to e.g. the third session's date to allow joining after missing a
-- session or two. NULL = default (first session).
-- =============================================================================

alter table public.classes
  add column if not exists registration_close_date date;
