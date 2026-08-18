-- PL-384: ONE link model — a school/course has exactly one hgl.co code,
-- evergreen. The class-shortcode layer folds into the evergreen namespace:
--   · the four printed codes (isd / mis / nido / sls) become their schools'
--     evergreen_code, so the STRINGS survive unchanged;
--   · short_link_clicks keeps counting the SAME codes (honest history — the
--     counter is keyed by code text, no re-keying);
--   · short_links stops being read anywhere (phase 1 of the two-phase drop;
--     the table + classes.short_link/marketing_url columns drop in a later
--     batch after the post-drop grep).
-- Pin escape hatch: when two classes of one school/course are open at once
-- (fall still registering when spring opens), the code can pin to a specific
-- class; a closed pinned class falls back to auto-resolution. IDEMPOTENT.

-- Plain uuid, deliberately NO foreign key: an FK from schools→classes makes
-- every PostgREST `classes { schools(...) }` embed ambiguous (PGRST201) and
-- would break the app's joins. The admin API validates the pin (must be an
-- open class) and the resolver falls back when a pin goes stale.
alter table public.schools add column if not exists evergreen_pin_class_id uuid;
comment on column public.schools.evergreen_pin_class_id is
  'PL-384 C: optional pin — the code serves THIS class while it is open, instead of "newest open". Closed/deleted pin falls back to auto-resolution.';

alter table public.course_meta add column if not exists evergreen_pin_class_id uuid;
comment on column public.course_meta.evergreen_pin_class_id is
  'PL-384 C: optional pin for the course code — same fallback rules as the school pin.';

-- Belt for re-runs where the FK variant was applied first:
alter table public.schools drop constraint if exists schools_evergreen_pin_class_id_fkey;
alter table public.course_meta drop constraint if exists course_meta_evergreen_pin_class_id_fkey;

-- Fold the printed class shortcodes into their schools' evergreen codes.
-- Only fills blanks (a school that already picked an evergreen code wins),
-- and only from codes whose class HAS a school.
update public.schools s
set evergreen_code = sub.code
from (
  select distinct on (c.school_id) c.school_id, sl.code
  from public.short_links sl
  join public.classes c on c.id = sl.class_id
  where c.school_id is not null
  order by c.school_id, sl.created_at asc
) sub
where s.id = sub.school_id
  and s.evergreen_code is null;

notify pgrst, 'reload schema';
