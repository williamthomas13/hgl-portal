-- PL-74: the Ops Director can restart the automatic agreement chase from
-- /admin/agreements. Rounds are tracked so the escalation alert can say
-- plainly when another email round wasn't the answer ("Second automatic
-- chase completed — this one really does need a call"). No hard cap — her
-- judgment wins — but the alert stops pretending. Idempotent.

alter table public.families
  add column if not exists agreement_chase_round integer not null default 0;
alter table public.families
  add column if not exists agreement_chase_restarted_at timestamptz;
