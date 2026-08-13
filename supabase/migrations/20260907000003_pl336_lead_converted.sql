-- PL-336: leads get a WON ending. New terminal status `converted` (label
-- "Enrolled") for the consulted-then-enrolled-in-a-group-class path (the
-- Bunji case) — terminal + positive: out of the active pipeline like `lost`,
-- rendered as a win. The sweep auto-flips it when the linked student gains a
-- Paid class enrollment (and auto-flips `scheduled` when they gain an active
-- 1-on-1 engagement); a lead already marked `lost` that enrolls anyway flips
-- to `converted` too — the record should tell the truth. Idempotent.

alter table public.leads drop constraint if exists leads_status_check;
alter table public.leads add constraint leads_status_check check (
  status in (
    'new', 'contacted', 'intake_sent', 'intake_complete', 'consult_scheduled',
    'consult_done', 'proposal_sent', 'scheduled', 'lost', 'converted'
  )
);

alter table public.leads
  add column if not exists converted_at timestamptz,
  add column if not exists converted_class_id uuid references public.classes(id) on delete set null,
  -- Denormalized chip text ("PSAT Prep, Aug 12") — written at flip time so
  -- the pipeline list renders without a class join.
  add column if not exists converted_label text;

notify pgrst, 'reload schema';
