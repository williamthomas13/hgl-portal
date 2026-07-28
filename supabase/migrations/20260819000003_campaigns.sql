-- PL-201: Campaigns v1 — the MailerLite replacement begins. Three tables:
-- suppressions (unsubscribes; gates ONLY marketing-category sends, enforced
-- inside sendOnce), campaigns (the send log's header: segment definition is
-- stored jsonb — the v2 saved-segments seam), and campaign_recipients (the
-- resolved list snapshot with per-recipient why + send status). Idempotent.

create table if not exists marketing_suppressions (
  email text primary key,
  reason text not null default 'unsubscribed',
  source text, -- which campaign/send prompted it, when known
  created_at timestamptz not null default now()
);

create table if not exists campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  segment jsonb not null,          -- storable/reusable definition (v2 seam)
  segment_summary text,            -- the plain-English chip line at send time
  template_key text not null,
  template_version_id uuid,        -- pinned at send time
  status text not null default 'draft'
    check (status in ('draft', 'sending', 'paused', 'done', 'cancelled')),
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists campaign_recipients (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  family_id uuid,
  email text not null,
  name text,
  why text[],                      -- which criteria matched, plain English
  status text not null default 'pending'
    check (status in ('pending', 'sent', 'failed', 'suppressed', 'excluded')),
  sent_at timestamptz,
  unique (campaign_id, email)
);

alter table marketing_suppressions enable row level security;
alter table campaigns enable row level security;
alter table campaign_recipients enable row level security;

do $$ begin
  create policy "staff read suppressions" on marketing_suppressions for select using (is_staff());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "staff all campaigns" on campaigns for all using (is_staff()) with check (is_staff());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "staff read campaign recipients" on campaign_recipients for select using (is_staff());
exception when duplicate_object then null; end $$;
