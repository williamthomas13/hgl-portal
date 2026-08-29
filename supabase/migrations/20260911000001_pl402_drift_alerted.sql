-- PL-402: drift alerts ring ONCE per drift, grouped per pass. The email is
-- the doorbell; the Needs Attention row + banner (PL-393) are the persistent
-- reminder. alerted_signature records WHAT was alerted ('deleted' or the
-- calendar start instant) so a drift re-alerts only when its calendar state
-- changes AGAIN after the last alert. The audit's refresh upserts never write
-- these columns, so they survive re-detection. Idempotent.

alter table calendar_drift add column if not exists alerted_at timestamptz;
alter table calendar_drift add column if not exists alerted_signature text;

notify pgrst, 'reload schema';
