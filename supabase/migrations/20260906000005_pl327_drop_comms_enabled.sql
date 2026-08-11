-- PL-327 step 2: drop the absorbed comms_enabled column — apply ONLY AFTER
-- the batch-33 deploy is live (the old build's selects name it). Idempotent.

alter table instructors drop column if exists comms_enabled;

notify pgrst, 'reload schema';
