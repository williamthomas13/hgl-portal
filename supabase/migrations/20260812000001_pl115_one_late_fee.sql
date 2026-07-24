-- PL-115: at most ONE late-payment-fee line per invoice, enforced by the
-- database — the API's existing-line check closes the UI path, this closes
-- the concurrent race (two requests can both pass a read-then-insert check).
-- Idempotent: safe to re-run.

create unique index if not exists tutoring_invoice_lines_one_late_fee
  on public.tutoring_invoice_lines (invoice_id)
  where kind = 'late_payment_fee';
