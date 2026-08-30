-- PL-406: schools get a street address — the PL-399 maps resolver's school
-- branch reads it (school class + address on record → maps link to the
-- school; still honest absence when blank). Edited in the Schools card
-- editor ("Street address — used for the map link"). Idempotent.

alter table schools add column if not exists address text;

notify pgrst, 'reload schema';
