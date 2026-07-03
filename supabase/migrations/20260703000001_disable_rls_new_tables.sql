-- =============================================================================
-- HGL Portal: Disable RLS on foundation tables
-- =============================================================================
-- The Supabase dashboard enabled Row-Level Security (with no policies) on the
-- tables created by 20260424000001_foundation_schema.sql, which silently blocks
-- every read and write from the app: schools can't be created, the schools
-- dropdown is empty, and sessions can't be added.
--
-- The foundation migration intentionally left RLS off (matching families,
-- students, classes, enrollments). Phase 3 (auth) will enable RLS everywhere
-- with real per-role policies. Until then, keep these consistent with the rest.
-- =============================================================================

alter table public.schools disable row level security;
alter table public.school_counselors disable row level security;
alter table public.sessions disable row level security;
