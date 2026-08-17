-- PL-376: the ACT Prep course set grows up.
--  A. course_meta — per-course metadata (display_name now; PL-378's
--     evergreen_code column rides along). "Act Prep" reads "HGL ACT Prep"
--     wherever the course display name composes; course_key/slug unchanged.
--  C. Hand-written class facts leave the copy: {instructionHours} (summed
--     from the class's real sessions, digit style — "8 hours"/"1 hour") and
--     {practiceTestCount} (the full pluralized phrase — "2 full-length
--     practice tests"/"1 full-length practice test", so grammar survives
--     any value) substitute on the /c pages beside {examName}/{address}.
--  D. The practice-tests block copy recast value-proof (the old
--     baseline/end-movement clause only held for exactly two tests).
-- PL-377 rule: touched blocks clear reviewed_by. IDEMPOTENT.

create table if not exists public.course_meta (
  course_key text primary key,
  display_name text,
  evergreen_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.course_meta is
  'PL-376/378: per-course metadata — display name (admin labels, sample pages) and the evergreen course link code.';

insert into public.course_meta (course_key, display_name)
select 'act-prep', 'HGL ACT Prep'
where not exists (select 1 from public.course_meta where course_key = 'act-prep');

-- C: hero-blurb facts → tokens.
update public.site_content_blocks
set body_markdown = replace(body_markdown,
      'Eight hours of expert instruction, two full practice tests with score reports (one before class even starts), all materials included',
      '{instructionHours} of expert instruction, {practiceTestCount} with score reports, all materials included'),
    reviewed_by = null, reviewed_at = null
where key = 'course:act-prep:hero-blurb'
  and body_markdown like '%Eight hours of expert instruction, two full practice tests%';

-- D: practice-tests copy recast value-proof + tokenized.
update public.site_content_blocks
set body_markdown = replace(body_markdown,
      'Two full-length, realistically timed practice ACTs anchor the class — one before your first session to establish a baseline, one near the end to measure real movement. Every test comes back',
      'The class is anchored by {practiceTestCount}, realistically timed. Every test comes back'),
    reviewed_by = null, reviewed_at = null
where key = 'course:act-prep:practice-tests'
  and body_markdown like '%Two full-length, realistically timed practice ACTs anchor the class%';

notify pgrst, 'reload schema';
