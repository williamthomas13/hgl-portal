-- PL-280: Campaigns v2 — full family-history segmentation, parent+student
-- paired sends with PER-PERSON unsubscribe, saved segments, one-shot
-- scheduling. Open tracking already lands on email_sends (spec A2 webhook);
-- v2 only surfaces it. Financial facts segment ONLY — no dollar-shaped
-- composer variable exists, so money cannot render into copy (gate-asserted).
-- Idempotent.

-- Saved/named segments (the v1 seam): definitions resolve at use, so
-- membership is live by construction.
create table if not exists public.saved_segments (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  definition jsonb not null,
  summary text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.saved_segments enable row level security;
drop policy if exists "staff all" on public.saved_segments;
create policy "staff all" on public.saved_segments for all
  using (public.is_staff()) with check (public.is_staff());

-- Campaigns: audience mode (parents | pairs), the student leg's template,
-- and one-shot scheduling (dispatched by the hourly sweep).
alter table public.campaigns add column if not exists audience_mode text not null default 'parents';
alter table public.campaigns drop constraint if exists campaigns_audience_mode_check;
alter table public.campaigns add constraint campaigns_audience_mode_check
  check (audience_mode in ('parents', 'pairs'));
alter table public.campaigns add column if not exists student_template_key text;
alter table public.campaigns add column if not exists student_template_version_id uuid
  references public.email_template_versions(id);
alter table public.campaigns add column if not exists scheduled_for timestamptz;
alter table public.campaigns drop constraint if exists campaigns_status_check;
alter table public.campaigns add constraint campaigns_status_check
  check (status in ('draft', 'scheduled', 'sending', 'paused', 'done', 'cancelled'));

-- Recipients: the leg's role + which student a student leg addresses. The
-- uniqueness key gains role (a parent and student could share an inbox).
alter table public.campaign_recipients add column if not exists role text not null default 'parent';
alter table public.campaign_recipients drop constraint if exists campaign_recipients_role_check;
alter table public.campaign_recipients add constraint campaign_recipients_role_check
  check (role in ('parent', 'student'));
alter table public.campaign_recipients add column if not exists student_id uuid
  references public.students(id) on delete set null;
alter table public.campaign_recipients drop constraint if exists campaign_recipients_campaign_id_email_key;
create unique index if not exists campaign_recipients_campaign_email_role
  on public.campaign_recipients (campaign_id, email, role);

-- PL-280 chip "used a promo code": stamp the code at checkout (portal-side
-- codes only — Stripe-page promotion codes never reach us).
alter table public.enrollments add column if not exists promo_code_used text;
comment on column public.enrollments.promo_code_used is
  'PL-280: the portal-validated discount code applied at checkout (FO codes). Stripe-side promotion codes are not visible here.';

notify pgrst, 'reload schema';
