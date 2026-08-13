-- PL-334: unpaid (issued, non-autopay) invoices move from ONE 10-day
-- reminder (the reminder_sent_at latch) to a repeating settings-driven
-- cadence on the daily sweep. The cycle clock anchors on due_at until staff
-- restart it — reminder_cycle_started_at is the re-stamp (same pattern as
-- the engagement-approval nudge restart: a new anchor mints new dedupe keys
-- so the cadence re-arms cleanly). Reminders stop the moment the invoice is
-- paid/void and cap at the 30-day late-fee point (from there it's a staff
-- decision — never perpetuity). reminder_sent_at stays as "when the last
-- automatic reminder went out". Idempotent.

alter table public.tutoring_invoices
  add column if not exists reminder_cycle_started_at timestamptz;

insert into public.app_settings (key, value)
values ('tutoring_payment_reminder_days', '7')
on conflict (key) do nothing;

notify pgrst, 'reload schema';
