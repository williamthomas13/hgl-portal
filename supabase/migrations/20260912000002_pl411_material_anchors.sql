-- PL-411: materials get anchors so freshness is STATE-DRIVEN, not manually
-- curated — optionally tied to a session and/or a due date (neither
-- required). session_id is a PLAIN uuid, no FK, per the batch-40 rule (FKs
-- between much-embedded tables break PostgREST embeds — the API joins
-- app-side); a deleted session simply stops resolving and the N-day rule
-- takes over. Idempotent.

alter table student_materials add column if not exists session_id uuid;
alter table student_materials add column if not exists due_date date;

notify pgrst, 'reload schema';
