-- PL-437: the drift doorbell's once-only memory becomes DURABLE. The PL-402
-- alerted_signature lived on the calendar_drift row itself — but every
-- resolution path (adopt, revert, the audit's own delete-then-upsert refresh)
-- deletes that row, so a re-detection moments later rang a SECOND alert with
-- no memory of the first (the Aug 31 pair, 21:30:01 + 21:31:51 UTC). The
-- ledger survives row churn: a (session, signature) pair that rang within
-- the last 24h stays silent; a genuinely new drift shape — or the same shape
-- a day later — still rings. Append/upsert only; the drift rows' own
-- alerted_* columns are retired from reads (left in place, harmless).
-- Idempotent.
create table if not exists public.calendar_drift_alert_ledger (
  session_id uuid not null,
  signature text not null,
  alerted_at timestamptz not null default now(),
  primary key (session_id, signature)
);

create index if not exists calendar_drift_alert_ledger_at_idx
  on public.calendar_drift_alert_ledger (alerted_at desc);

alter table public.calendar_drift_alert_ledger enable row level security;

notify pgrst, 'reload schema';
