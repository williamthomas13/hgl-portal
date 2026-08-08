-- PL-321: the editable price list — stored the DERIVED way. Each tutoring
-- package keeps a base rate (regular_hourly_rate) + a per-tier discount
-- (discount_per_hour, NEW); hourly_rate and package_price are recomputed by
-- trigger from those, so raising a base rate moves every tier price with it.
-- Backfill derives the discount from today's hand-entered numbers — every
-- current price is reproduced exactly (intl 130-10/25/35 → 120/105/95;
-- domestic 110-10/20/30 → 100/90/80; post-class 130-5/15 → 125/115).
-- Late fees join app_settings so the last hard-coded computational prices
-- have one editable source. Existing snapshots/receipts stay frozen —
-- price changes are forward-only.
-- Idempotent.

alter table tutoring_packages add column if not exists discount_per_hour numeric;

update tutoring_packages
  set discount_per_hour = regular_hourly_rate - hourly_rate
  where discount_per_hour is null;

create or replace function tutoring_package_derive() returns trigger as $$
begin
  if new.discount_per_hour is null then
    new.discount_per_hour := coalesce(new.regular_hourly_rate, 130) - coalesce(new.hourly_rate, 0);
  end if;
  new.hourly_rate := new.regular_hourly_rate - new.discount_per_hour;
  new.package_price := round(new.hours * new.hourly_rate, 2);
  return new;
end $$ language plpgsql;

drop trigger if exists trg_tutoring_package_derive on tutoring_packages;
create trigger trg_tutoring_package_derive
  before insert or update on tutoring_packages
  for each row execute function tutoring_package_derive();

insert into app_settings (key, value) values
  ('late_reschedule_fee_per_hour', '40'),
  ('late_fee_percent', '10')
on conflict (key) do nothing;

notify pgrst, 'reload schema';
