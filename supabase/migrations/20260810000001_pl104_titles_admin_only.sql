-- PL-104/PL-102: editing a tutor's pay-type TITLE list is admin-only.
-- Managers hold instructors write access through "staff all" (they edit
-- subjects, windows, locations daily), so the title boundary is enforced
-- with a targeted trigger instead of a policy change. Service-role writes
-- (auth.uid() is null — server code, seeds) stay allowed. Idempotent.

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
  return new;
end
$$;

drop trigger if exists trg_guard_pay_type_titles on public.instructors;
create trigger trg_guard_pay_type_titles
  before update on public.instructors
  for each row execute function public.guard_pay_type_titles();
