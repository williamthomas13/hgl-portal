-- PL-69: student pronouns — captured optionally at registration, tutoring
-- intake, and on the admin student record. NULLABLE on purpose: unset falls
-- back to exactly today's they/them copy, so existing students, QBO imports,
-- and public-capture signups keep working untouched. Idempotent.

alter table public.students
  add column if not exists pronouns text
  check (pronouns is null or pronouns in ('she_her', 'he_him', 'they_them'));
