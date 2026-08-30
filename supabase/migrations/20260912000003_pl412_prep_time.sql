-- PL-412B: per-session prep time — a real pay scale, finally visible in the
-- flow. Minutes recorded per session with who/when; feeds payable hours as
-- its own 'Prep Time' line. Deliberately NOT on calendars (it's connected to
-- the session, not scheduled time). 480-minute cap is a sanity bound, not
-- policy; the UI notes >15 min/session is uncommon (soft, never a blocker).
-- Idempotent.

alter table tutoring_sessions add column if not exists prep_minutes integer
  check (prep_minutes is null or (prep_minutes >= 0 and prep_minutes <= 480));
alter table tutoring_sessions add column if not exists prep_set_by text;
alter table tutoring_sessions add column if not exists prep_set_at timestamptz;

notify pgrst, 'reload schema';
