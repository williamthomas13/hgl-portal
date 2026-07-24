-- PL-136: the dashboard system-health card needs one fact the database
-- doesn't otherwise hold — when the hourly cron sweep last completed.
--
-- A stalled sweep silently stops the ENTIRE email lifecycle: reminders,
-- sequences, digests, billing generation, coverage nudges. Nothing errors;
-- everything just quietly stops happening. The card turns that into a
-- number someone can see.
--
-- Stored as app_settings rows (configuration-shaped, no new table needed):
--   cron_sweep_started_at  — stamped when a sweep begins
--   cron_sweep_finished_at — stamped when it completes without throwing
-- The gap between them is also the honest signal for "a sweep is hanging".
--
-- Also seeds the daily Resend cap the card compares sends against. It is a
-- config value on purpose — the number changes when the plan upgrades, and
-- that should be an edit, not a deploy. Idempotent.

insert into public.app_settings (key, value)
values ('resend_daily_cap', '100')
on conflict (key) do nothing;
