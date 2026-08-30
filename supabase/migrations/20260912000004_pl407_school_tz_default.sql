-- PL-407: the schools.timezone COLUMN default was the last Mexico-City
-- relic — a new school row created without an explicit timezone silently
-- landed on America/Mexico_City, which then OUTRANKS the code fallback in
-- every precedence chain. New-school default becomes America/Denver
-- ("Salt Lake City time" per PL-398); existing rows keep their real,
-- explicitly-set timezones. Idempotent.

alter table schools alter column timezone set default 'America/Denver';

notify pgrst, 'reload schema';
