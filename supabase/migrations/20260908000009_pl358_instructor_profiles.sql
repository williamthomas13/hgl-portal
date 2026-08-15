-- PL-358: instructor profiles = ONE source. The instructors table (the one
-- table — PL-91 two-flags rule, non-teaching staff live here too) gains the
-- public-profile fields; the public /team page and the class pages' featured
-- instructor cards both GENERATE from these rows. Editing happens in one
-- place: the instructor profile editor (Contacts → Instructors).
--
--   headshot            PL-351 image descriptor (alt required, webp
--                       renditions in the class-pages bucket under team/…)
--   credential          the one-line credential ("Executive Director",
--                       "International SAT, Math")
--   show_on_team        renders on /team (with team_order)
--   featured_on_classes renders in the class pages' instructors section
--
-- Also: the shared 'instructors' class-page block stops hand-naming people —
-- its body becomes the INTRO line only (cards render from profiles). Only
-- the never-edited seed is rewritten. IDEMPOTENT: re-runnable as a set.

alter table public.instructors add column if not exists headshot jsonb;
alter table public.instructors add column if not exists credential text;
alter table public.instructors add column if not exists show_on_team boolean not null default false;
alter table public.instructors add column if not exists team_order int;
alter table public.instructors add column if not exists featured_on_classes boolean not null default false;

alter table public.instructors drop constraint if exists instructors_headshot_alt;
alter table public.instructors add constraint instructors_headshot_alt
  check (headshot is null or length(trim(coalesce(headshot->>'alt', ''))) > 0);

comment on column public.instructors.headshot is
  'PL-358: public headshot descriptor (class-page-images shape, alt required). Renders on /team and the class pages.';
comment on column public.instructors.credential is
  'PL-358: one-line public credential ("Executive Director", "International SAT, Math").';
comment on column public.instructors.show_on_team is
  'PL-358: renders on the public /team page (ordered by team_order, then name).';
comment on column public.instructors.featured_on_classes is
  'PL-358: renders as a card in the class pages'' instructors section.';

update public.site_content_blocks
set body_markdown = $md$Our instructors come from the world's top universities and have taught these tests for years.

[Meet the whole team](https://highergroundlearning.com/team)$md$
where key = 'instructors' and updated_by is null and body_markdown like '%Eric Brown (Princeton)%';

notify pgrst, 'reload schema';
