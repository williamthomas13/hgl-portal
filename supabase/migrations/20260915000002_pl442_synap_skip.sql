-- PL-442B: the Synap-group deliberate-skip stamp — the collateral pattern
-- (PL-237/429) for the diagnostics-on-but-no-group hole. The wizard requires
-- a Synap group whenever Has diagnostics is ON; the escape is an explicit
-- "no Synap group yet" checkbox, recorded here (who/when). While stamped AND
-- the group is still blank AND diagnostics are on, a state-driven Needs
-- Attention row shows, and one urgency-keyed email nudges the class creator
-- when the first synap-consuming email (#2, first session −10d) approaches.
-- Filling the group clears the stamp (self-clearing everywhere). IDEMPOTENT.

alter table public.classes add column if not exists synap_reminder_at timestamptz;
alter table public.classes add column if not exists synap_reminder_by text;

comment on column public.classes.synap_reminder_at is
  'PL-442: when the Synap group was deliberately skipped at creation (diagnostics ON, no group) — drives the state-driven reminder; cleared when the group is filled or diagnostics turn off.';
comment on column public.classes.synap_reminder_by is
  'PL-442: staff email (lowercase) of whoever checked the deliberate-skip box.';

notify pgrst, 'reload schema';
