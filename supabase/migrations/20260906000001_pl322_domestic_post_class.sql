-- PL-322: domestic pricing completion. Scarlett confirmed the domestic
-- regular rate IS $110 (the PL-307 inference). Seed the two domestic
-- post-class hourly rows with the same offsets the international rows use
-- (regular − $5 for 1–9h, regular − $15 for 10+): 110−5 → $105/hr and
-- 110−15 → $95/hr. Inserted the DERIVED way (base + discount; the PL-321
-- trigger computes hourly_rate/package_price), so a base change moves them.
-- Idempotent.

insert into tutoring_packages (name, hours, hourly_rate, package_price, regular_hourly_rate, discount_per_hour, phase, active, tier)
select v.name, v.hours, 0, 0, 110, v.discount, 'post_class', true, 'domestic'
from (values
  ('Post-Class Hourly (1-9 hours, at HGL)', 1, 5),
  ('Post-Class Hourly (10+ hours, at HGL)', 10, 15)
) as v(name, hours, discount)
where not exists (
  select 1 from tutoring_packages p where p.name = v.name
);

notify pgrst, 'reload schema';
