-- PL-351: the public class pages' content blocks get pictures. One jsonb
-- image descriptor per block (and a per-class hero photo on classes):
--   { "path": "blocks/included-exams/....webp",  -- largest rendition
--     "alt": "…",                                 -- REQUIRED (enforced below)
--     "layout": "left" | "right" | "hero",        -- blocks only
--     "width": 1600, "height": 1067,              -- explicit dims, no reflow
--     "variants": [ { "path": "…-480w.webp", "width": 480 }, … ] }
-- Files live in a NEW public-read Supabase Storage bucket ('class-pages'),
-- uploaded through the portal — NEVER hotlinked from Squarespace's CDN.
-- Variants are generated at upload time (sharp) so the page can serve a
-- real srcset without an image-transformation service.
-- IDEMPOTENT: re-runnable as a set.

alter table public.site_content_blocks add column if not exists image jsonb;
comment on column public.site_content_blocks.image is
  'PL-351: optional block image descriptor {path, alt (required), layout left|right|hero, width, height, variants[{path,width}]} — files in the class-pages bucket.';

alter table public.site_content_blocks drop constraint if exists site_content_blocks_image_alt;
alter table public.site_content_blocks add constraint site_content_blocks_image_alt
  check (image is null or length(trim(coalesce(image->>'alt', ''))) > 0);

alter table public.classes add column if not exists hero_image jsonb;
comment on column public.classes.hero_image is
  'PL-351: optional per-class hero photo, same descriptor shape as site_content_blocks.image (no layout).';

alter table public.classes drop constraint if exists classes_hero_image_alt;
alter table public.classes add constraint classes_hero_image_alt
  check (hero_image is null or length(trim(coalesce(hero_image->>'alt', ''))) > 0);

-- Bucket + policies, same shape as school-assets (phase 4.5): public read,
-- staff-only writes; the portal's upload route uses the service role anyway.
insert into storage.buckets (id, name, public)
values ('class-pages', 'class-pages', true)
on conflict (id) do nothing;

drop policy if exists "class pages public read" on storage.objects;
create policy "class pages public read" on storage.objects
  for select using (bucket_id = 'class-pages');

drop policy if exists "class pages staff insert" on storage.objects;
create policy "class pages staff insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'class-pages' and public.is_staff());

drop policy if exists "class pages staff update" on storage.objects;
create policy "class pages staff update" on storage.objects
  for update to authenticated
  using (bucket_id = 'class-pages' and public.is_staff())
  with check (bucket_id = 'class-pages' and public.is_staff());

drop policy if exists "class pages staff delete" on storage.objects;
create policy "class pages staff delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'class-pages' and public.is_staff());

notify pgrst, 'reload schema';
