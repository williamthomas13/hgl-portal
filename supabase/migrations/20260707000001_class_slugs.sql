-- =============================================================================
-- HGL Portal: human-readable class slugs
-- =============================================================================
-- Each class gets a dedicated registration URL /register/{slug} for
-- Squarespace buttons and print. Auto-generated from school nickname +
-- class type + term (season+year from start_date); editable in admin.
-- =============================================================================

alter table public.classes
  add column if not exists slug text unique;

-- Backfill existing classes: nickname-classtype-term, slugified.
update public.classes c
   set slug = trim(both '-' from
     regexp_replace(
       lower(
         coalesce((select s.nickname from public.schools s where s.id = c.school_id), c.school_nickname, 'hgl')
         || '-' || c.class_type || '-' ||
         case
           when extract(month from c.start_date) between 1 and 4 then 'spring'
           when extract(month from c.start_date) between 5 and 7 then 'summer'
           when extract(month from c.start_date) between 8 and 10 then 'fall'
           else 'winter'
         end || to_char(c.start_date, 'YY')
       ),
       '[^a-z0-9]+', '-', 'g'
     ))
 where slug is null;
