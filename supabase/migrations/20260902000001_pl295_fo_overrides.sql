-- PL-295C: per-feeder-cohort FO overrides — capability only, nothing seeded
-- (the batch-30 school scenario is hypothetical). All three live on the
-- FEEDER class:
--   fo_exclude       — this cohort never enters the follow-on campaign
--                      (e.g. a class running concurrently with the FO class,
--                      earmarked for a later campaign instead).
--   fo_announce_date — manual announce date; may be BEFORE the feeder's last
--                      session (early start while the class is in session).
--   fo_discount_end  — manual discount-end date (always clamped to the
--                      follow-on class's stated registration deadline — a
--                      discount outliving registration is meaningless).
-- Idempotent.

alter table public.classes add column if not exists fo_exclude boolean not null default false;
comment on column public.classes.fo_exclude is
  'PL-295: exclude this FEEDER cohort from its follow-on campaign entirely. Default off.';

alter table public.classes add column if not exists fo_announce_date date;
comment on column public.classes.fo_announce_date is
  'PL-295: manual FO announce date for this feeder cohort (may predate the last session — early start). Null = last session + the standard offset.';

alter table public.classes add column if not exists fo_discount_end date;
comment on column public.classes.fo_discount_end is
  'PL-295: manual FO discount-end for this feeder cohort. Null = announce + the standard window. Always clamped to the follow-on class''s registration deadline.';

notify pgrst, 'reload schema';
