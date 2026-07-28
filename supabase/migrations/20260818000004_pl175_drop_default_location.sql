-- PL-175 step 2: drop the deprecated duplicate AFTER the deploy that
-- repointed every reader to default_meeting_link is live. Idempotent.
alter table public.instructors drop column if exists default_location;
