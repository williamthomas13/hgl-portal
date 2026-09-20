-- PL-457: silent import mode. An enrollment imported for a class whose
-- communications stay in the previous system (MailerLite finishes the four
-- live fall-2026 classes) must never receive a portal email — not the
-- lifecycle sequence, not a schedule-update, not a cancellation notice, not a
-- survey, not a follow-on campaign. The claim rows the import writes cover
-- every sequence step; this flag is the belt under those braces: sendOnce
-- (THE choke point every family-facing send passes through) refuses any send
-- keyed on a muted enrollment, and the two sends that don't key on an
-- enrollment id (bulk schedule updates, follow-on campaign seeding) skip
-- muted rows at their loops. Nothing reads it except those gates.
-- Idempotent.
alter table public.enrollments
  add column if not exists comms_muted boolean not null default false;

comment on column public.enrollments.comms_muted is
  'PL-457: true = the portal sends this enrollment''s family/student NOTHING (comms handled elsewhere). Set by scripts/import-class-registrations.mjs --silent; sendOnce refuses sends keyed on it.';

create index if not exists enrollments_comms_muted_idx
  on public.enrollments (id) where comms_muted;
