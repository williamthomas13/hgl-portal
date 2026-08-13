-- PL-337: how far ahead the drag-to-propose horizon summary checks the
-- proposed recurrence (weeks). Settings-driven like the other tutoring
-- knobs (DB-edited; no panel yet): default 12, the UI clamps to 26 max
-- (Scarlett wants up to 6 months). Longer horizons are ALWAYS stitched
-- from sequential freebusy calls — the route caps one request at 45 days
-- and Google's own cap is ~3 months. Idempotent.

insert into public.app_settings (key, value)
values ('tutoring_proposal_horizon_weeks', '12')
on conflict (key) do nothing;

notify pgrst, 'reload schema';
