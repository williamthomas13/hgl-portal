-- =============================================================================
-- HGL Portal: Phase 2 lifecycle — timezones, delivery mode, enrollment
-- statuses, waitlist
-- =============================================================================
-- schools.nickname and classes.capacity already exist (foundation migration).
-- Safe to re-run: ALTERs are `if not exists`, constraints guarded by do-blocks.
-- =============================================================================

-- Schools: per-school timezone drives 8:00/11:00 local send windows
alter table public.schools
  add column if not exists timezone text not null default 'America/Mexico_City';

-- Classes: delivery mode, minimum enrollment, optional deadline
alter table public.classes
  add column if not exists delivery_mode text not null default 'in_person';

do $$ begin
  alter table public.classes
    add constraint classes_delivery_mode_check
    check (delivery_mode in ('online', 'in_person'));
exception when duplicate_object then null; end $$;

alter table public.classes
  add column if not exists min_enrollment int;

update public.classes
   set min_enrollment = case delivery_mode when 'online' then 3 else 8 end
 where min_enrollment is null;

alter table public.classes
  add column if not exists enrollment_deadline date;

-- Enrollments: status lifecycle + waitlist claim window
-- Rename legacy 'Pending Checkout' before adding the check constraint.
update public.enrollments
   set payment_status = 'Pending'
 where payment_status = 'Pending Checkout';

do $$ begin
  alter table public.enrollments
    add constraint enrollments_status_check
    check (payment_status in ('Pending', 'Paid', 'Expired', 'Waitlisted'));
exception when duplicate_object then null; end $$;

alter table public.enrollments
  add column if not exists waitlist_offer_sent_at timestamptz;

alter table public.enrollments
  add column if not exists waitlist_offer_expires_at timestamptz;

-- The Gemini-era classes table has RLS on with INSERT/SELECT policies only —
-- no UPDATE policy, so edits silently affected zero rows. Add it (permissive,
-- matching families/students/enrollments, until Phase 3 auth).
do $$ begin
  create policy "Allow public update" on public.classes
    for update using (true) with check (true);
exception when duplicate_object then null; end $$;

-- email_log: snapshot of what email #4 (class details) said, so the sweep can
-- detect start/room/instructor changes that require a "schedule update" send
alter table public.email_log
  add column if not exists payload jsonb;
