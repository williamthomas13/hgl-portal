-- PL-365: public display name for team/class-page surfaces. The portal row
-- keeps its internal name (timecards + QBO matching depend on "Billy
-- Thomas"); the PUBLIC surfaces (/team, the class pages' instructor cards,
-- their Person JSON-LD) render public_name when set, falling back to name.
-- Scarlett's verdict: Billy renders publicly as "William Thomas".
-- IDEMPOTENT: re-runnable.

alter table public.instructors add column if not exists public_name text;

comment on column public.instructors.public_name is
  'PL-365: display name on PUBLIC surfaces (/team, class pages). NULL = use name. The internal name stays authoritative for timecards/QBO matching.';

update public.instructors
set public_name = 'William Thomas'
where name = 'Billy Thomas' and public_name is null;

notify pgrst, 'reload schema';
