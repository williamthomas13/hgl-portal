-- PL-371: shared class-page blocks stop hand-writing "SAT" — {examName} /
-- {examRegistrationLink} substitute per class (PL-368's one switch, PSAT
-- included). Judgment, not find-replace: genuine both-exam comparisons stay
-- literal; the PSAT FAQ is recast for a world where PSAT classes exist; the
-- two SAT-specific sample-PDF links stay (no ACT artifact exists — flagged).
-- PL-377 rule: every touched block clears reviewed_by (unreviewed again).
-- IDEMPOTENT: exact-anchor guards.

-- faq-diagnostics: three "real SAT" mentions → the class's exam.
update public.site_content_blocks
set body_markdown = replace(replace(replace(body_markdown,
      'it most closely mimics the experience of taking the real SAT.',
      'it most closely mimics the experience of taking the real {examName}.'),
      '### I recently took the real SAT. Can I use my test results',
      '### I recently took the real {examName}. Can I use my test results'),
      'than what you received from your real SAT administration.',
      'than what you received from your real {examName} administration.'),
    reviewed_by = null, reviewed_at = null
where key = 'faq-diagnostics'
  and body_markdown like '%taking the real SAT.%';

-- faq-strategy: "a perfect SAT mindset" → the class's exam.
update public.site_content_blocks
set body_markdown = replace(body_markdown,
      'build a perfect SAT mindset',
      'build a perfect {examName} mindset'),
    reviewed_by = null, reviewed_at = null
where key = 'faq-strategy'
  and body_markdown like '%build a perfect SAT mindset%';

-- included-strategy: "maximize SAT success" → the class's exam.
update public.site_content_blocks
set body_markdown = replace(body_markdown,
      'strategy to maximize SAT success.',
      'strategy to maximize {examName} success.'),
    reviewed_by = null, reviewed_at = null
where key = 'included-strategy'
  and body_markdown like '%maximize SAT success.%';

-- included-tutoring: "point gains on the SAT" → the class's exam.
update public.site_content_blocks
set body_markdown = replace(body_markdown,
      'designed to maximize point gains on the SAT.',
      'designed to maximize point gains on the {examName}.'),
    reviewed_by = null, reviewed_at = null
where key = 'included-tutoring'
  and body_markdown like '%point gains on the SAT.%';

-- faq-general: the exam-registration Q&A goes through the one switch
-- (question names the class's exam; the answer's link machinery handles
-- PSAT's school-based registration honestly).
update public.site_content_blocks
set body_markdown = replace(replace(body_markdown,
      '### Does enrolling in this course also register me for the SAT or ACT?',
      '### Does enrolling in this course also register me for the {examName}?'),
      'NO. You must register for official exams through the College Board (SAT) or the ACT organization (ACT). Please refer to each organization''s respective website, and in particular navigate to the pages for international students.',
      'NO. You must register for official exams through [the official {examName} registration site]({examRegistrationLink}) — international students in particular should use the international-testing pages there.'),
    reviewed_by = null, reviewed_at = null
where key = 'faq-general'
  and body_markdown like '%register me for the SAT or ACT?%';

-- faq-general: the PSAT FAQ recast now that dedicated PSAT classes exist
-- (PL-368 made PSAT a real examName; "just join an SAT course" was written
-- when there was nothing else to join).
update public.site_content_blocks
set body_markdown = replace(body_markdown,
      'We do, indeed! The PSAT is essentially just a shorter version of the SAT, so we actually recommend that PSAT students simply join an SAT course – the content and strategy covered in an SAT course will apply equally to the shorter test.',
      'We do, indeed! The PSAT is essentially just a shorter version of the SAT, so both paths work: join a dedicated PSAT class when one is offered, or join an SAT course – the content and strategy covered there apply equally to the shorter test.'),
    reviewed_by = null, reviewed_at = null
where key = 'faq-general'
  and body_markdown like '%simply join an SAT course%';

notify pgrst, 'reload schema';
