-- PL-128: the refund request is a tracked STATE, not an email to lose.
-- Stamp on the enrollment; 'refund_requested' joins the outcome domain so
-- the record reads honestly between "asked" and "issued" (staff still flip
-- to Refunded manually after the Stripe-dashboard refund — Option A, the
-- portal moves no money). Idempotent: safe to re-run.

alter table public.enrollments
  add column if not exists refund_requested_at timestamptz;

alter table public.enrollments
  drop constraint if exists enrollments_cancellation_outcome_check;
alter table public.enrollments
  add constraint enrollments_cancellation_outcome_check
  check (cancellation_outcome in ('refunded', 'converted', 'credited', 'refund_requested'));
