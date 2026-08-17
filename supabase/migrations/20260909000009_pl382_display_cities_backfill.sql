-- PL-382: email time labels resolve through publicTimeCityLabel (school city
-- → display_cities → location city → HGL home for no-school in-person →
-- zone city). Online open classes need display_cities filled or their labels
-- fall to the IANA zone city ("Denver"/"Rome").
--
-- Backfill: the SAT Math Deep Dive's display_cities from its RECORDED feeder
-- schools' cities (Cape Town, Düsseldorf — the same list llms.txt already
-- publishes for it). Report-don't-invent: only classes whose feeders are on
-- record get filled; the R/W Deep Dive stays empty because its cities are an
-- open walkthrough item for Scarlett (batch-37/38) — until she fills them the
-- label says the zone city. IDEMPOTENT (only fills NULL/blank).

update public.classes c
set display_cities = sub.cities
from (
  select f.follow_on_class_id as id,
         string_agg(distinct s.city, ', ' order by s.city) as cities
  from public.classes f
  join public.schools s on s.id = f.school_id
  where f.follow_on_class_id is not null
    and s.city is not null
  group by f.follow_on_class_id
) sub
where c.id = sub.id
  and c.school_id is null
  and c.delivery_mode = 'online'
  and coalesce(trim(c.display_cities), '') = '';
