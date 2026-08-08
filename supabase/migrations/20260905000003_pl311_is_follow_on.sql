-- PL-311: explicit "follow-up class" flag. FO-ness was implicit (a class is
-- a follow-up because feeders point at it via follow_on_class_id); the flag
-- makes it explicit so the roster can show FO marketing controls ONLY on
-- follow-up classes and the feeder dropdown ONLY on non-follow-ups.
-- Backfill: any class some feeder points at is flagged. The column keeps the
-- fo_* internal naming family on purpose (PL-312 renames labels, not columns).
-- Idempotent.

alter table classes add column if not exists is_follow_on boolean not null default false;

update classes set is_follow_on = true
  where is_follow_on = false
    and id in (select follow_on_class_id from classes where follow_on_class_id is not null);

notify pgrst, 'reload schema';
