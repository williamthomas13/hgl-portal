-- PL-226: instructors get a phone number — captured on the consolidated
-- Contacts→Instructors add/edit surface, displayed anywhere staff contact
-- info shows (and tel:-linked per PL-231).
alter table instructors
  add column if not exists phone text;
