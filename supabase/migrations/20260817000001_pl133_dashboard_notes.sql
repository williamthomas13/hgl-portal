-- PL-133: the sticky-note layer on Needs Attention.
--
-- Deliberately dumb: free text and a done button, nothing else. Phone
-- interruptions become pinned rows instead of desk sticky notes. These are
-- the ONE exception to the state-driven rule (PL-100) — human-pinned,
-- human-cleared — so they render visually distinct from derived rows and
-- nobody mistakes a note for a system condition.
--
-- No priorities, assignees, due dates, or categories. The moment it grows
-- fields it competes with real task tools and loses.
--
-- "Done" keeps a trail (cleared_at/cleared_by) rather than hard-deleting:
-- the note that got cleared is sometimes the thing you need to recall.
-- Idempotent.

create table if not exists public.dashboard_notes (
  id uuid primary key default gen_random_uuid(),
  body text not null,
  created_by text not null,
  created_at timestamptz not null default now(),
  cleared_at timestamptz,
  cleared_by text
);

create index if not exists dashboard_notes_open_idx
  on public.dashboard_notes (created_at desc)
  where cleared_at is null;

alter table public.dashboard_notes enable row level security;

-- A shared ops surface, not personal notes: any staff member reads and
-- writes all of them. Mutations still go through the authed API route.
drop policy if exists dashboard_notes_staff_all on public.dashboard_notes;
create policy dashboard_notes_staff_all on public.dashboard_notes
  for all
  using (
    exists (
      select 1 from public.profiles p
       where p.id = auth.uid() and p.role in ('admin', 'manager')
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
       where p.id = auth.uid() and p.role in ('admin', 'manager')
    )
  );

comment on table public.dashboard_notes is
  'PL-133: staff sticky notes pinned into Needs Attention. Text + done, nothing more.';
