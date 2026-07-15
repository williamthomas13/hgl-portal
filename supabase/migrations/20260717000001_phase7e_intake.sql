-- =============================================================================
-- HGL Portal — Phase 7e: intake & onboarding + policy agreements
-- (docs/PHASE7_SPEC.md §11–§12)
-- =============================================================================
-- Replaces the Ops Director's "pending students" spreadsheet (leads pipeline),
-- the Google Forms registration blanks (tokenized /intake/{token} page), and
-- the Google Forms policy "signature" (in-portal agreements with an identity/
-- timestamp/content-snapshot acceptance record + PDF snapshot).
--
-- Tables: leads (the pipeline), tutoring_offers (the retired-but-ready "2 free
-- hours" mechanism — seeded EMPTY, no offers at launch), agreement_templates
-- (versioned policy text, seeded v1 from the current signed policies updated
-- to §6), agreement_acceptances (who accepted which version, when, from where).
--
-- RLS: staff full CRUD on all four (is_staff()); parents read their own
-- family's acceptances (family_ids()). NO anon policies — the public intake
-- and agreement pages authenticate with HMAC signed-link tokens and go
-- through service-role API routes, never PostgREST.
--
-- IDEMPOTENT: safe to re-run as a set (guarded creates, add column if not
-- exists, drop-then-create policies, seed only when empty).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Offers: the "2 free hours"-style mechanism (spec §11). No offers are
--    active at launch — the table exists so whatever comes back has a home.
--    When a lead converts, the attached offer materializes on the first
--    invoice as comped hours or a credit line labeled with the offer name.
-- -----------------------------------------------------------------------------
create table if not exists public.tutoring_offers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null check (kind in ('free_hours', 'percent_off_first_month', 'fixed_credit')),
  value numeric not null,               -- hours, percent, or dollars per kind
  active boolean not null default true,
  valid_from date,
  valid_until date,
  notes text,
  created_at timestamptz not null default now()
);
-- Deliberately no seed: the COVID-era website offer is retired (spec §11).

alter table public.tutoring_offers enable row level security;

drop policy if exists "staff all" on public.tutoring_offers;
create policy "staff all" on public.tutoring_offers
  for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- -----------------------------------------------------------------------------
-- 2. Leads: the pipeline that replaces the spreadsheet (spec §11)
-- -----------------------------------------------------------------------------
create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'other'
    check (source in ('website', 'referral', 'call', 'other')),
  -- Contact (usually the parent/guardian; whoever reached out)
  contact_name text,
  contact_email text,
  contact_phone text,
  -- Student basics as first captured (the intake form fills in the rest)
  student_name text,
  student_school text,
  student_grade text,
  interest text not null default 'unsure'
    check (interest in ('test_prep', 'subject', 'unsure')),
  subjects text,                        -- free text: "SAT" / "Algebra 2 + Chemistry"
  test_date text,                       -- free text: "March SAT" beats a date picker here
  prior_scores text,
  availability_text text,
  online_preference text
    check (online_preference in ('online', 'in_person', 'either')),
  offer_id uuid references public.tutoring_offers(id) on delete set null,
  status text not null default 'new'
    check (status in ('new', 'contacted', 'intake_sent', 'intake_complete',
                      'consult_scheduled', 'consult_done', 'proposal_sent',
                      'scheduled', 'lost')),
  assigned_to text,                     -- staff email
  -- Consultation light-scheduling (spec §11: v1 = datetime + owner, pushed
  -- to the owner's Google Calendar best-effort; self-serve booking is out)
  consult_at timestamptz,
  consult_owner_email text,
  consult_gcal_event_id text,
  notes text,
  intake_token_sent_at timestamptz,
  intake_completed_at timestamptz,
  -- Full intake answers, verbatim (spec §11: "stores the intake answers on
  -- the lead row"). The scalar columns above are refreshed from it for cheap
  -- pipeline queries; this keeps every answer (emergency contact, special
  -- needs, second guardian, …) without 20 more columns.
  intake jsonb,
  -- Set on conversion — the lead points at the real records it became.
  family_id uuid references public.families(id) on delete set null,
  student_id uuid references public.students(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_leads_status on public.leads(status, updated_at);
create index if not exists idx_leads_email on public.leads(lower(contact_email));

alter table public.leads enable row level security;

drop policy if exists "staff all" on public.leads;
create policy "staff all" on public.leads
  for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- -----------------------------------------------------------------------------
-- 3. Agreement templates: versioned policy text (spec §12)
-- -----------------------------------------------------------------------------
create table if not exists public.agreement_templates (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'scheduling_billing_policy',
  version integer not null,
  body_markdown text not null,          -- comms-md dialect (renderMarkdownBody)
  effective_date date,
  active boolean not null default false, -- exactly one active row per kind (app-enforced)
  created_at timestamptz not null default now(),
  unique (kind, version)
);

alter table public.agreement_templates enable row level security;

drop policy if exists "staff all" on public.agreement_templates;
create policy "staff all" on public.agreement_templates
  for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- Seed v1 from the current Scheduling & Billing Policies form, updated to
-- match spec §6 (portal invoice timing/due date supersedes "due by first
-- session"). Seed only when the kind has no rows; staff publish new versions
-- from /admin/agreements.
insert into public.agreement_templates (kind, version, body_markdown, effective_date, active)
select
  'scheduling_billing_policy',
  1,
  '# Scheduling & Billing Policies

## Monthly billing, in advance

- Tutoring is billed **monthly, in advance**. Near the end of each month you receive the coming month''s schedule and invoice for review.
- You''ll have a few days to **confirm the schedule or request changes**. If we don''t hear from you within the window stated in the email, the schedule and invoice **confirm automatically** and stay exactly as shown — the same "the schedule stays the same unless changed" arrangement as always.
- Invoices are **due by the end of the month** in which they are issued.
- Schedule changes for the coming month need to reach us **before the end of the current month**; otherwise the schedule rolls over unchanged.

## Rescheduling & missed sessions

- Because the month is prepaid, sessions are **rescheduled, never refunded**.
- With **24 hours'' notice or more**, rescheduling a session is free — we''ll find a new time together.
- With **less than 24 hours'' notice**, or if the student doesn''t show, the session is forfeited or rescheduled with a **$40-per-hour rescheduling fee**, because your tutor is still paid for the reserved time.
- Once a month is confirmed and paid there are **no refunds**; changes within the month are reschedules or forfeits as above. Emergencies are always our call to make together — just get in touch.

## Late payment

- If an invoice is unpaid **10 days** past its due date, we''ll send a reminder.
- If an invoice remains unpaid **30 days** past its due date, a **10% late fee** applies to the entire invoice, and scheduled sessions may be paused until the account is current.

## Reduced rates

- Families receiving a reduced hourly rate must have the **reduced-rate request form** on file with us; reduced rates apply only once the form is completed and approved.

Questions about any of this? Email us or give us a call — we''re happy to walk through it, and anything unusual is always handled person-to-person.',
  current_date,
  true
where not exists (
  select 1 from public.agreement_templates where kind = 'scheduling_billing_policy'
);

-- -----------------------------------------------------------------------------
-- 4. Agreement acceptances: the first-class record that replaces Form
--    responses (spec §12). Pins the exact template version; the PDF snapshot
--    of the accepted text lives in the private collateral-private bucket.
-- -----------------------------------------------------------------------------
create table if not exists public.agreement_acceptances (
  id uuid primary key default gen_random_uuid(),
  agreement_template_id uuid not null references public.agreement_templates(id) on delete restrict,
  family_id uuid not null references public.families(id) on delete cascade,
  accepted_by_name text not null,       -- typed full name
  accepted_by_email text,
  accepted_at timestamptz not null default now(),
  ip text,
  user_agent text,
  pdf_snapshot_path text,               -- collateral-private: agreements/{id}.pdf
  pdf_error text,                       -- snapshot failure note (acceptance stands; retry from admin)
  created_at timestamptz not null default now()
);

create index if not exists idx_agreement_acceptances_family
  on public.agreement_acceptances(family_id);
create index if not exists idx_agreement_acceptances_template
  on public.agreement_acceptances(agreement_template_id);

alter table public.agreement_acceptances enable row level security;

drop policy if exists "staff all" on public.agreement_acceptances;
create policy "staff all" on public.agreement_acceptances
  for all to authenticated
  using (public.is_staff()) with check (public.is_staff());
-- Parents can see their own family's acceptance record (what they agreed to,
-- and when). Writes come only through the token-verified service-role route.
drop policy if exists "parent own acceptances" on public.agreement_acceptances;
create policy "parent own acceptances" on public.agreement_acceptances
  for select to authenticated
  using (family_id in (select public.family_ids()));

-- PostgREST: pick up the new tables
notify pgrst, 'reload schema';
