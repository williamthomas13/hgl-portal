-- =============================================================================
-- HGL Portal: addendum reconciliation — contacts.notes + class contact
-- assignments reference the AFFILIATION
-- =============================================================================
-- The original addendum file (hgl-phase4-admin-ux-addendum.md §6) surfaced
-- two details the July 7 build missed:
--   * contacts carries a free-text `notes` column (person-level, school-
--     independent).
--   * "Digest subscriptions, class contact assignments, and digest frequency
--     preferences reference the AFFILIATION, not the bare contact — past
--     records stay anchored to the school context they happened in." Digests
--     and prefs already live on the affiliation; this repoints
--     classes.counselor_id from contacts(id) to school_affiliations(id).
--
-- Data safety: migrated affiliations preserved the legacy counselor-row ids,
-- so any counselor_id written before the addendum ship is ALREADY a valid
-- affiliation id. Only classes created by the new wizard in the interim
-- (storing contact ids) need remapping to the contact's active affiliation
-- at the class's school; unmatchable values fall back to null = all school
-- contacts (verified: prod currently has zero non-null counselor_id rows).
--
-- IDEMPOTENT: guarded column add, no-op remaps, drop-then-add FK.
-- =============================================================================

-- 1. contacts.notes (addendum §6)
alter table public.contacts
  add column if not exists notes text;

-- 2. Remap contact-id values to the contact's active affiliation at the
--    class's school (no-op for affiliation ids and for re-runs).
update public.classes c
   set counselor_id = sa.id
  from public.school_affiliations sa
 where c.counselor_id is not null
   and c.counselor_id not in (select id from public.school_affiliations)
   and sa.contact_id = c.counselor_id
   and sa.school_id = c.school_id
   and sa.ended_at is null;

-- Anything still unmatchable (e.g. the affiliation was ended in the interim)
-- falls back to null = every contact at the school, the standard fallback.
update public.classes
   set counselor_id = null
 where counselor_id is not null
   and counselor_id not in (select id from public.school_affiliations);

-- 3. Repoint the FK: contacts(id) → school_affiliations(id)
alter table public.classes drop constraint if exists classes_counselor_id_fkey;
alter table public.classes
  add constraint classes_counselor_id_fkey
  foreign key (counselor_id) references public.school_affiliations(id) on delete set null;

-- PostgREST: pick up the new column + constraint
notify pgrst, 'reload schema';
