-- PL-203: family-facing shared materials — practice packets, links, "before
-- next session" notes. Per-student (not per-session, deliberately simple).
-- Writes go through /api/portal/materials (service role, session-checked);
-- reads run under RLS on the same patterns as session_notes. Idempotent.

create table if not exists student_materials (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references students(id) on delete cascade,
  instructor_email text not null,
  instructor_name text,
  kind text not null check (kind in ('file', 'link')),
  title text not null,
  url text,           -- kind='link'
  storage_path text,  -- kind='file' (private bucket; served via signed URLs)
  note text,
  created_at timestamptz not null default now()
);

alter table student_materials enable row level security;

do $$ begin
  create policy "staff all" on student_materials for all
    using (is_staff()) with check (is_staff());
exception when duplicate_object then null; end $$;

-- The tutor/instructor who shared it manages it; any tutor of the student
-- can see what the family has (substitutes prep from it too).
do $$ begin
  create policy "tutor read taught students" on student_materials for select
    using (exists (
      select 1 from tutoring_sessions ts
      join instructors i on i.id = ts.tutor_id
      where ts.student_id = student_materials.student_id and lower(i.email) = jwt_email()
    ) or exists (
      select 1 from enrollments en
      join classes c on c.id = en.class_id
      join instructors i on i.id = c.instructor_id
      where en.student_id = student_materials.student_id and lower(i.email) = jwt_email()
    ));
exception when duplicate_object then null; end $$;

-- Families see ONLY their own student's materials.
do $$ begin
  create policy "parent own students materials" on student_materials for select
    using (student_id in (select family_student_ids()));
exception when duplicate_object then null; end $$;

-- Private storage bucket; files are served exclusively through signed URLs
-- minted by the API after its own session check.
insert into storage.buckets (id, name, public)
values ('student-materials', 'student-materials', false)
on conflict (id) do nothing;
