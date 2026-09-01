-- PL-439: record who created each class — the collateral nudge (and the
-- PL-442 synap reminder) email the CREATOR, not the general admin audience.
-- Staff email (lowercase), same shape as class_drafts.created_by; the wizard
-- stamps it at completion (a resumed draft's stamp carries through). NULL =
-- creator unknown (imports, legacy, pre-PL-439 classes — no audit trail
-- recorded creators before this column) → recipient falls back to the
-- current admin default, never silently nobody. IDEMPOTENT.

alter table public.classes add column if not exists created_by text;

comment on column public.classes.created_by is
  'PL-439: staff email (lowercase) of whoever created the class — wizard-stamped (draft stamp carries through). NULL = unknown (legacy/imports); creator-targeted emails fall back to the admin default.';

notify pgrst, 'reload schema';
