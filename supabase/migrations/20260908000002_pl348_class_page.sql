-- PL-348: portal-hosted public class pages at /c/{slug}.
--
-- 1) classes.selling_bullets — the per-class selling bullets shown in the
--    page hero (one bullet per line; edited on the wizard's Branding &
--    Collateral step and the Collateral card). Marketing FACTS like price
--    and deadline always render from the class record, never from here.
-- 2) site_content_blocks — the evergreen persuasion content SHARED by every
--    class page (what's included, 1-on-1 pitch, instructors, FAQs, closing
--    CTA, fine print, honest-state copy): edit once, every page updates.
--    Seeded below from the current Squarespace /classes/p/* + per-school
--    landing-page copy for Scarlett's approval (notes flag the spots where
--    the old copy described the Squarespace cart flow and was rewritten for
--    the portal's register flow).
--
-- Public pages read via the server-side service role (anon has no policies);
-- staff edit via the staff-gated /api/admin/site-content route.
-- IDEMPOTENT: re-runnable as a set (seeds are on conflict do nothing — a
-- re-run never clobbers Scarlett's edits).

alter table public.classes add column if not exists selling_bullets text;
comment on column public.classes.selling_bullets is
  'PL-348: hero bullets on the public /c/{slug} page, one per line. Facts like price/deadline render from the record, never from this text.';

create table if not exists public.site_content_blocks (
  key text primary key,
  section text not null,
  heading text not null default '',
  body_markdown text not null default '',
  sort_order int not null default 0,
  updated_at timestamptz not null default now(),
  updated_by text
);
comment on table public.site_content_blocks is
  'PL-348: evergreen shared content for the public class pages (/c/{slug}) — written once, rendered on every class page. Sections: included, pitch, instructors, faq, closing, fine-print, states.';

alter table public.site_content_blocks enable row level security;
drop policy if exists "staff all" on public.site_content_blocks;
create policy "staff all" on public.site_content_blocks
  for all using (public.is_staff()) with check (public.is_staff());

-- ---------------------------------------------------------------------------
-- Seeds (Squarespace copy, captured Aug 15 2026; FAQ duplicates across
-- categories deduped into their natural home).
-- ---------------------------------------------------------------------------

insert into public.site_content_blocks (key, section, heading, body_markdown, sort_order) values

('included-instruction', 'included', 'Live class instruction', $md$Another way to say "standardized" is "predictable." The SAT not only tests the same topics every time, it tests those topics in the exact same fashion. We've spent countless hours studying and teaching these tests, which means we know exactly what's on the test, what it will look like, and how to succeed. From broad strategies to exploitable quirks, our instructors have the inside knowledge that turns these tests from mysterious monster to conquerable foe.

[Preview our curriculum](https://highergroundlearning.com/s/HGL-Digital-SAT-Curriculum-Sample.pdf)$md$, 1),

('included-strategy', 'included', '30-minute strategy sessions', $md$All students have the opportunity to schedule a free 30-minute individual strategy session with a Higher Ground Learning instructor. These sessions are perfect to use to understand their diagnostic score reports, identify strengths and weaknesses, and form an individualized strategy to maximize SAT success.$md$, 2),

('included-exams', 'included', 'Full-length practice exams', $md$The course includes two full-length exams to gauge each student's starting scores, strengths, and weaknesses. By periodically tackling representative tests, students can put what they've learned into practice, solidifying content and strategies. In addition, each diagnostic exam comes with a detailed breakdown of student performance on specific question types and categories, giving both students and instructors valuable tools to drive improvement.

[Preview a score report](https://highergroundlearning.com/s/Digital-SAT-Diagnostic-Sample-Score-Report.pdf)$md$, 3),

('included-tutoring', 'included', '1-on-1 tutoring', $md$We never lose sight of the individual student. One student's "easy points" might be another student's nightmare, so every student gets the opportunity to work 1-on-1 with their instructor. By supplementing group instruction with flexible 1-on-1 tutoring sessions, we ensure that every student finds the path to their best score. Students can choose the amount of 1-on-1 hours they'd like to do and schedule the sessions whenever they'd like. All sessions are individually tailored to the exact needs of each student and designed to maximize point gains on the SAT.

[More about 1-on-1 tutoring](https://highergroundlearning.com/sat)$md$, 4),

('one-on-one-pitch', 'pitch', 'Keep improving after the class', $md$After the group class the biggest point gains come from regular, individualized attention over several weeks. Our 1-on-1 tutoring sessions are tailored to each student and designed to overcome their specific weaknesses, exploit their strengths, and refine student-specific strategies. These sessions work in tandem with the group course, and are perfect for students who are taking the test multiple times, reaching for exceptionally high scores, or facing unique challenges. Students receiving 1-on-1 tutoring also receive unlimited access to online practice materials and extra diagnostic tests with score reports.

1-on-1 tutoring hours are only discounted when purchased alongside a group class. Hours are transferable and never expire.$md$, 1),

('instructors', 'instructors', 'Our instructors', $md$Our instructors come from the world's top universities and have taught these tests for years — Eric Brown (Princeton), Jason Topa (Brown), Kevin Marren (Duke), Alexa Jordan (Harvard), and more.

[Meet the whole team](https://highergroundlearning.com/team)$md$, 1),

('faq-general', 'faq', 'General', $md$### I registered but I haven't received any confirmation or information about the course. What should I do?
Your registration is only confirmed once you've completed the registration form and paid the course fee. Immediately after paying you'll receive an automated email from us confirming your student's registration. We'll follow up again about 10 days before the course starts with more information about accessing the diagnostic tests and the classroom location or link. If you paid and can't find the confirmation email, check your spam folder — and if it's truly missing, get in touch and we'll sort it out.

### Must I attend all the sessions, or do I choose just one session that I want to attend?
All of the class sessions cover different material, and students are expected to attend every session that is listed on the course calendar.

### What time are classes scheduled?
Most classes are held on weekends or after school for around 2 hours, 2-3 days a week, for 2-3 weeks. However, every school has a unique schedule, so be sure to check the schedule above for details. Also note that there are full-length practice exams included and optional (but highly recommended!) 1-on-1 tutoring opportunities that students can sign up for.

### How much will I improve?
Students in our international classes average about a 100 point increase on the SAT or 3 points on the ACT. Many improve significantly more. More often than not, it comes down to the level of dedication applied both in and out of class. We don't view these courses as a program to "download" information into a student's brain. Instead, real improvement comes with repeated implementation of both concepts and strategy, which means resilient self-awareness and active reshaping of habits; students need to not only re-learn subjects they struggle with, they need to modify how they approach the test. The best results come when a student engages with the instructor to identify productive strategies and to learn from mistakes, building familiarity and confidence with each diagnostic.

### I'm only in grade 9. Should I still take the course?
The short answer is "probably not." Since the first test that even theoretically affects university applications is the PSAT NMSQT in 11th grade, it generally makes a lot more sense to wait a year or two before diving into an intensive prep course. Furthermore, Grade 9 students are often missing foundational coursework (especially in math) that is a pre-requisite to understanding content on the SAT & ACT. There are exceptions, though, so don't hesitate to contact us if you have further questions.

### Do you offer prep for the PSAT as well?
We do, indeed! The PSAT is essentially just a shorter version of the SAT, so we actually recommend that PSAT students simply join an SAT course – the content and strategy covered in an SAT course will apply equally to the shorter test.

### Does enrolling in this course also register me for the SAT or ACT?
NO. You must register for official exams through the College Board (SAT) or the ACT organization (ACT). Please refer to each organization's respective website, and in particular navigate to the pages for international students.$md$, 1),

('faq-attendance', 'faq', 'Attendance', $md$### I'm going to miss a couple days of class. Can I still attend?
Yes, you can still attend. If your class is offered online, you can request that the session(s) that you're going to miss be recorded and shared with you. The instructor can follow-up with you afterward to see if you have any questions about the material. Unfortunately, we don't have an easy way to replace a missed in-person session. Check with your instructor to get the lesson plan, materials, and homework. If you've signed up for 1-on-1 tutoring, you can also use this time to go over any lessons that you missed.

### I'm going to miss MORE THAN a couple days of class. Can I still attend?
You can still attend, but it may not be a great idea for you. Each class session contains a lot of content and strategy, and it's tough to get a meaningful score improvement when you've missed a big portion of the class. It may be a better option to sign up for 1-on-1 tutoring.$md$, 2),

('faq-diagnostics', 'faq', 'Diagnostic tests', $md$### I didn't receive the diagnostic test link or information. What should I do?
You'll receive an email about 10 days before the start of the class with access to our online testing platform. If you don't see it, please check both your and your student's inbox and spam folders. If you still cannot find it, please get in touch with us.

### Do the diagnostic tests have to be taken in one sitting or can I split it up and take it over several time periods?
To get the most out of the testing experience, it is necessary that students identify a single 2.5 hour window of time to complete the test in one sitting. We require this style of testing because it most closely mimics the experience of taking the real SAT.

### Is there a specific time or place that I need to take the diagnostic tests?
The remote diagnostic tests are designed to be done asynchronously, so students can take the test anywhere or anytime that is quiet and convenient. If possible, it's an advantage to have the experience of taking the test on a Saturday morning as that is when the actual test is scheduled; however, we'll usually provide test links ten days before the due date in order to allow students to take it at a time that is convenient for them.

### Will the diagnostic tests be on BlueBook?
No. Unless otherwise specified, you'll be taking Higher Ground's tests that are separate and different from the BlueBook tests.

### I have a conflict during the scheduled testing window. Can I receive the diagnostic test early?
Sure, this is usually fine. Just send us a message and we'll try to work something out. It's important, however, that you let us know before the test's due date and not after the test's due date.

### I'm not able to take one or both diagnostic tests. Should I still register for the course?
Yes, but the tests are an important part of the class and having more simulated testing experiences is definitely preferable to having fewer. It's often possible to take the diagnostic test earlier or later than scheduled, so let us know your situation and we'll work something out.

### I recently took the real SAT. Can I use my test results to substitute for one of the diagnostic tests?
While completing a real version of the test is very valuable, it's preferable to have more simulated testing experiences than to have fewer, and our diagnostic test should give you much more detailed and actionable information than what you received from your real SAT administration. For that reason, we recommend that you try to find a time to take our test in addition to the real test that you recently took.$md$, 3),

('faq-tutoring', 'faq', '1-on-1 tutoring', $md$### Am I required to take 1-on-1 tutoring with the group class?
No. The 1-on-1 tutoring is recommended, but definitely not required.

### What is the 30-minute strategy session? And when can I schedule it?
Each student receives one strategy session with enrollment, during which the instructor will help you craft an individualized study and review plan, build a perfect SAT mindset, understand your diagnostic score report, or go over day-of test strategies. The strategy sessions usually work best when they're done after the first weekend of classes. During that first weekend of class, you can approach the instructor directly to find and schedule a time during the following week that's mutually agreeable. If you'd like to or need to do the strategy session earlier, however, just let us know and we can try to arrange it.

### Are 1-on-1 tutoring sessions held in-person or online?
In some cases it may be possible to schedule some or all of your 1-on-1 tutoring sessions in person, but usually 1-on-1 tutoring sessions are done online. Just in case you're having any worries about online learning, the experience of a virtual meeting with just one student and one instructor is much better than what you might have experienced during Covid-19 virtual learning. We've actually found that our students who do online 1-on-1 sessions have equal or better outcomes than do our in-person students, and have reported enjoying the sessions just as much or more.

### I signed up for or want to sign up for 1-on-1 tutoring. When are these sessions going to be held?
The 1-on-1 tutoring sessions are best used after the group class is completed, so that you have a good basis from which to start. This way there's no redundancy in the material and you can really focus on the areas where you can gain the most points and on the concepts that were trickier for you. We'll get in touch with you after the course is completed in order to schedule the 1-on-1 sessions. If you'd like to schedule your hours sooner, if you are taking the real test within 2 weeks after the course finishes, or if you have another special case, that's okay too — let us know your situation as soon as possible and we'll help you figure it out.

### What if I can't make it to a tutoring session?
Let us know 24 hours in advance and we'll reschedule it for you for free. Easy peasy.

### Will I meet with the same tutor for each lesson?
Yes. Getting the results you want is both personal and cumulative, which means it's essential to build a working relationship with your tutor. Except for very rare cases of exceptional or emergency circumstances, you'll see the same face during every session.

### What if it's not going well with my tutor?
This doesn't happen too often, but it is possible. Every student's success is what matters the most, and a good match between student and tutor is crucial to each student's success. Let us know your concerns and we'll make it right, whether that means making adjustments to session flow or pedagogy, full or partial refunds, or placing you with a new tutor.$md$, 4),

('closing-cta', 'closing', 'Ready to get started?', $md$Spots are limited and registration closes before the first session — secure your student's place today.$md$, 1),

('fine-print-enrollment', 'fine-print', 'Enrollment caps and procedures', $md$Unless stated otherwise, course enrollments will be accepted on a first-come, first-serve basis. When a course reaches maximum class size, subsequent enrollments will be added to a waitlist. In the event of a large course requiring 2 instructors, students will be grouped according to initial diagnostic scores.

If the course fails to meet its minimum enrollment by the registration deadline, the course will be rescheduled or cancelled as appropriate. In the event of a cancellation or postponement, the course fee will be transferred to the next course at this school, or refunded in full upon request.$md$, 1),

('fine-print-sat', 'fine-print', 'SAT exam registration', $md$Enrollment in a prep course DOES NOT register your student for the SAT Exam. Parents/Guardians are responsible for enrolling their student(s). Visit the [College Board website](https://satsuite.collegeboard.org/sat/registration/international-testing/dates-deadlines) for upcoming test dates and registration information. Registration for the test is on a first come first serve basis, so please register early to be guaranteed a seat.$md$, 2),

('fine-print-refunds', 'fine-print', 'Cancellations and refunds', $md$Full refunds are available for courses at any point up to 10 days before the course start date. You may "return" your course registration for a full refund or exchange it for another course of equal value. All other returns or refunds for course registrations will be handled on a case-by-case basis. Refunds for online tutoring packages will be evaluated separately from course enrollments. There will be no refunds for online tutoring packages issued more than 10 days after the final day of classes. Cancellations of 1-on-1 lessons with fewer than 24 hours notice forfeit 30 minutes of tutoring time.$md$, 3),

('fine-print-privacy', 'fine-print', 'About this page', $md$This page keeps simple first-party counts of which sections are viewed and whether the register button is used — no cookies, no tracking vendors, and no personal information, and browsers asking not to be tracked are left uncounted. We use it only to make this page more useful.$md$, 4),

('waitlist-note', 'states', 'This class is currently full', $md$When a class is full, we'll try to teach an additional section. Join the waitlist and we'll notify you if we're able to open up a place for you!$md$, 1),

('no-active-class', 'states', 'No active class right now', $md$There's no class open for registration at this link right now. New classes are announced through your school and on our site — or talk to us directly and we'll point you toward the right prep option for your student.$md$, 2)

on conflict (key) do nothing;

notify pgrst, 'reload schema';
