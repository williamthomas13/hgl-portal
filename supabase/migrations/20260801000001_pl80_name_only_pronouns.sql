-- PL-80: fourth pronoun option — 'name_only' (UI label: "Something else /
-- rather not say"). Renders the name-based forms everywhere a pronoun would
-- appear ("Ana has", "Ana's hard work"); never a wrong pronoun, never new
-- copy. NULL stays NULL (they/them fallback, PL-69 byte-identity untouched).
-- Idempotent: drop-and-recreate the check constraint.

alter table public.students
  drop constraint if exists students_pronouns_check;

alter table public.students
  add constraint students_pronouns_check
  check (pronouns is null or pronouns in ('she_her', 'he_him', 'they_them', 'name_only'));
