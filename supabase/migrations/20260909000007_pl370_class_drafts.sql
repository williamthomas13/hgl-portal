-- PL-370: save the class wizard and come back later. Implementation choice
-- (the doc left it to Code): a WIZARD-STATE BLOB, not a draft status on the
-- real classes row — a draft that has no classes row is inert EVERYWHERE by
-- construction (no /c page, no sitemap entry, no shortlink target, invisible
-- to registration/min-enrollment/reports/calendar/comms — nothing queries
-- this table but the wizard), no slug is minted until the real create runs,
-- and deleting a draft has nothing downstream to clean. Finishing a draft
-- goes through the SAME handleCreate/validate path as a straight-through
-- run. IDEMPOTENT.

create table if not exists public.class_drafts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  state jsonb not null,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.class_drafts is
  'PL-370: saved class-wizard state (come-back-later drafts). Deliberately NOT classes rows — a draft is invisible to every class consumer by construction.';

notify pgrst, 'reload schema';
