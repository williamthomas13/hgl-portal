-- PL-338: multiple schedule drafts, stored SERVER-SIDE per staff member —
-- they survive browser changes/devices, and the dashboard can count them
-- ("{X} student schedules in progress"). payload = the wizard's draft shape
-- (the same fields the PL-171 localStorage auto-draft holds; the auto-draft
-- stays as the unsaved-work safety net on top of any number of saved
-- drafts). PL-337 calendar proposals save through the same model.
-- Idempotent.

create table if not exists public.tutoring_schedule_drafts (
  id uuid primary key default gen_random_uuid(),
  created_by text not null,
  student_label text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.tutoring_schedule_drafts enable row level security;
do $$
begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'tutoring_schedule_drafts' and policyname = 'staff all'
  ) then
    create policy "staff all" on public.tutoring_schedule_drafts
      for all to authenticated
      using (public.is_staff()) with check (public.is_staff());
  end if;
end $$;

notify pgrst, 'reload schema';
