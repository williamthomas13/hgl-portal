-- PL-310 step 2: physically drop has_synap — apply ONLY AFTER the batch-32
-- deploy is live (no code references remain; the OR fold into
-- has_diagnostics happened in 20260905000001). Idempotent.

alter table classes drop column if exists has_synap;

notify pgrst, 'reload schema';
