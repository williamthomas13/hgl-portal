-- =============================================================================
-- HGL Portal: Phase 4 — class cancellation flow (PHASE4_SPEC §12)
-- =============================================================================
-- classes.status: cancelling is an explicit admin action, never automatic.
-- A cancelled class suppresses every scheduled send (the sweep skips it) and
-- flips the public registration page to the no-waitlist "full" state.
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

alter table public.classes
  add column if not exists status text not null default 'open'
  check (status in ('open', 'cancelled'));

alter table public.enrollments
  add column if not exists class_cancelled boolean not null default false;

alter table public.enrollments
  add column if not exists cancellation_outcome text
  check (cancellation_outcome in ('refunded', 'converted', 'credited'));

-- PostgREST: pick up the new columns
notify pgrst, 'reload schema';
