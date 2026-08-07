-- PL-281: approved hourly timecards post to QuickBooks as TimeActivity rows
-- on the existing sync rails. Three seams:
--   1. instructors.qbo_employee_id — the match-only Employee mapping (set in
--      the QBO panel against QBO's own Employee list; NEVER auto-created).
--   2. qbo_sync_log grows a third source (timecard_id): the payment-intent
--      column relaxes, the kind check gains 'timecard_time', the XOR becomes
--      three-way, and idempotency comes from a partial unique index on
--      timecard_id (one push per card, ever — a reopened card that was
--      already pushed is a human conversation, not a second row).
-- Idempotent.

alter table public.instructors add column if not exists qbo_employee_id text;
comment on column public.instructors.qbo_employee_id is
  'PL-281: QBO Employee id this tutor matches (match-only against the QBO Employee list; never auto-created). Null = unmatched — timecard pushes refuse loudly.';

alter table public.qbo_sync_log
  add column if not exists timecard_id uuid references public.timecards(id) on delete cascade;

alter table public.qbo_sync_log alter column stripe_payment_intent_id drop not null;

alter table public.qbo_sync_log drop constraint if exists qbo_sync_log_kind_check;
alter table public.qbo_sync_log add constraint qbo_sync_log_kind_check
  check (kind in ('sale', 'refund', 'tutoring_sale', 'timecard_time'));

alter table public.qbo_sync_log drop constraint if exists qbo_sync_log_source_check;
alter table public.qbo_sync_log add constraint qbo_sync_log_source_check
  check (
    (enrollment_id is not null and tutoring_invoice_id is null and timecard_id is null)
    or (enrollment_id is null and tutoring_invoice_id is not null and timecard_id is null)
    or (enrollment_id is null and tutoring_invoice_id is null and timecard_id is not null)
  );

-- Payment rows keep their (payment_intent, kind) idempotency backbone; a
-- timecard row's backbone is the card itself.
create unique index if not exists qbo_sync_log_timecard
  on public.qbo_sync_log (timecard_id) where timecard_id is not null;

-- Payment rows must still carry their intent (the old NOT NULL, scoped).
alter table public.qbo_sync_log drop constraint if exists qbo_sync_log_pi_required_check;
alter table public.qbo_sync_log add constraint qbo_sync_log_pi_required_check
  check (timecard_id is not null or stripe_payment_intent_id is not null);

notify pgrst, 'reload schema';
