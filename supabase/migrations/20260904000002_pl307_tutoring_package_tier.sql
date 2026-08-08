-- PL-307: domestic (at-HGL) add-on tutoring pricing tier.
-- The register flow's hour-block dropdown always showed the international
-- tiers (5@$120 / 10@$105 / 15@$95). Classes held AT Higher Ground Learning
-- (open-enrollment in-person: school_id IS NULL AND delivery_mode =
-- 'in_person') get a domestic tier instead: 5@$100 · 10@$90 · 15@$80.
-- Mechanism is the same as the international tiers — rows in
-- tutoring_packages — selected by the new `tier` column.
-- Idempotent: safe to run twice.

alter table tutoring_packages
  add column if not exists tier text not null default 'international';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'tutoring_packages_tier_check'
  ) then
    alter table tutoring_packages
      add constraint tutoring_packages_tier_check
      check (tier in ('international', 'domestic'));
  end if;
end $$;

-- Domestic pre-class tiers. regular_hourly_rate 110 is inferred (no figure
-- in the request) — flagged for Scarlett; it only affects strike-through
-- "regularly $X/hour" copy, never the charged price.
insert into tutoring_packages (name, hours, hourly_rate, package_price, regular_hourly_rate, phase, active, tier)
select v.name, v.hours, v.rate, v.price, 110, 'pre_class', true, 'domestic'
from (values
  ('5-Hour Package (at HGL)', 5, 100, 500),
  ('10-Hour Package (at HGL)', 10, 90, 900),
  ('15-Hour Package (at HGL)', 15, 80, 1200)
) as v(name, hours, rate, price)
where not exists (
  select 1 from tutoring_packages p where p.name = v.name
);

notify pgrst, 'reload schema';
