# Tutor roster & subject taxonomy — seed data (PL-35 / PL-35a)

**July 17, 2026.** Source: HGL employee spreadsheet (screenshots from Scarlett), active roster confirmed by Scarlett. For Claude Code: seed via idempotent migration — `subjects` table + `instructors` rows + per-tutor profile fields. **Do NOT enable `tutoring_active` for anyone** (Scarlett's explicit instruction — rollout stays gated per tutor as Kelsie onboards them; creating records must trigger no email and no calendar push). Billy Thomas already exists as an instructor — update his subjects/profile only, don't duplicate.

Timezones are best guesses from area codes/notes (marked ~); default America/Denver where unknown. Kelsie corrects at onboarding.

## 1. Subject taxonomy (replaces any coarse entries like "Foreign Language")

Category `test_prep` (→ QBO 408-1 at cutover): SAT · SAT Subject Tests · PSAT · ACT · ACT Writing · GRE · GED · GMAT · Praxis · MCAT · ISEE · SSAT · LSAT

Category `subject_tutoring` (→ QBO 401): 
- Math: Arithmetic · Geometry · Pre-Algebra · Algebra 1 · Algebra 2 · Pre-Calculus · Calculus · AP/IB Calculus · Trigonometry · Statistics
- Science: Earth Science · Health & Nutrition · Biology · Biology Honors · Chemistry · Chemistry Honors · Physics · AP/IB Physics · Computer Science · Anatomy
- English: Grammar · Essays · Creative Writing · Reading · Literature · World Literature · Literary Theory · Study Skills · ESL
- Languages: Spanish · French · Italian · German · Latin · Japanese · Chinese
- Social Science: Geography · US History · World History · European History · Psychology · Political Science

If the `subjects` schema has no display grouping, prefix-free flat names above are fine; keep the category column exact (`test_prep` | `subject_tutoring`) — it drives QBO item mapping.

Remove/retire any existing "Foreign Language"-style coarse subject (migrate references first if any engagement points at it).

## 2. Roster (active — create as instructors, tutoring OFF)

Sheet legend: codes expanded per its key. Asterisks in the sheet are an unconfirmed qualifier (Scarlett is asking); carried into matching notes as "(*)" for now.

| Name | Email | Timezone | Subjects | Matching notes |
|---|---|---|---|---|
| Billy Thomas (exists) | billy@highergroundlearning.com | America/Denver | Arithmetic, Geometry, Pre-Algebra, Algebra 1, Algebra 2, Pre-Calculus, Calculus, Trigonometry, Statistics, Earth Science, Health & Nutrition, Biology, Biology Honors, Chemistry, Chemistry Honors, Physics, AP/IB Physics, Grammar, Essays, Creative Writing, Reading, Literature, Study Skills, Spanish, French, Geography, US History, World History, European History, Psychology, Political Science, SAT, SAT Subject Tests, ACT, GRE, GED, PSAT | Chairman |
| Eric Brown | eric@highergroundlearning.com | ~America/New_York (215) | Arithmetic, Geometry, Pre-Algebra, Algebra 1, Algebra 2, Pre-Calculus, AP/IB Calculus, Trigonometry, Physics, Grammar, Essays, Creative Writing, Reading, Literature, World Literature, Literary Theory, Study Skills, Geography, US History, SAT, SAT Subject Tests, PSAT, ACT, ACT Writing, GRE, GED, GMAT, Praxis | Executive Director; English: all |
| Kaile Cota | kaile@highergroundlearning.com | ~America/New_York (231 MI) | Arithmetic, Geometry, Pre-Algebra, Algebra 1, Algebra 2, Pre-Calculus, Trigonometry, Earth Science, Biology, Biology Honors, Chemistry, Chemistry Honors, Grammar, Reading, Study Skills, Literature, Essays, US History, Geography, World History, European History, Political Science, Psychology, ACT, SAT | Only reach out case by case. (*) on: Pre-Calc, Trig, Essays, all Social Science, ACT, SAT |
| Gwen De Silva | gwen@highergroundlearning.com | America/Denver (CO) | SAT, PSAT, ACT | Online only; 5–10+ hours/wk. ⚠ RECONCILE: an instructor "Gwendolyn" already exists with a MISSPELLED email (gwen@highergroundlean­ing.com — missing the 'r' in 'learning'). Fix that row's email to gwen@highergroundlearning.com (PL-44); do not create a duplicate. |
| Rebecca Baumher | rebecca@highergroundlearning.com | ~America/New_York (215) | Arithmetic, Geometry, Pre-Algebra, Algebra 1, Algebra 2, Pre-Calculus, Calculus, AP/IB Calculus, Trigonometry, Statistics, Physics, Chemistry, Chemistry Honors, AP/IB Physics, SAT, ACT, PSAT | Open to hours; Math: ALL. (*) on Chem Honors, AP/IB Physics |
| Kevin Marren | kevin@highergroundlearning.com | ~America/Los_Angeles (650) | Arithmetic, Geometry, Pre-Algebra, Algebra 1, Algebra 2, Pre-Calculus, Calculus, Trigonometry, Statistics, Chemistry, Physics, Grammar, Creative Writing, Reading, Study Skills, Literature, Spanish, Psychology, ACT, SAT | As many hours/wk as available. (*) on: Calculus, Chemistry, CW, Reading, SS, Lit, Spanish, Psych, ACT, SAT |
| Heather Witzel Lakin | heather@highergroundlearning.com | ~America/New_York (ME) | Arithmetic, Geometry, Pre-Algebra, Algebra 1, Algebra 2, Pre-Calculus, Calculus, AP/IB Calculus, Trigonometry, Physics, AP/IB Physics, Essays, Reading, Literature, Grammar, ACT, SAT, PSAT | Online only; 4–8 hours/wk; Maine. (*) on Grammar |
| Delaney Hall | delaneyh@highergroundlearning.com | America/Denver (unknown) | Arithmetic, Geometry, Pre-Algebra, Algebra 1, Algebra 2, Pre-Calculus, Calculus, Trigonometry, Statistics, Biology, Biology Honors, Chemistry, Chemistry Honors, Physics, Grammar, Reading, Study Skills, Literature, Essays, Psychology, SAT, PSAT, ACT | (*) on: Calculus, Statistics, Bio Honors, Chem Honors, Physics, Essays, ACT |
| Julia Fusia | julia@highergroundlearning.com | ~America/Los_Angeles (209) | Arithmetic, Geometry, Pre-Algebra, Algebra 1, Algebra 2, Pre-Calculus, Calculus, Trigonometry, Statistics, Earth Science, Chemistry, Chemistry Honors, Physics, Biology, Grammar, Reading, Study Skills, Literature, SAT, ACT, PSAT | (*) on: Calculus, Trig, Statistics, Biology, Study Skills, PSAT |
| Jason Topa | jason@highergroundlearning.com | ~America/New_York (740 OH) | Arithmetic, Geometry, Pre-Algebra, Algebra 1, Algebra 2, Pre-Calculus, Calculus, Trigonometry, Earth Science, Physics, Grammar, Essays, Creative Writing, Reading, Literature, US History, World History, Political Science, SAT, SAT Subject Tests, PSAT, ACT, ACT Writing, GRE, GED, GMAT, Praxis | HG contract worker; Test Prep: ALL |
| Alexa Jordan | alexa@highergroundlearning.com | Europe/London (UK) | Arithmetic, Geometry, Pre-Algebra, Algebra 1, Algebra 2, Pre-Calculus, Calculus, Trigonometry, Physics, Chemistry, Grammar, Essays, Creative Writing, Reading, Literature, World Literature, Literary Theory, Study Skills, Spanish, US History, Political Science, European History, SAT, ACT, PSAT | Traveling classes only; UK. English: ALL. (*) on Chemistry, Calculus |
| Austin Webb | austinw@highergroundlearning.com | ~America/Phoenix (520) | Arithmetic, Geometry, Pre-Algebra, Algebra 1, Algebra 2, Trigonometry, Statistics, Earth Science, Biology, Chemistry, Grammar, Essays, Creative Writing, Reading, Literature, World Literature, Literary Theory, Study Skills, Geography, US History, World History, Psychology, ACT, SAT | 3–8 hours/wk; English: ALL. (*) on Biology, Chemistry, ACT, SAT |
| Alex Cook | alexc@highergroundlearning.com | America/Denver (unknown) | Arithmetic (ALL Math per sheet): Arithmetic, Geometry, Pre-Algebra, Algebra 1, Algebra 2, Pre-Calculus, Calculus, Trigonometry, Statistics, Biology, Physics, Grammar, Essays, Creative Writing, Study Skills, Reading, Literature, French, Geography, US History, World History, European History, Psychology, ACT, SAT | NEVER CALL — email only. (*) on Physics, Reading/Lit, French, EH/Psy |
| Quinn Murphey | quinn@highergroundlearning.com | ~America/Chicago (210 TX) | Arithmetic, Geometry, Pre-Algebra, Algebra 1, Algebra 2, Pre-Calculus, Calculus, AP/IB Calculus, Trigonometry, Statistics, Earth Science, Health & Nutrition, Biology, Biology Honors, Chemistry, Chemistry Honors, Physics, AP/IB Physics, Computer Science, Study Skills | "Everything" math; all sciences + CS. (Sheet lists no test prep) |
| Ashley Khouri | ashley@highergroundlearning.com | ~America/New_York (814 PA) | Geometry, Pre-Algebra, Algebra 1, Algebra 2, Earth Science, Biology, Biology Honors, Chemistry, Chemistry Honors, Grammar, Essays, Reading, Study Skills, Literature, Spanish, ACT, SAT, PSAT, MCAT | (*) per sheet on several; MCAT listed |
| Charlotte Thayer | charlotte@highergroundlearning.com | ~America/New_York (FL) | Arithmetic, Geometry, Pre-Algebra, Algebra 1, Algebra 2, Pre-Calculus, Calculus, Trigonometry, Statistics, Physics, Grammar, Essays, Reading, Study Skills, ACT, SAT, PSAT | Online only; Florida; open to hours; Math: ALL |
| Ava Alexander | ava@highergroundlearning.com | ~America/New_York (570 PA) | Grammar, Essays, Creative Writing, Reading, Literature, World Literature, Literary Theory, Study Skills, Psychology, SAT, ACT | Proctor-only option; English: ALL. (*) on ACT |
| Katie Horvath | katie@highergroundlearning.com | America/Denver (801) | Arithmetic, Geometry, Pre-Algebra, Algebra 1, Algebra 2, Pre-Calculus, Biology, Chemistry, Chemistry Honors, Grammar, Essays, Creative Writing, Reading, Literature, World Literature, Literary Theory, Study Skills, Psychology, ACT, SAT, PSAT | Online only; 3–5 hours/wk; English: ALL. (*) on Pre-Calc, SAT, PSAT |
| Andie Arnold | andie@highergroundlearning.com | ~America/Chicago (402 NE) | Arithmetic, Geometry, Pre-Algebra, Algebra 1, Algebra 2, Pre-Calculus, Calculus, AP/IB Calculus, Trigonometry, Earth Science, Biology, Chemistry, Physics, Grammar, Essays, Creative Writing, Reading, Literature, Study Skills, Geography, US History, World History, Psychology, European History, ACT, SAT, PSAT | Fill-in / summers |
| Janet Amaya Pisco | janet@highergroundlearning.com | America/Denver (unknown) | Spanish, French, German | Alternate Spanish tutor; online only; ASK BEFORE SCHEDULING; contact via WhatsApp |

Excluded per Scarlett: Kelsey Lee. Excluded as non-tutors/former: Melissa Biscupovich (office support), Trevor Smith (moved away), everyone gray/red on the former-tutor pages, Kelsie Rank (Ops Director, not a tutor).

## 3. Related items

- **PL-42:** tutors panel gets an Active/Former grouping with reactivate (no deletion once history exists). The former-tutor sheet pages are the source if anyone returns — don't seed them now.
- Verify emails against Google Workspace before seeding (handles inferred from the sheet's truncated links; Delaney = delaneyh@, Austin = austinw@ per sheet; Alex Cook = alexc@ confirmed by Scarlett).
- After seeding, Kelsie flips `tutoring_active` per tutor as they onboard, and confirms timezone + default meeting link then (that flow already exists in the tutors panel).
- Asterisk semantics pending from Scarlett — if they turn out to mean "not preferred/rusty," move those subjects to matching notes accordingly.
