-- PL-332: a manager can never edit the ADMIN's notification/alert settings —
-- her own and other non-admin staff members' only. Two server-side guards
-- (the Phase 3.1 rule: screens can hide, the server refuses):
--
-- 1. staff_alert_subscriptions loses direct browser writes entirely. Reads
--    stay staff-wide (the panel shows everyone); every write goes through
--    /api/admin/alert-subscriptions (service role), which enforces the
--    admin/manager split — the old "staff all" policy let any manager write
--    any row, including the admin's, straight past the route.
--
-- 2. instructors.pref_* (PL-327 tutor email prefs) refuse a non-admin
--    browser write when the instructor row belongs to an admin profile —
--    the instructor editor saves with the caller's own session, so this is
--    the same targeted-trigger pattern as guard_pay_type_titles (PL-104).
--    Service-role writes (auth.uid() is null: the tutor self-serve API and
--    the staff route, which run their own checks) stay allowed.
--
-- Idempotent.

drop policy if exists "staff all" on public.staff_alert_subscriptions;
drop policy if exists "staff read" on public.staff_alert_subscriptions;
create policy "staff read" on public.staff_alert_subscriptions
  for select to authenticated
  using (public.is_staff());

create or replace function public.guard_admin_instructor_prefs()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (new.pref_notes_reminders is distinct from old.pref_notes_reminders
      or new.pref_class_digests is distinct from old.pref_class_digests
      or new.pref_fyi_copies is distinct from old.pref_fyi_copies)
     and auth.uid() is not null
     and not public.is_admin()
     and exists (
       select 1 from public.profiles p
       where lower(p.email) in (lower(old.email), lower(new.email))
         and p.role = 'admin'
     ) then
    raise exception 'Only an admin can change an owner''s notification preferences.';
  end if;
  return new;
end
$$;

drop trigger if exists trg_guard_admin_instructor_prefs on public.instructors;
create trigger trg_guard_admin_instructor_prefs
  before update on public.instructors
  for each row execute function public.guard_admin_instructor_prefs();

notify pgrst, 'reload schema';
