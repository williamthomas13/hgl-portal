-- PL-377: Scarlett approved ALL current class-page block copy (Aug 16).
-- A review is not an edit — a dedicated marker (reviewed_by/reviewed_at)
-- records the approval honestly instead of faking updated_by. The admin
-- badges key on "updated_by IS NULL AND reviewed_by IS NULL"; a later
-- copy-rewording script CLEARS reviewed_by so its blocks re-raise badges
-- (approval covers today's copy, not future edits). IDEMPOTENT.

alter table public.site_content_blocks add column if not exists reviewed_by text;
alter table public.site_content_blocks add column if not exists reviewed_at timestamptz;

comment on column public.site_content_blocks.reviewed_by is
  'PL-377: who approved this copy as-is (a review, not an edit — updated_by stays honest). NULL + updated_by NULL = the unreviewed badge.';

-- One-time stamp: every block currently carrying the badge is approved by
-- Scarlett as of Aug 16, 2026. Blocks she has EDITED already show her as
-- updated_by and never carried a badge — untouched.
update public.site_content_blocks
set reviewed_by = 'Scarlett', reviewed_at = '2026-08-16T12:00:00-06:00'
where updated_by is null and reviewed_by is null;

notify pgrst, 'reload schema';
