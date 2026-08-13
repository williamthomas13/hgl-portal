-- PL-335: "Run this class anyway" becomes a RECORDED decision. The Needs
-- Attention row (paid < min && deadline within 3 days) adds
-- `and min_enrollment_decision is null`, so the decision clears the row
-- permanently; clearing the decision (undo, while the deadline hasn't
-- passed) re-arms it. Extend stays a plain deadline move — the state-driven
-- check keeps working against the new date (snooze, not dismissal).
-- Idempotent.

alter table public.classes
  add column if not exists min_enrollment_decision text
    check (min_enrollment_decision in ('run_anyway')),
  add column if not exists min_enrollment_decided_at timestamptz,
  add column if not exists min_enrollment_decided_by text;

notify pgrst, 'reload schema';
