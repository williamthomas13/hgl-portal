-- PL-327: tutor email preferences. Operational emails (T5 timecards, T3-T
-- schedule changes, SUB coverage) stay mandatory and have no columns here.
-- Preference-able:
--   pref_notes_reminders — T6/T6-N session-notes reminders: on · weekly · off
--   pref_class_digests   — IN enrollment digests + milestone pings:
--                          on (digest + instant pings) · weekly (digest only)
--                          · off (neither; class calendar events stop too —
--                          same coupling the old toggle had)
--   pref_fyi_copies      — IN FYI copies of family logistics emails: on/off
-- The old admin-only "Class emails" toggle (comms_enabled) is ABSORBED:
-- its current values migrate as the starting state (off → digests off + FYI
-- off), the UI switch disappears, and the column is dropped post-deploy by
-- 20260906000005. Defaults: everything on (today's behavior for enabled
-- tutors). Idempotent.

alter table instructors add column if not exists pref_notes_reminders text not null default 'on';
alter table instructors add column if not exists pref_class_digests text not null default 'on';
alter table instructors add column if not exists pref_fyi_copies boolean not null default true;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'instructors_pref_notes_check') then
    alter table instructors add constraint instructors_pref_notes_check
      check (pref_notes_reminders in ('on', 'weekly', 'off'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'instructors_pref_digests_check') then
    alter table instructors add constraint instructors_pref_digests_check
      check (pref_class_digests in ('on', 'weekly', 'off'));
  end if;
end $$;

-- Absorb the old toggle exactly once: only rows that still have every pref
-- at its default get the fold (safe to re-run — the WHERE keeps it from
-- clobbering later edits).
update instructors
  set pref_class_digests = 'off', pref_fyi_copies = false
  where comms_enabled = false
    and pref_class_digests = 'on'
    and pref_fyi_copies = true;

notify pgrst, 'reload schema';
