-- PL-378 (+amendment): public class discovery.
--   schools.evergreen_code   permanent /{code} → the school's newest open
--                            class (or a school-branded interest capture).
--   course_meta.evergreen_code (added in PL-376) — same for no-school
--                            courses; Scarlett picks the codes in admin.
--   legacy_redirects         the hgl.co registrar forwards that must survive
--                            the DNS cutover (portal serves each as a 301);
--                            admin-editable so they can be retired later.
-- Cross-namespace collision rules are enforced in the admin API (plain-
-- English refusals), not as DB constraints. IDEMPOTENT.

alter table public.schools add column if not exists evergreen_code text;
comment on column public.schools.evergreen_code is
  'PL-378 B: the school''s permanent link code (hgl.co/{code}) — newest open class, or the interest-capture page between classes. Never 404s.';

create table if not exists public.legacy_redirects (
  code text primary key,
  destination text not null,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.legacy_redirects is
  'PL-378 amendment: hgl.co registrar-level forwards preserved through the DNS cutover — served as 301s by the shortcode resolver. Known today: /act → the sqsp 1-on-1 ACT tutoring page.';

-- Seed the one forward we know today (Scarlett inventories the rest per the
-- cutover checklist; rows are hers to edit/retire in the Shortlinks panel).
insert into public.legacy_redirects (code, destination, note)
select 'act', 'https://highergroundlearning.com/act', 'registrar forward: 1-on-1 ACT tutoring page (inventoried Aug 16)'
where not exists (select 1 from public.legacy_redirects where code = 'act');

-- The evergreen capture is a NEW interest door — the source check learns it,
-- and course-level interest (no school) makes school_id nullable.
alter table public.class_interest alter column school_id drop not null;
alter table public.class_interest drop constraint if exists class_interest_source_check;
alter table public.class_interest add constraint class_interest_source_check
  check (source in ('cancellation', 'public_form', 'evergreen-link'));

notify pgrst, 'reload schema';
