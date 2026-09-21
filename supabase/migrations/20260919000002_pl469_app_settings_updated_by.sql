-- PL-469: settings edits record WHO changed them (no settings audit table
-- existed — updated_at alone). Additive, idempotent.
alter table public.app_settings
  add column if not exists updated_by text;
