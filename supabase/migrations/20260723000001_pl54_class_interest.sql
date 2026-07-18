-- =============================================================================
-- HGL Portal — PL-54: "you'll hear first" becomes a real mechanism
-- =============================================================================
-- class_interest: who wants to know when the next {school} {class_type}
-- course opens. Populated automatically from waitlisted families at class
-- cancellation and by the public tell-me-when capture on closed/full/
-- cancelled registration pages. Drained by the admin "N families are
-- waiting — notify them?" prompt (never a silent auto-send — the Ops
-- Director picks the moment; the system does the remembering).
--
-- IDEMPOTENT: safe to re-run.
-- =============================================================================

create table if not exists public.class_interest (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  parent_name text,
  student_name text,
  school_id uuid not null references public.schools(id) on delete cascade,
  class_type text not null,
  source text not null check (source in ('cancellation', 'public_form')),
  created_at timestamptz not null default now(),
  notified_at timestamptz,
  unique (email, school_id, class_type)
);

comment on table public.class_interest is
  'PL-54: interest list for the next {school} {class_type} course. '
  'notified_at null = still waiting to hear.';

create index if not exists class_interest_open_idx
  on public.class_interest (school_id, class_type) where notified_at is null;

alter table public.class_interest enable row level security;

-- Staff read/manage; public submissions arrive via the service-role API.
drop policy if exists "staff all" on public.class_interest;
create policy "staff all" on public.class_interest
  for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

notify pgrst, 'reload schema';
