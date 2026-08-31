-- PL-435: provenance for a class's meeting link. 'instructor_default' means
-- the machine applied the instructor's default meeting link (wizard at
-- creation, or the assignment paths now) — such a link re-applies when the
-- instructor changes and shows the "(your default link)" badge; NULL means
-- explicit/unknown (an admin- or counselor-set location is sacred and never
-- auto-touched). Legacy rows stay NULL deliberately: we cannot distinguish a
-- hand-typed link from an old auto-fill, and sacred-by-default is the safe
-- reading. Idempotent.
alter table public.classes
  add column if not exists default_location_source text
  check (default_location_source in ('instructor_default'));
comment on column public.classes.default_location_source is
  'instructor_default = auto-applied from the instructor''s default meeting link (re-applies on instructor change); NULL = explicitly set or legacy (never auto-touched)';
notify pgrst, 'reload schema';
