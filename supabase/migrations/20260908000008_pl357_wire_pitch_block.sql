-- PL-357: the flow-only "1-on-1 tutoring pitch" block becomes the ONE
-- source for the registration flow's second-page upsell copy (it was an
-- orphan — edits went nowhere while the page carried hardcoded copy, the
-- PL-234 sample-vs-composer trap in page form).
--
-- Step 1 (here): make the block's copy EQUAL to what families currently see
-- on the live registration flow — the differences were one comma and one
-- sentence ("Choose your amount…") the flow had and the seed lacked. Only
-- the never-edited seed is rewritten (updated_by is null); if Scarlett has
-- edited the block, her copy is already the intended source and stands.
-- Step 2 (code, same commit): the registration page renders FROM this block
-- and the hardcoded copy is deleted — verified rendered-text-identical
-- before deletion.
-- IDEMPOTENT: re-runnable as a set.

update public.site_content_blocks
set body_markdown = $md$After the group class, the biggest point gains come from regular, individualized attention over several weeks. Our 1-on-1 tutoring sessions are tailored to each student and designed to overcome their specific weaknesses, exploit their strengths, and refine student-specific strategies. These sessions work in tandem with the group course, and are perfect for students who are taking the test multiple times, reaching for exceptionally high scores, or facing unique challenges. Students receiving 1-on-1 tutoring also receive unlimited access to online practice materials and extra diagnostic tests with score reports.

1-on-1 tutoring hours are only discounted when purchased alongside a group class. Choose your amount of 1-on-1 hours and we'll contact you to schedule them anytime based on your needs and availability. Hours are transferable and never expire.$md$
where key = 'one-on-one-pitch'
  and updated_by is null
  and body_markdown not like '%Choose your amount of 1-on-1 hours%';

notify pgrst, 'reload schema';
