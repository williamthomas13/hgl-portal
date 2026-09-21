-- PL-461: when staff replied to the family's change request (T1R sent, or a
-- no-email close). The family's proposal page shows "Updated {date} in reply
-- to your request" while no new request is open. Additive, idempotent.
alter table public.tutoring_invoices
  add column if not exists change_replied_at timestamptz;
