-- PL-298: a failed QuickBooks sync row can be DISMISSED with a reason —
-- some failures are correct outcomes (the armed $0-invoice fixture's "no
-- positive lines" is the canonical case: nothing to post, nothing to fix).
-- Dismissed rows keep their history in the log but stop nagging the
-- dashboard. Reinstating flips them back to failed. Idempotent.

alter table public.qbo_sync_log drop constraint if exists qbo_sync_log_status_check;
alter table public.qbo_sync_log add constraint qbo_sync_log_status_check
  check (status in ('pending', 'synced', 'failed', 'dismissed'));

alter table public.qbo_sync_log add column if not exists dismissed_reason text;
alter table public.qbo_sync_log add column if not exists dismissed_by text;
alter table public.qbo_sync_log add column if not exists dismissed_at timestamptz;
comment on column public.qbo_sync_log.dismissed_reason is
  'PL-298: why a failed row was dismissed (plain English, shown in the sync log).';

notify pgrst, 'reload schema';
