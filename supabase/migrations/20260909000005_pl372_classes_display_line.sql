-- PL-372: the class-page featured cards show DIFFERENT text under the name
-- than /team does — the schools the instructor teaches at ("ASF · ISD") vs
-- the job title. Free text, Scarlett-edited (deliberately NOT derived from
-- assignments — the display list may not equal the assignment list); blank
-- falls back to credential so nothing regresses. /team and its Person
-- JSON-LD keep using credential untouched. IDEMPOTENT.

alter table public.instructors add column if not exists classes_display_line text;

comment on column public.instructors.classes_display_line is
  'PL-372: line under the name on /c featured cards (e.g. "ASF · ISD"). Blank = the credential renders (as /team always does).';

notify pgrst, 'reload schema';
