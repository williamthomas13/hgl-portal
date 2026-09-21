-- PL-473 / PL-477 (Sep 21 2026): lead source tagging, school-partnership leads
-- as their own KIND, and the marketing subscriber model for the College Prep
-- Compass signup + the MailerLite list import. Additive only (two-phase rule:
-- column-first; nothing here is dropped).

-- --- leads: kind + tags ---------------------------------------------------------
-- kind: 'family' (the pipeline as it exists) | 'school' (a school-partnership
-- inquiry — /examzen today; never mixed into the family pipeline's counts).
alter table public.leads add column if not exists kind text not null default 'family';
alter table public.leads drop constraint if exists leads_kind_check;
alter table public.leads add constraint leads_kind_check check (kind in ('family', 'school'));
-- source_detail: WHICH page/button/embed ("sqsp:/sat", "class-page:sls",
-- "embed:/contact") — the coarse `source` enum stays for the pipeline chips.
alter table public.leads add column if not exists source_detail text;
-- interest_tag: the pre-selected "What would you like help with?" from a link
-- or embed (SAT · ACT · AP/IB · University applications · GRE/GMAT · Academic
-- support · School partnership) — shown on the card, filterable.
alter table public.leads add column if not exists interest_tag text;
-- partner: the school-partnership form's own fields (organization, role,
-- country/city, tests, cohort size, format, timing) — one JSONB, read by the
-- card; converted into a school + contact via the PL-467 add-school path.
alter table public.leads add column if not exists partner jsonb;
-- school_id: set when a school lead is converted (the family pipeline sets
-- family_id / student_id the same way).
alter table public.leads add column if not exists school_id uuid references public.schools(id) on delete set null;
create index if not exists idx_leads_kind on public.leads (kind);
comment on column public.leads.kind is 'PL-477: family (default) | school — a school-partnership inquiry, its own pipeline lane.';
comment on column public.leads.source_detail is 'PL-473: which page/button/embed the inquiry came from (data-source / ?source=).';
comment on column public.leads.interest_tag is 'PL-473: the pre-selected interest from the link/embed (SAT, ACT, AP/IB, …).';

-- --- marketing subscribers (College Prep Compass) ----------------------------------
-- The portal had no standalone subscriber model: campaigns resolve FAMILIES.
-- This table holds people who only signed up for the Compass newsletter /
-- lead magnet (portal signup or the MailerLite import). A row is linked to a
-- family or lead by email when one exists (link, never duplicate); it receives
-- NOTHING until a campaign explicitly targets subscribers. Unsubscribe rides
-- the existing marketing_suppressions gate inside sendOnce (the choke point).
create table if not exists public.marketing_subscribers (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  first_name text,
  -- who is signing up: 'parent' | 'student' | null (unknown / imported)
  role text check (role in ('parent', 'student')),
  grad_year text,
  -- where the signup came from: 'compass' (portal form), 'embed:<path>',
  -- 'mailerlite-import', …
  source text not null default 'compass',
  -- the consent moment the person saw the consent text (portal signups) or
  -- MailerLite's original opt-in date (imports) — never invented.
  consented_at timestamptz,
  original_opt_in_at timestamptz,
  -- double opt-in (PL-477: only if the campaigns roadmap specifies it — the
  -- column exists so a confirm link can stamp it; NULL = single opt-in).
  confirmed_at timestamptz,
  -- link, don't duplicate: the family / lead this address already belongs to.
  family_id uuid references public.families(id) on delete set null,
  lead_id uuid references public.leads(id) on delete set null,
  imported_batch text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_marketing_subscribers_source on public.marketing_subscribers (source);
alter table public.marketing_subscribers enable row level security;
drop policy if exists "staff all subscribers" on public.marketing_subscribers;
create policy "staff all subscribers" on public.marketing_subscribers
  for all using (public.is_staff()) with check (public.is_staff());
comment on table public.marketing_subscribers is
  'PL-477: College Prep Compass / newsletter subscribers (portal signup + MailerLite import). Receive nothing until a campaign targets subscribers; suppression rides marketing_suppressions.';

notify pgrst, 'reload schema';
