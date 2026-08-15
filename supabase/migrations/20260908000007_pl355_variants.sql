-- PL-355: the class-page variant machinery (the resolved PL-348 amendment).
--
-- COURSE KEY MODELING (the "say what you chose" note): classes.course_key is
-- a stored slug, DERIVED from class_type at creation for open-enrollment
-- classes (slugify("SAT Deep Dive: …") — school classes carry NULL: their
-- pages share the evergreen set and must never cross-link other schools'
-- runs). Derived-from-type is the simplest thing that survives the clone/
-- duplicate flows: duplicates copy class_type, so re-runs land on the same
-- key with zero extra fields to remember. Trade-off, documented: renaming
-- class_type for a re-run changes the key (and the block set it inherits) —
-- the mint/copy admin action covers that deliberately.
--
-- Block scopes: shared (every page — the existing rows), course (every class
-- whose course_key matches — inheritance IS the render rule, nothing is
-- copied), class (one class only). Course/class rows render between the
-- schedule and the what's-included grid; key suffixes ':hero-blurb' (renders
-- inside the hero) and ':location' (the in-person location frame) are the
-- two special placements.
-- IDEMPOTENT: re-runnable as a set; the fine-print rewrite only touches the
-- never-edited seed (updated_by is null) so Scarlett's edits always win.

alter table public.classes add column if not exists course_key text;
comment on column public.classes.course_key is
  'PL-355: course identity slug for open-enrollment classes (derived from class_type at creation; NULL for school classes). Drives course-type block inheritance and sibling-section cross-links.';

alter table public.classes add column if not exists prerequisite_note text;
comment on column public.classes.prerequisite_note is
  'PL-355: per-class prerequisite line ("For students who completed an SAT Prep class"), rendered near the hero bullets on /c.';

-- Backfill existing open-enrollment classes with the same derivation the
-- wizard uses (lowercase, non-alphanumerics collapsed to dashes, trimmed).
update public.classes
set course_key = trim(both '-' from lower(regexp_replace(class_type, '[^a-zA-Z0-9]+', '-', 'g')))
where school_id is null and course_key is null and class_type is not null;

alter table public.site_content_blocks add column if not exists scope text not null default 'shared';
alter table public.site_content_blocks add column if not exists course_key text;
alter table public.site_content_blocks add column if not exists class_id uuid references public.classes(id) on delete cascade;

alter table public.site_content_blocks drop constraint if exists site_content_blocks_scope_check;
alter table public.site_content_blocks add constraint site_content_blocks_scope_check
  check (scope in ('shared', 'course', 'class'));
alter table public.site_content_blocks drop constraint if exists site_content_blocks_scope_target;
alter table public.site_content_blocks add constraint site_content_blocks_scope_target
  check (
    (scope = 'shared' and course_key is null and class_id is null)
    or (scope = 'course' and course_key is not null and class_id is null)
    or (scope = 'class' and class_id is not null and course_key is null)
  );

comment on column public.site_content_blocks.scope is
  'PL-355: shared = every class page; course = classes whose course_key matches (automatic inheritance); class = one class only.';

-- ---------------------------------------------------------------------------
-- "ACT Prep @ HGL" course-type block set — seeded from the batch-36 DRAFT
-- copy (Claude, Aug 14). UNREVIEWED: updated_by stays NULL so the blocks
-- admin flags every one as "seeded copy — not yet reviewed" for Scarlett's
-- walkthrough. A wizard-created class with class_type "ACT Prep" derives
-- course_key 'act-prep' and inherits these automatically.
-- ---------------------------------------------------------------------------

insert into public.site_content_blocks (key, section, heading, body_markdown, sort_order, scope, course_key) values

('course:act-prep:hero-blurb', 'course', '', $md$Our ACT Prep class unlocks the best strategies and covers the most important content on the test — without requiring a huge commitment. Eight hours of expert instruction, two full practice tests with score reports (one before class even starts), all materials included, plus a free hour of 1-on-1 instruction to make the strategies your own.$md$, 0, 'course', 'act-prep'),

('course:act-prep:built-around', 'course', 'Built Around How the ACT Actually Works', $md$The ACT rewards speed, pattern recognition, and knowing exactly what each section is really asking. This class focuses on the highest-leverage skills: pacing strategies for the ACT's famously tight time limits, the grammar and punctuation rules English tests over and over, the math content that appears on every single exam, and how to read passages the way the test wants you to — quickly, and for structure. Students leave knowing not just the content, but how to take this test.$md$, 1, 'course', 'act-prep'),

('course:act-prep:topics', 'course', 'Sample of Topics Covered', $md$- **English:** comma and punctuation rules, subject-verb agreement, concision and rhetorical skill questions
- **Math:** pre-algebra through trigonometry essentials, word-problem translation, calculator strategy
- **Reading:** passage mapping, time management across four passages, evidence questions
- **Science:** trend-spotting in charts and tables, conflicting-viewpoints passages, why it's really a reading test
- **Test-wide:** guessing strategy (no penalty!), pacing drills, section-order stamina$md$, 2, 'course', 'act-prep'),

('course:act-prep:practice-tests', 'course', 'Practice Tests That Mean Something', $md$Two full-length, realistically timed practice ACTs anchor the class — one before your first session to establish a baseline, one near the end to measure real movement. Every test comes back as a full score report showing exactly where points were left on the table, and your instructor builds class time around what the reports reveal. Your included 1-on-1 hour turns your student's own report into a personal game plan.$md$, 3, 'course', 'act-prep'),

('course:act-prep:location', 'course', 'Where we meet', $md$This class meets in person at our HQ in downtown Salt Lake City — {address}.$md$, 4, 'course', 'act-prep')

on conflict (key) do nothing;

-- Exam name becomes a VARIABLE in the shared exam-registration fine print
-- (one block, no SAT/ACT fork). Only the untouched seed is rewritten —
-- if Scarlett has edited the block, her copy stands and this is a no-op.
update public.site_content_blocks
set heading = 'Exam registration',
    body_markdown = $md$Enrollment in a prep course DOES NOT register your student for the {examName}. Parents/Guardians are responsible for enrolling their student(s). Visit [the official {examName} registration site]({examRegistrationLink}) for upcoming test dates and registration information. Registration for the test is on a first come first serve basis, so please register early to be guaranteed a seat.$md$
where key = 'fine-print-sat' and updated_by is null and body_markdown not like '%{examName}%';

notify pgrst, 'reload schema';
