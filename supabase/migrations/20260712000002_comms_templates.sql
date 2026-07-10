-- =============================================================================
-- HGL Portal — Feature A4: DB-backed editable email templates
-- (docs/COMMS_ATTENDANCE_PARENT_SPEC.md §A4)
-- =============================================================================
-- Copy moves to the database; layout/rendering stays in code. Versions are
-- immutable — editing always creates a new version; revert copies an old one
-- forward. email_sends.body_snapshot_id records exactly which copy version a
-- send used ("show exactly what they received").
--
-- The per-template `live` flag is the scheduler cutover switch (spec §A4
-- migration note): seeded templates start live=false (code-rendered copy
-- keeps sending); each flips to true only after its seeded copy is verified
-- with a test send.
--
-- RLS: admin + manager only (spec permissions, decided July 10) — instructors
-- never see sequence templates.
--
-- IDEMPOTENT: re-runnable as a set.
-- =============================================================================

create table if not exists public.email_templates (
  template_key text primary key,
  display_name text not null,
  sequence_number text,
  audience text not null default 'parent'
    check (audience in ('parent', 'student', 'both', 'counselor', 'admin')),
  from_identity text not null default 'info' check (from_identity in ('info', 'billy')),
  category text not null default 'transactional'
    check (category in ('transactional', 'relationship')),
  active_version_id uuid,
  live boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists public.email_template_versions (
  id uuid primary key default gen_random_uuid(),
  template_key text not null references public.email_templates(template_key) on delete cascade,
  version_number integer not null,
  subject text not null,
  preheader text not null default '',
  body_markdown text not null,
  -- Custom footer line rendered above the standard T/R footer (several deck
  -- templates carry one, e.g. #9's "this is the only one like it").
  footer_note text,
  variables_used text[] not null default '{}',
  notes text,
  created_by text,
  created_at timestamptz not null default now(),
  unique (template_key, version_number)
);

-- Registry → active version pointer (added after both tables exist).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'email_templates_active_version_fk'
  ) then
    alter table public.email_templates
      add constraint email_templates_active_version_fk
      foreign key (active_version_id) references public.email_template_versions(id);
  end if;
end $$;

-- A2's send log now points at the exact copy version used.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'email_sends_body_snapshot_fk'
  ) then
    alter table public.email_sends
      add constraint email_sends_body_snapshot_fk
      foreign key (body_snapshot_id) references public.email_template_versions(id);
  end if;
end $$;

create index if not exists idx_template_versions_key
  on public.email_template_versions (template_key, version_number desc);

alter table public.email_templates enable row level security;
alter table public.email_template_versions enable row level security;

drop policy if exists "staff all" on public.email_templates;
create policy "staff all" on public.email_templates
  for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

drop policy if exists "staff all" on public.email_template_versions;
create policy "staff all" on public.email_template_versions
  for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

notify pgrst, 'reload schema';
