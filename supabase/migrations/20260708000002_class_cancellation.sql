-- =============================================================================
-- HGL Portal: Phase 4 — class cancellation flow (PHASE4_SPEC §12)
-- =============================================================================
-- REWRITTEN July 7 before first application: classes.status ALREADY EXISTS
-- (Gemini-era column, live rows carry 'Enrolling'), so the original
-- add-column-with-check version would have skipped the column and never
-- established the open/cancelled semantics. Nothing in the app ever read the
-- legacy values, so this normalizes them: 'cancelled' is the only special
-- value, everything else becomes 'open'.
--
-- enrollments.class_cancelled: Paid enrollments keep their status when the
-- class is cancelled (refunds stay manual in Stripe) but carry this flag.
-- enrollments.cancellation_outcome: how the family chose to resolve it —
-- bookkeeping recorded by the admin after the email conversation, not a
-- Stripe automation.
--
-- No RLS changes: staff already have UPDATE on classes/enrollments; the
-- cancellation itself runs server-side (staff-authenticated API route using
-- the service role) so status + expiries + emails move together.
-- =============================================================================

-- 1. Normalize the legacy status column to the Phase 4 semantics.
update public.classes set status = 'open'
 where status is distinct from 'cancelled';

alter table public.classes alter column status set default 'open';
alter table public.classes alter column status set not null;

-- Replace any prior constraint on status, then pin the two-value semantics.
alter table public.classes drop constraint if exists classes_status_check;
alter table public.classes add constraint classes_status_check
  check (status in ('open', 'cancelled'));

-- 2. Cancellation bookkeeping on enrollments.
alter table public.enrollments
  add column if not exists class_cancelled boolean not null default false;

alter table public.enrollments
  add column if not exists cancellation_outcome text
  check (cancellation_outcome in ('refunded', 'converted', 'credited'));

-- PostgREST: pick up the new columns
notify pgrst, 'reload schema';
