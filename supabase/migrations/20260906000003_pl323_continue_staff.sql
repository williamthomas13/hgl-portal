-- PL-323C: when the portal can't reserve a family's continuation (conflict
-- or no workable recurring time), the choice routes to staff — this stamp
-- drives the dashboard to-do; it self-resolves once staff schedule sessions
-- after it. Idempotent.

alter table tutoring_engagements add column if not exists block_continue_staff_at timestamptz;

notify pgrst, 'reload schema';
