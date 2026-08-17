-- PL-373: shared blocks can carry an ONLINE image variant — the /c renderer
-- picks it when the class's delivery_mode is online AND a variant exists,
-- else the existing image (fail to the in-person photo, never to broken).
-- Same descriptor shape + the same required-alt rule as `image`. IDEMPOTENT.

alter table public.site_content_blocks add column if not exists image_online jsonb;

alter table public.site_content_blocks drop constraint if exists site_content_blocks_image_online_alt;
alter table public.site_content_blocks add constraint site_content_blocks_image_online_alt
  check (image_online is null or length(trim(coalesce(image_online->>'alt', ''))) > 0);

comment on column public.site_content_blocks.image_online is
  'PL-373: image shown when the class is ONLINE (descriptor like image). NULL = the main image renders for every delivery mode.';

notify pgrst, 'reload schema';
