-- PL-195: a failed generation is a STATE on the family, not just a flash of
-- alert email. One row per (family, billing period) while generation is
-- failing for them; the row is DELETED the moment a later run — automatic
-- sweep or the family-card "Retry now" — succeeds. State-driven both
-- directions. Idempotent.
create table if not exists public.generation_failures (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  period date not null,
  error text not null,
  first_failed_at timestamptz not null default now(),
  last_attempt_at timestamptz not null default now(),
  unique (family_id, period)
);

alter table public.generation_failures enable row level security;

-- Staff read it on the tutoring page (browser client); writes are
-- service-role only (the generation machinery).
do $$ begin
  create policy generation_failures_staff_read on public.generation_failures
    for select using (
      exists (
        select 1 from public.profiles p
        where p.id = auth.uid() and p.role in ('admin', 'manager')
      )
    );
exception when duplicate_object then null; end $$;
