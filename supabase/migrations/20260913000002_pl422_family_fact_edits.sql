-- PL-422: parent self-service edits get ONE auditable trail. Every
-- self-service change from the family portal writes a row here; the PL-405
-- activity feeds (dashboard/family-hub builder + the tutoring "Recent parent
-- activity" pane) derive from it. Append-only log — surfaces stay derived.
-- Writes are service-role only; staff read client-side (the tutoring pane).
-- Idempotent.
create table if not exists public.family_fact_edits (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  student_id uuid references public.students(id) on delete set null,
  actor text not null,   -- 'parent' (self-service); staff email reserved for later
  summary text not null, -- plain English: "updated the parent phone number"
  created_at timestamptz not null default now()
);

create index if not exists family_fact_edits_family_idx
  on public.family_fact_edits (family_id, created_at desc);
create index if not exists family_fact_edits_created_idx
  on public.family_fact_edits (created_at desc);

alter table public.family_fact_edits enable row level security;

do $$ begin
  create policy family_fact_edits_staff_read on public.family_fact_edits
    for select using (
      exists (
        select 1 from public.profiles p
        where p.id = auth.uid() and p.role in ('admin', 'manager')
      )
    );
exception when duplicate_object then null; end $$;

notify pgrst, 'reload schema';
