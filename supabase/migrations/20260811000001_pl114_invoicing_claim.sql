-- PL-114: close the double-charge window.
--
-- 'invoicing' = the atomic claim state between "confirmed" and the Stripe
-- call — exactly one caller wins the confirmed→invoicing transition; losers
-- no-op. issue_attempts feeds the Stripe idempotency key for hosted-invoice
-- creation (charge_attempts already plays that role for autopay PIs).
-- Idempotent: safe to re-run.

alter table public.tutoring_invoices
  drop constraint if exists tutoring_invoices_status_check;
alter table public.tutoring_invoices
  add constraint tutoring_invoices_status_check
  check (status in ('draft', 'proposed', 'confirmed', 'invoicing', 'invoiced', 'paid', 'past_due', 'void'));

alter table public.tutoring_invoices
  add column if not exists issue_attempts int not null default 0;
