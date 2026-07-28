-- PL-212: salaried tutors — same tracking, different pay interpretation.
-- One flag on instructors: 'hourly' (default) | 'salaried'. Timecards keep
-- generating/confirming/approving identically; surfaces label salaried cards
-- "hours tracked for records; not paid hourly" and the payroll CSV separates
-- them so salaried hours can't be paid as hourly by accident. No salary
-- amounts anywhere in the portal (standing rule: dollars live in QBO).
-- Idempotent.

alter table public.instructors
  add column if not exists pay_type text not null default 'hourly';

do $$ begin
  alter table public.instructors
    add constraint instructors_pay_type_check check (pay_type in ('hourly', 'salaried'));
exception when duplicate_object then null; end $$;

-- Editing the pay-type flag is admin-only, same boundary as pay-type titles
-- (managers keep day-to-day instructors write access; service-role writes
-- stay allowed). Extends the PL-104 guard to cover both fields.
create or replace function public.guard_pay_type_titles()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.pay_type_titles is distinct from old.pay_type_titles
     and auth.uid() is not null
     and not public.is_admin() then
    raise exception 'Only an admin can edit pay-type titles.';
  end if;
  if new.pay_type is distinct from old.pay_type
     and auth.uid() is not null
     and not public.is_admin() then
    raise exception 'Only an admin can change a tutor''s pay type.';
  end if;
  return new;
end
$$;
