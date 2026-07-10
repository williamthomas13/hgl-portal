-- =============================================================================
-- HGL Portal — Feature C3: follow-on class pointer
-- (docs/COMMS_ATTENDANCE_PARENT_SPEC.md §C3)
-- =============================================================================
-- Admin sets "Part 2" when creating the sequel class; the parent dashboard's
-- "you might be interested in" card prefers this pointer and falls back to
-- the open-classes-at-the-same-school heuristic. IDEMPOTENT.

alter table public.classes
  add column if not exists follow_on_class_id uuid references public.classes(id);

notify pgrst, 'reload schema';
