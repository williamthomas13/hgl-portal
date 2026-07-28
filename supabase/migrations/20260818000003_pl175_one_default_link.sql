-- PL-175: instructors and tutors are the SAME people and were already one
-- table — but the "default Zoom link" concept lived in TWO columns:
-- default_location (written by the 1-on-1 Tutors panel; every real link is
-- here) and default_meeting_link (written by the Instructors panel; empty).
-- Unify with a migration rather than syncing (synced duplicates drift):
-- default_meeting_link becomes the ONE column. Idempotent.
update public.instructors
  set default_meeting_link = coalesce(default_meeting_link, default_location)
  where default_location is not null;

-- default_location on instructors is now DEPRECATED (no reader after the
-- accompanying deploy). Dropped by 20260818000004 once the deploy settles —
-- dropping in the same migration would 500 the still-running old build.
