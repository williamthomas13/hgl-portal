-- =============================================================================
-- HGL Portal: Phase 3.1 — Manager role + Refunded status (SPEC v2.5)
-- =============================================================================
-- manager = daily operations: everything admins do EXCEPT ownership-level
-- control (roles/users/config) and deleting rows with payment history.
-- admin behavior is unchanged.
--
-- Refunds are Option A: no money movement in the portal — actual refunds are
-- issued in the Stripe dashboard. 'Refunded' status frees the capacity spot
-- (spotsTaken counts only Pending/Paid/active offers, so the next sweep
-- extends a W2 offer), drops the row out of every status-filtered email pass,
-- and keeps stripe_payment_intent_id + payment history intact.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Role + status values
-- -----------------------------------------------------------------------------
alter table public.profiles drop constraint profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('admin', 'manager', 'instructor', 'counselor', 'parent'));

alter table public.enrollments drop constraint enrollments_status_check;
alter table public.enrollments add constraint enrollments_status_check
  check (payment_status in ('Pending', 'Paid', 'Completed', 'Expired', 'Waitlisted', 'Refunded'));

-- -----------------------------------------------------------------------------
-- 2. Helpers
-- -----------------------------------------------------------------------------
create or replace function public.is_staff()
returns boolean
language sql stable
security definer
set search_path = public
as $$
  select coalesce(
    (select role in ('admin', 'manager') from public.profiles where id = auth.uid()),
    false
  )
$$;

-- "Payment history" = the row (or a descendant enrollment) has a Stripe
-- payment intent or ever reached a paid state. Guards the audit trail that
-- feeds Phase 6 / QuickBooks.
create or replace function public.student_has_payment_history(sid uuid)
returns boolean
language sql stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.enrollments e
    where e.student_id = sid
      and (e.stripe_payment_intent_id is not null
           or e.payment_status in ('Paid', 'Completed', 'Refunded'))
  )
$$;

create or replace function public.family_has_payment_history(fid uuid)
returns boolean
language sql stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.students s
    join public.enrollments e on e.student_id = s.id
    where s.family_id = fid
      and (e.stripe_payment_intent_id is not null
           or e.payment_status in ('Paid', 'Completed', 'Refunded'))
  )
$$;

grant execute on function
  public.is_staff(),
  public.student_has_payment_history(uuid),
  public.family_has_payment_history(uuid)
to authenticated, anon;

-- -----------------------------------------------------------------------------
-- 3. Operational tables: admin-only CRUD becomes staff CRUD
--    (profiles is intentionally untouched: writes stay is_admin()-only, and
--    managers can read only their own row — no privilege-escalation path)
-- -----------------------------------------------------------------------------

-- No financial history on these five: plain staff ALL.
drop policy "admin all" on public.schools;
create policy "staff all" on public.schools
  for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

drop policy "admin all" on public.school_counselors;
create policy "staff all" on public.school_counselors
  for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

drop policy "admin all" on public.classes;
create policy "staff all" on public.classes
  for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

drop policy "admin all" on public.sessions;
create policy "staff all" on public.sessions
  for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

drop policy "admin all" on public.tutoring_packages;
create policy "staff all" on public.tutoring_packages
  for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- Financial-history tables: staff read/insert/update, guarded delete.
drop policy "admin all" on public.families;
create policy "staff read" on public.families
  for select to authenticated using (public.is_staff());
create policy "staff insert" on public.families
  for insert to authenticated with check (public.is_staff());
create policy "staff update" on public.families
  for update to authenticated
  using (public.is_staff()) with check (public.is_staff());
create policy "staff delete unless paid history" on public.families
  for delete to authenticated
  using (
    public.is_admin()
    or (public.is_staff() and not public.family_has_payment_history(id))
  );

drop policy "admin all" on public.students;
create policy "staff read" on public.students
  for select to authenticated using (public.is_staff());
create policy "staff insert" on public.students
  for insert to authenticated with check (public.is_staff());
create policy "staff update" on public.students
  for update to authenticated
  using (public.is_staff()) with check (public.is_staff());
create policy "staff delete unless paid history" on public.students
  for delete to authenticated
  using (
    public.is_admin()
    or (public.is_staff() and not public.student_has_payment_history(id))
  );

drop policy "admin all" on public.enrollments;
create policy "staff read" on public.enrollments
  for select to authenticated using (public.is_staff());
create policy "staff insert" on public.enrollments
  for insert to authenticated with check (public.is_staff());
create policy "staff update" on public.enrollments
  for update to authenticated
  using (public.is_staff()) with check (public.is_staff());
create policy "staff delete unless paid history" on public.enrollments
  for delete to authenticated
  using (
    public.is_admin()
    or (public.is_staff()
        and stripe_payment_intent_id is null
        and payment_status not in ('Paid', 'Completed', 'Refunded'))
  );

-- Add-ons: purchase records, edit-only for managers (never deletable).
drop policy "admin all" on public.enrollment_addons;
create policy "staff read" on public.enrollment_addons
  for select to authenticated using (public.is_staff());
create policy "staff insert" on public.enrollment_addons
  for insert to authenticated with check (public.is_staff());
create policy "staff update" on public.enrollment_addons
  for update to authenticated
  using (public.is_staff()) with check (public.is_staff());
create policy "admin delete" on public.enrollment_addons
  for delete to authenticated using (public.is_admin());

-- Email plumbing: managers trigger/resend emails and view send status.
drop policy "admin read" on public.email_log;
create policy "staff read" on public.email_log
  for select to authenticated using (public.is_staff());
drop policy "admin read" on public.email_events;
create policy "staff read" on public.email_events
  for select to authenticated using (public.is_staff());

notify pgrst, 'reload schema';
