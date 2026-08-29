-- PL-384 step 2: physically drop marketing_url — apply ONLY AFTER the
-- batch-40 deploy is live (phase 1, 20260910000001, retired every read; the
-- class page URL is composed from the code link, never hand-typed). The
-- post-drop grep ran in batch 41: comment-only references remain. Idempotent.
-- classes.short_link is NOT drop-ready (collateral still reads it as the
-- pre-fold fallback) and stays.

alter table classes drop column if exists marketing_url;

notify pgrst, 'reload schema';
