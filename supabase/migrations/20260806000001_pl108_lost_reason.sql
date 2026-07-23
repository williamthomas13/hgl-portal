-- PL-108: closing a lead ("Closed — not now", the PL-109 rename) captures a
-- reason — a quick-pick cause plus optional free text (required when the
-- cause is 'other'). Idempotent.

alter table public.leads
  add column if not exists lost_reason_kind text;

alter table public.leads
  drop constraint if exists leads_lost_reason_kind_check;
alter table public.leads
  add constraint leads_lost_reason_kind_check
  check (lost_reason_kind is null or lost_reason_kind in ('price', 'timing', 'went_elsewhere', 'no_response', 'other'));

alter table public.leads
  add column if not exists lost_reason text;

notify pgrst, 'reload schema';
