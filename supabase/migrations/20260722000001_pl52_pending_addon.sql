-- =============================================================================
-- HGL Portal — PL-52: resume-payment must not drop the selected add-on
-- =============================================================================
-- The add-on selection used to live ONLY in the abandoned Stripe session's
-- metadata, so a parent who picked a package, got interrupted, and paid from
-- a PR reminder link was silently charged class-only (found live July 17:
-- Reggie QAStudent, $899 instead of $1,499). The selection now persists on
-- the enrollment the moment checkout is built, and /api/resume-payment
-- rebuilds the same line items. pending_checkout_total is the guard baseline:
-- a rebuilt total that differs alerts the Ops Director instead of silently
-- charging a different amount.
--
-- IDEMPOTENT: safe to re-run.
-- =============================================================================

alter table public.enrollments
  add column if not exists pending_package_id uuid references public.tutoring_packages(id) on delete set null,
  add column if not exists pending_checkout_total numeric;

comment on column public.enrollments.pending_package_id is
  'PL-52: tutoring package selected at checkout, durable across abandoned '
  'Stripe sessions so resume-payment rebuilds the same cart. Cleared on paid.';
comment on column public.enrollments.pending_checkout_total is
  'PL-52: the total the parent originally built (class + add-on). '
  'Resume-payment alerts on mismatch instead of silently charging less.';

notify pgrst, 'reload schema';
