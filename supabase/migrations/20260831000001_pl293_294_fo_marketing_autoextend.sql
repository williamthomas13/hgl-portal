-- PL-293 + PL-294: two follow-on campaign fields on classes.
--   marketing_url  — the class's Squarespace marketing page (per-class,
--                    never hard-coded; e.g. https://hgl.co/advanced-sat).
--                    Composes the FO emails' "More info" link and the
--                    register page's class-page pointer; blank drops both.
--   fo_auto_extend — on the FOLLOW-ON (open) class: when a feeder cohort's
--                    discount deadline passes while THIS class is still
--                    under its minimum, the sweep extends that cohort a week
--                    and sends the extension pair. Default OFF — the
--                    deliberate admin Extend action stays the recommended
--                    path.
-- Idempotent.

alter table public.classes add column if not exists marketing_url text;
comment on column public.classes.marketing_url is
  'PL-293: the class''s marketing page (Squarespace). Blank = no More-info link anywhere.';

alter table public.classes add column if not exists fo_auto_extend boolean not null default false;
comment on column public.classes.fo_auto_extend is
  'PL-294: open classes only — auto-extend a feeder cohort''s follow-on discount when its deadline passes while this class is under minimum. Default off.';

notify pgrst, 'reload schema';
