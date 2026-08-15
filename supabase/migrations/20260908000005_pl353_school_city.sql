-- PL-353: public time labels speak the class/school's OWN city, never the
-- IANA zone city ("Düsseldorf", not "Berlin"; "Salt Lake City", not
-- "Denver"). The zone id stays plumbing — admin surfaces keep it.
--
-- schools.city — the city families associate with the school; first choice
-- for every public time label. classes.display_cities — the PL-348
-- amendment's per-class city list for online classes (one per line or
-- comma-separated; the feeder-city automation builds on this later).
-- Resolution order (ONE source, dates.ts publicTimeCityLabel): school city →
-- class display_cities → city read from the location string (PL-305) →
-- generic zone city, last resort.
-- IDEMPOTENT: re-runnable as a set; seeds only fill NULLs, never overwrite.

alter table public.schools add column if not exists city text;
comment on column public.schools.city is
  'PL-353: the city families associate with this school — first choice for public time labels ("times shown in Düsseldorf time"). Editable on the Schools card.';

alter table public.classes add column if not exists display_cities text;
comment on column public.classes.display_cities is
  'PL-353/PL-348 amendment: city list an online class labels its times with (one per line or comma-separated), e.g. "Milan, Munich". Falls back to the zone city when empty.';

-- Seeds for the current schools. Cape Town / Düsseldorf / Munich are in the
-- school names; Mexico City / Santiago match their zone cities. Milan (St.
-- Louis School) is the school's well-documented home but is NOT derivable
-- from portal data — flagged for Scarlett to confirm on the Schools card
-- (without it the zone would mislabel SLS times as "Rome").
update public.schools set city = 'Cape Town'   where nickname = 'AISCT' and city is null;
update public.schools set city = 'Düsseldorf'  where nickname = 'ISD'   and city is null;
update public.schools set city = 'Munich'      where nickname = 'MIS'   and city is null;
update public.schools set city = 'Mexico City' where nickname = 'ASF'   and city is null;
update public.schools set city = 'Santiago'    where nickname = 'Nido'  and city is null;
update public.schools set city = 'Milan'       where nickname = 'SLS'   and city is null;

notify pgrst, 'reload schema';
