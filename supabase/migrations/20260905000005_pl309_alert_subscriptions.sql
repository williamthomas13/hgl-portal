-- PL-309: staff notification subscriptions for [HGL Admin] alerts.
-- Row = one staff email × one alert category. granted (admin-controlled)
-- says the category is available to that person; enabled (self-controlled
-- within granted) says they actually receive it. sendAdminAlert resolves
-- recipients per category from enabled rows; zero enabled subscribers falls
-- back to the callsite's legacy address (alerts never go nowhere).
-- Seeds: every ADMIN profile gets every category granted+enabled (today's
-- behavior preserved for Billy). Manager defaults (the tutoring subset)
-- seed from the API on first load — no manager profile exists yet.
-- Idempotent.

create table if not exists staff_alert_subscriptions (
  email text not null,
  category text not null,
  granted boolean not null default true,
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (email, category)
);

alter table staff_alert_subscriptions enable row level security;
do $$
begin
  if not exists (
    select 1 from pg_policies where tablename = 'staff_alert_subscriptions' and policyname = 'staff all'
  ) then
    create policy "staff all" on staff_alert_subscriptions for all using (public.is_staff());
  end if;
end $$;

insert into staff_alert_subscriptions (email, category)
select p.email, c.category
from profiles p
cross join (values
  ('registrations'), ('payments_qbo'), ('min_enrollment'), ('class_ops'),
  ('coverage'), ('timecards'), ('reschedule_requests'), ('pipeline'),
  ('close_match'), ('agreements'), ('waitlist'), ('system')
) as c(category)
where p.role = 'admin'
on conflict (email, category) do nothing;

notify pgrst, 'reload schema';
