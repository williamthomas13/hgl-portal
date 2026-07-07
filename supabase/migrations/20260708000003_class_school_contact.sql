-- =============================================================================
-- HGL Portal: Phase 4 — optional per-class school contact (July 7 addition)
-- =============================================================================
-- classes.counselor_id: when set, class-specific sends (CR1–3 classroom
-- requests, final-days push, FP-alt, CX-C cancellation note) go to that
-- contact only; when blank, they fall back to every contact at the school.
-- Digests stay school-wide either way. Removing a counselor in the admin
-- panel nulls this out (on delete set null) → automatic fallback.
-- =============================================================================

alter table public.classes
  add column if not exists counselor_id uuid
  references public.school_counselors(id) on delete set null;

create index if not exists idx_classes_counselor_id on public.classes(counselor_id);

-- PostgREST: pick up the new column
notify pgrst, 'reload schema';
