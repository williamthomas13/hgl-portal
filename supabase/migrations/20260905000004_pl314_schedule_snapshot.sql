-- PL-314: schedule changes notify from REGISTRATION, not from class-details.
-- Families register seeing the session calendar — they paid for what they
-- saw. Each enrollment stamps that schedule here at registration time; the
-- sweep and the per-session edit route diff against it until an E4 exists
-- (then the E4 snapshot takes over, exactly as before).
-- Shape: { origin: 'registration', first_session, location,
--          sessions: [{session_date, start_time, end_time, location}], seq }
-- Existing enrollments keep NULL — their behavior stays E4-gated (we can't
-- know what they saw at registration).
-- Idempotent.

alter table enrollments add column if not exists schedule_snapshot jsonb;

notify pgrst, 'reload schema';
