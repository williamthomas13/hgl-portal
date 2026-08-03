-- PL-260: instructors can leave materials for an ENTIRE class — the same
-- student_materials machinery learns a class_id target. Exactly one of
-- (student_id, class_id) is set per row: student rows behave exactly as
-- before (PL-203), class rows are visible to every family with a student
-- enrolled in that class. Writes still go through /api/portal/materials
-- (service role, session-checked); RLS mirrors the API's rules for direct
-- reads. Idempotent.

alter table student_materials
  add column if not exists class_id uuid references classes(id) on delete cascade;

alter table student_materials alter column student_id drop not null;

do $$ begin
  alter table student_materials
    add constraint student_materials_one_target
    check ((student_id is null) <> (class_id is null));
exception when duplicate_object then null; end $$;

create index if not exists student_materials_class_idx on student_materials (class_id);

-- The class's instructor sees their class's shared materials.
do $$ begin
  create policy "instructor own class materials" on student_materials for select
    using (exists (
      select 1 from classes c
      join instructors i on i.id = c.instructor_id
      where c.id = student_materials.class_id and lower(i.email) = jwt_email()
    ));
exception when duplicate_object then null; end $$;

-- Families see class materials for classes their students are enrolled in
-- (any non-cancelled enrollment state — waitlisted families reading a
-- syllabus does no harm; refunds keep history visible like session notes).
do $$ begin
  create policy "parent enrolled class materials" on student_materials for select
    using (class_id in (
      select en.class_id from enrollments en
      where en.student_id in (select family_student_ids())
    ));
exception when duplicate_object then null; end $$;
