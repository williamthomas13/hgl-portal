-- PL-202: calls land in the portal. call_events is the PROVIDER-AGNOSTIC
-- internal shape — the Quo webhook receiver normalizes into it, and if Quo
-- ever disappoints only the adapter changes. Matched calls carry family_id
-- (the family timeline reads them); unknown callers become pipeline leads
-- (lead_id). Missed known-family calls drive a state-driven needs-attention
-- row that clears on a later outbound call or a manual dismissal. Idempotent.

create table if not exists call_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'quo',
  provider_event_id text not null unique, -- webhook redelivery dedupe
  event_type text not null check (event_type in ('completed', 'missed', 'voicemail')),
  direction text check (direction in ('incoming', 'outgoing')),
  phone_e164 text not null,
  family_id uuid references families(id) on delete set null,
  student_id uuid references students(id) on delete set null,
  lead_id uuid references leads(id) on delete set null,
  duration_seconds integer,
  voicemail_url text,
  occurred_at timestamptz not null,
  dismissed_at timestamptz,
  dismissed_by text,
  raw jsonb,
  created_at timestamptz not null default now()
);

create index if not exists call_events_family_idx on call_events (family_id, occurred_at desc);
create index if not exists call_events_phone_idx on call_events (phone_e164, occurred_at desc);

alter table call_events enable row level security;
do $$ begin
  create policy "staff read calls" on call_events for select using (is_staff());
exception when duplicate_object then null; end $$;
