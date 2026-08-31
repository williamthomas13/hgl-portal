-- PL-424: availability UPDATES are distinguished from first shares end to
-- end. Every save from the tokenized availability page records what changed
-- (before/after grids) so the admin alert can carry a composed diff and the
-- review surface can show the SAME diff later — freebusy keeps no history;
-- this does. Append-only. Staff read client-side (the tutoring review card).
-- Idempotent.
create table if not exists public.availability_changes (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  family_id uuid not null references public.families(id) on delete cascade,
  kind text not null check (kind in ('first', 'update')),
  before_ranges jsonb not null default '[]'::jsonb,
  after_ranges jsonb not null default '[]'::jsonb,
  timezone text,
  created_at timestamptz not null default now()
);

create index if not exists availability_changes_student_idx
  on public.availability_changes (student_id, created_at desc);

alter table public.availability_changes enable row level security;

do $$ begin
  create policy availability_changes_staff_read on public.availability_changes
    for select using (
      exists (
        select 1 from public.profiles p
        where p.id = auth.uid() and p.role in ('admin', 'manager')
      )
    );
exception when duplicate_object then null; end $$;

notify pgrst, 'reload schema';
