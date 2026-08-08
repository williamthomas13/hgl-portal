-- PL-313: close-match detection — "this looks like the same person" prompts.
-- One row per (pipeline lead × student record) pair that ever looked alike.
-- status: pending (to-do open) · linked (admin confirmed — lead connected to
-- the record and marked converted-won) · not_same (admin said different
-- people — REMEMBERED; the unique pair means it never re-asks).
-- NEVER auto-merged: every link is an explicit admin/manager decision.
-- Idempotent.

create table if not exists record_matches (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id) on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  family_id uuid references families(id) on delete cascade,
  enrollment_id uuid references enrollments(id) on delete set null,
  reasons text[] not null default '{}',
  status text not null default 'pending' check (status in ('pending', 'linked', 'not_same')),
  decided_at timestamptz,
  decided_by text,
  created_at timestamptz not null default now(),
  unique (lead_id, student_id)
);

alter table record_matches enable row level security;
do $$
begin
  if not exists (
    select 1 from pg_policies where tablename = 'record_matches' and policyname = 'staff all'
  ) then
    create policy "staff all" on record_matches for all using (public.is_staff());
  end if;
end $$;

notify pgrst, 'reload schema';
