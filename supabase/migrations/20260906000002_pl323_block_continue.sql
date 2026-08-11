-- PL-323: block-ending continue flow v2 (extends PL-299's state machine).
--   block_continue_hours  — the family's chosen continuation block (5/10/15);
--                           NULL on 'confirmed' = "until I cancel" (monthly).
--   block_continue_rate   — the provenance-correct post-class rate recorded
--                           at choice time (a later price-list edit never
--                           rewrites what the family was told).
--   block_ask_cycle       — increments each time a continuation nears its
--                           own end and the ask goes out again (dedupe key
--                           carries it; "continue" is a choice, never
--                           perpetuity).
--   block_dropped_at      — when the auto-drop released this engagement's
--                           unconfirmed sessions past the block (idempotence
--                           marker; also the dashboard's plain-English fact).
-- Idempotent.

alter table tutoring_engagements add column if not exists block_continue_hours numeric;
alter table tutoring_engagements add column if not exists block_continue_rate numeric;
alter table tutoring_engagements add column if not exists block_ask_cycle integer not null default 0;
alter table tutoring_engagements add column if not exists block_dropped_at timestamptz;

notify pgrst, 'reload schema';
