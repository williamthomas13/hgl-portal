-- PL-369: the "What's included" cards + FAQ copy must respect the class
-- record. Data side of the change (the renderer gates in /c/[slug]):
--
--  1. The strategy-session Q&A moves OUT of the shared faq-tutoring block
--     into its own block (faq-strategy) so the renderer can hide it for
--     no-school classes — same rule as the included-strategy card.
--  2. faq-general's "10 days before" sentence stops promising diagnostic
--     tests unconditionally.
--  3. fine-print-enrollment stops grouping students "according to initial
--     diagnostic scores" (wrong for no-diagnostics classes) — balanced
--     sections says the same thing exam-neutrally.
--
-- PL-377 rule: copy edits land UNREVIEWED again — reviewed_by clears on
-- every touched block; the new faq-strategy block starts unreviewed.
-- IDEMPOTENT: string guards make re-runs no-ops.

-- 1a. The new gated block (renders only for school classes).
insert into public.site_content_blocks (key, section, heading, body_markdown, sort_order, scope)
select 'faq-strategy', 'faq', 'The 30-minute strategy session', $md$### What is the 30-minute strategy session? And when can I schedule it?
Each student receives one strategy session with enrollment, during which the instructor will help you craft an individualized study and review plan, build a perfect SAT mindset, understand your diagnostic score report, or go over day-of test strategies. The strategy sessions usually work best when they're done after the first weekend of classes. During that first weekend of class, you can approach the instructor directly to find and schedule a time during the following week that's mutually agreeable. If you'd like to or need to do the strategy session earlier, however, just let us know and we can try to arrange it.$md$, 4, 'shared'
where not exists (select 1 from public.site_content_blocks where key = 'faq-strategy');

update public.site_content_blocks set sort_order = 5
where key = 'faq-tutoring' and sort_order = 4;

-- 1b. Remove the moved Q&A from faq-tutoring (exact-anchor guard).
update public.site_content_blocks
set body_markdown = replace(body_markdown, $md$### What is the 30-minute strategy session? And when can I schedule it?
Each student receives one strategy session with enrollment, during which the instructor will help you craft an individualized study and review plan, build a perfect SAT mindset, understand your diagnostic score report, or go over day-of test strategies. The strategy sessions usually work best when they're done after the first weekend of classes. During that first weekend of class, you can approach the instructor directly to find and schedule a time during the following week that's mutually agreeable. If you'd like to or need to do the strategy session earlier, however, just let us know and we can try to arrange it.

$md$, ''),
    reviewed_by = null, reviewed_at = null
where key = 'faq-tutoring'
  and body_markdown like '%What is the 30-minute strategy session%';

-- 2. faq-general: diagnostics promised only where the class includes them.
update public.site_content_blocks
set body_markdown = replace(
      body_markdown,
      'with more information about accessing the diagnostic tests and the classroom location or link.',
      'with more information — the classroom location or meeting link, and (for classes that include them) access to the diagnostic tests.'
    ),
    reviewed_by = null, reviewed_at = null
where key = 'faq-general'
  and body_markdown like '%about accessing the diagnostic tests and the classroom location or link.%';

-- 3. fine-print-enrollment: exam-neutral grouping wording.
update public.site_content_blocks
set body_markdown = replace(
      body_markdown,
      'students will be grouped according to initial diagnostic scores',
      'students will be split into balanced sections'
    ),
    reviewed_by = null, reviewed_at = null
where key = 'fine-print-enrollment'
  and body_markdown like '%grouped according to initial diagnostic scores%';

notify pgrst, 'reload schema';
