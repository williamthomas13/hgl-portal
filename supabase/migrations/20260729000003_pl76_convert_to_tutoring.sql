-- PL-76: one-click "Convert to 1-on-1 tutoring" on a cancelled enrollment.
-- The paid amount becomes a Stripe customer credit balance (invoices consume
-- it automatically); these columns are the idempotency guard and the visible
-- record Kelsie can reconcile against if the family changes course.

alter table public.enrollments
  add column if not exists converted_to_tutoring_at timestamptz;
alter table public.enrollments
  add column if not exists tutoring_credit_amount numeric;
alter table public.enrollments
  add column if not exists stripe_credit_txn_id text;
