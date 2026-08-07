-- PL-279: the FO follow-on campaign (PL-274 amendment D mechanics).
--   fo_short_name    — on the FOLLOW-ON (open) class: the short marketing
--                      name Scarlett's copy italicizes ("Deep Dive");
--                      null falls back to the full class name.
--   fo_extended_until — on the FEEDER class: this cohort's extended discount
--                      deadline (the stage-3 "Bad News, Great News" trigger;
--                      set by the admin Extend action, never automatic).
--                      Null = never extended; the base window applies.
-- Idempotent.

alter table public.classes add column if not exists fo_short_name text;
comment on column public.classes.fo_short_name is
  'PL-279: short marketing name for a follow-on class ("Deep Dive"). Null = full class name.';

alter table public.classes add column if not exists fo_extended_until date;
comment on column public.classes.fo_extended_until is
  'PL-279: this FEEDER cohort''s extended follow-on discount deadline. Null = not extended (base window = last session + 14 days).';

notify pgrst, 'reload schema';
