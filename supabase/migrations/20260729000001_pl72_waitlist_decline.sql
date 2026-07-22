-- PL-72: a family can decline an offered waitlist spot early so it cascades
-- to the next family before the 48h deadline lapses. The stamp distinguishes
-- "declined" from "expired unclaimed" in the admin panel; the enrollment
-- still moves to Expired (same downstream behavior as a lapse). Idempotent.

alter table public.enrollments
  add column if not exists waitlist_declined_at timestamptz;
