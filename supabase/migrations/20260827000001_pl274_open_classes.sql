-- PL-274: open-enrollment classes (no school). classes.school_id was always
-- nullable — the coupling was app-level. What the schema still needed:
--
--   classes.timezone       — school-less classes have no schools.timezone to
--                            inherit; precedence everywhere becomes
--                            coalesce(classes.timezone, schools.timezone,
--                            default). In-person-at-HGL defaults to
--                            America/Denver; online asks at creation.
--   classes.has_diagnostics — amendment B: per-class switch; follow-on
--   classes.has_synap        classes often have neither, in-person-at-HGL
--                            may have diagnostics without Synap. Both
--                            independent, wizard + roster editable, default
--                            TRUE so every existing class keeps its exact
--                            current behavior.
--   instructors.bio        — amendment F: the family-facing instructor
--                            introduction paragraph ({instructorBio}) for
--                            open-class details emails. Empty = the
--                            paragraph drops cleanly.
--
-- Idempotent.

alter table classes add column if not exists timezone text;
alter table classes add column if not exists has_diagnostics boolean not null default true;
alter table classes add column if not exists has_synap boolean not null default true;
alter table instructors add column if not exists bio text;
