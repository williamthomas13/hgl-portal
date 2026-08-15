-- PL-366: the SAT Math Deep Dive course block set — PORTED from the live
-- Squarespace page (the hidden product page /classes/p/advanced-sat-math,
-- "March SAT Deep Dive: Mastering Advanced Math Concepts", captured Aug 15
-- 2026). Copy is verbatim from the page: the course pitch paragraph, the
-- "Stamp Your Passport to Advanced Math" blurb, the "Sample of Topics
-- Covered" list, and the "Advanced Problem-Solving Techniques" section.
-- Seeded UNREVIEWED (updated_by NULL) for Scarlett's walkthrough. Images
-- ride the PL-351 pipeline in a follow-up data step (webp renditions in
-- the class-pages bucket), patched only where image is still NULL.
-- IDEMPOTENT: on conflict do nothing.

insert into public.site_content_blocks (key, section, heading, body_markdown, sort_order, scope, course_key) values

('course:sat-deep-dive-mastering-advanced-math-concepts:hero-blurb', 'course', '', $md$Our online SAT Deep Dive math class is designed for students who have already taken our SAT class or who already have an SAT math score of 600 or above. This advanced class delves into the hardest SAT math concepts that are often left out of regular SAT classes. With a focus on the most challenging and least frequently tested topics, our expert instructors will guide students through strategies for solving these challenging problems. By the end of the class, students will be confident in their ability to tackle even the most difficult SAT questions.$md$, 0, 'course', 'sat-deep-dive-mastering-advanced-math-concepts'),

('course:sat-deep-dive-mastering-advanced-math-concepts:passport', 'course', 'Stamp Your Passport to Advanced Math', $md$The topics taught in this class are found in the "Passport to Advanced Math" category of the SAT, which makes up about 28-30% of the hardest math questions on the exam. While they may not appear frequently, mastering these topics can help high-achieving students reach higher scores on the more challenging portions of the math section.

In addition to mastering advanced mathematical concepts, students will enhance essential skills such as problem-solving, time management, critical thinking, and estimation. These skills are crucial for tackling challenging SAT math questions confidently and efficiently.$md$, 1, 'course', 'sat-deep-dive-mastering-advanced-math-concepts'),

('course:sat-deep-dive-mastering-advanced-math-concepts:topics', 'course', 'Sample of Topics Covered', $md$- Complex number operations
- Circle and parabola equations
- Advanced trigonometry (less common identities and applications)
- Complex functions (interpreting and manipulating)
- Radian measure
- Higher-degree polynomials (roots and end behavior)
- Inequalities with absolute values
- Graph interpretation (less common graph types)
- Systems of nonlinear equations
- Word problems with hidden information
- Advanced function notation and operations
- Matrices (basic operations)
- Exponential functions or equations
- Interpreting structure in expressions
- Word problems involving multiple concepts
- Grid-in questions
- Data analysis and interpretation$md$, 2, 'course', 'sat-deep-dive-mastering-advanced-math-concepts'),

('course:sat-deep-dive-mastering-advanced-math-concepts:techniques', 'course', 'Advanced Problem-Solving Techniques', $md$Students will learn to break down complex problems and employ discriminant analysis for quadratic equations. To improve time management, students practice under timed conditions and learn which questions to prioritize. Additionally, students will hone their critical thinking and estimation skills, utilizing statistics and process of elimination to increase their chances of selecting the correct answer.

These skills empower students to approach advanced SAT math questions with confidence, efficiency, and a higher likelihood of success.$md$, 3, 'course', 'sat-deep-dive-mastering-advanced-math-concepts')

on conflict (key) do nothing;

notify pgrst, 'reload schema';
