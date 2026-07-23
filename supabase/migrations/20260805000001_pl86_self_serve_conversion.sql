-- PL-86: self-serve cancellation→tutoring conversion. Who converted is part
-- of the record (Kelsie sees the current state before acting on a reply):
-- 'family' for the tokenized self-serve confirm, the staff email for the
-- Ops-Director one-click. Idempotent.

alter table public.enrollments
  add column if not exists converted_by text;

notify pgrst, 'reload schema';
