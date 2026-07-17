# Tutor roster & subject taxonomy — seed data (PL-35 / PL-35a)

**July 17, 2026 (rev. July 19 — asterisk semantics confirmed).** Source: HGL employee spreadsheet (screenshots from Scarlett), active roster confirmed by Scarlett. For Claude Code: seed via idempotent migration — `subjects` table + `instructors` rows + per-tutor profile fields. **Do NOT enable `tutoring_active` for anyone** (Scarlett's explicit instruction — rollout stays gated per tutor as Kelsie onboards them; creating records must trigger no email and no calendar push). Billy Thomas already exists as an instructor — update his subjects/profile only, don't duplicate.

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

## 1a. "Ready" vs "needs-prep" subjects — asterisk semantics (confirmed by Scarlett)

The asterisks in the source sheet mean: **the tutor is capable of that subject, but should not be auto-scheduled into it** — they'd need some preparation or a heads-up first (run it past them, or hand them the exact material before the session). So each tutor has two subject sets:

- **Ready** — auto-matchable. The PL-19 suggestion engine may propose this tutor for the subject automatically.
- **Needs-prep** (was asterisked) — capable but NOT auto-scheduled. Surfaced to Kelsie as an option she can assign manually after confirming with the tutor; never produces an automatic suggestion and is never silently committed.

**Data model:** add `instructors.subjects_with_prep text[] not null default '{}'` alongside the existing `subjects text[]`. The two are **disjoint** — a needs-prep subject is in `subjects_with_prep`, NOT in `subjects`. Behavior:
- The PL-19 matcher auto-suggests only from `subjects`.
- The tutors panel displays both, visually distinct, e.g. a "Also, with prep — confirm first" group under the ready subjects.
- Optional (nice, not required): when no ready tutor fits, the matcher may surface needs-prep tutors as a clearly-labeled lower tier ("needs prep — check with {tutor} first"), but must never auto-select one.
- The New Student Schedule wizard: picking a needs-prep subject/tutor combo is allowed but shows the "confirm with the tutor / send material first" reminder rather than treating it as a normal match.

In the roster below, **Ready subjects** and **Needs-prep subjects** are already split — seed them into the two columns directly.

## 2. Roster (active — create as instructors, tutoring OFF)

| Name | Email | Timezone | Ready subjects (auto-matchable) | Needs-prep subjects (confirm first) | Matching notes |
|---|---|---|---|---|---|
| Billy Thomas (exists) | billy@highergroundlearning.com | America/Denver | Arithmetic, Geometry, Pre-Algebra, Algebra 1, Algebra 2, Pre-Calculus, Calculus, Trigonometry, Statistics, Earth Science, Health & Nutrition, Biology, Biology Honors, Chemistry, Chemistry Honors, Physics, AP/IB Physics, Grammar, Essays, Creative Writing, Reading, Literature, Study Skills, Spanish, French, Geography, US History, World History, European History, Psychology, Political Science, SAT, SAT Subject Tests, ACT, GRE, GED, PSAT | — | Chairman |
| Eric Brown | eric@highergroundlearning.com | ~America/New_York (215) | Arithmetic, Geometry, Pre-Algebra, Algebra 1, Algebra 2, Pre-Calculus, AP/IB Calculus, Trigonometry, Physics, Grammar, Essays, Creative Writing, Reading, Literature, World Literature, Literary Theory, Study Skills, Geography, US History, SAT, SAT Subject Tests, PSAT, ACT, ACT Writing, GRE, GED, GMAT, Praxis | — | Executive Director; English: all |
| Kaile Cota | kaile@highergroundlearning.com | ~America/New_York (231 MI) | Arithmetic, Geometry, Pre-Algebra, Algebra 1, Algebra 2, Earth Science, Biology, Biology Honors, Chemistry, Chemistry Honors, Grammar, Reading, Study Skills, Literature | Pre-Calculus, Trigonometry, Essays, Geography, US History, World History, European History, Political Science, Psychology, ACT, SAT | Only reach out case by case |
| Gwen De Silva | gwen@highergroundlearning.com | America/Denver (CO) | SAT, PSAT, ACT | — | Online only; 5–10+ hours/wk. ⚠ RECONCILE: an instructor "Gwendolyn" already exists with a MISSPELLED email (gwen@highergroundlean­ing.com — missing the 'r' in 'learning'). Fix that row's email to gwen@highergroundlearning.com (PL-44); do not create a duplicate. |
| Rebecca Baumher | rebecca@highergroundlearning.com | ~America/New_York (215) | Arithmetic, Geometry, Pre-Algebra, Algebra 1, Algebra 2, Pre-Calculus, Calculus, AP/IB Calculus, Trigonometry, Statistics, Physics, Chemistry, SAT, ACT, PSAT | Chemistry Honors, AP/IB Physics | Open to hours; Math: ALL |
| Kevin Marren | kevin@highergroundlearning.com | ~America/Los_Angeles (650) | Arithmetic, Geometry, Pre-Algebra, Algebra 1, Algebra 2, Pre-Calculus, Trigonometry, Statistics, Physics, Grammar, Study Skills | Calculus, Chemistry, Creative Writing, Reading, Literature, Spanish, Psychology, ACT, SAT | As many hours/wk as available |
| Heather Witzel Lakin | heather@highergroundlearning.com | ~America/New_York (ME) | Arithmetic, Geometry, Pre-Algebra, Algebra 1, Algebra 2, Pre-Calculus, Calculus, AP/IB Calculus, Trigonometry, Physics, AP/IB Physics, Essays, Reading, Literature, ACT, SAT, PSAT | Grammar | Online only; 4–8 hours/wk; Maine |
| Delaney Hall | delaneyh@highergroundlearning.com | America/Denver (unknown) | Arithmetic, Geometry, Pre-Algebra, Algebra 1, Algebra 2, Pre-Calculus, Trigonometry, Biology, Chemistry, Grammar, Reading, Study Skills, Literature, Psychology, SAT, PSAT | Calculus, Statistics, Biology Honors, Chemistry Honors, Physics, Essays, ACT | — |
| Julia Fusia | julia@highergroundlearning.com | ~America/Los_Angeles (209) | Arithmetic, Geometry, Pre-Algebra, Algebra 1, Algebra 2, Pre-Calculus, Earth Science, Chemistry, Chemistry Honors, Physics, Grammar, Reading, Literature, SAT, ACT | Calculus, Trigonometry, Statistics, Biology, Study Skills, PSAT | — |
| Jason Topa | jason@highergroundlearning.com | ~America/New_York (740 OH) | Arithmetic, Geometry, Pre-Algebra, Algebra 1, Algebra 2, Pre-Calculus, Calculus, Trigonometry, Earth Science, Physics, Grammar, Essays, Creative Writing, Reading, Literature, US History, World History, Political Science, SAT, SAT Subject Tests, PSAT, ACT, ACT Writing, GRE, GED, GMAT, Praxis | — | HG contract worker; Test Prep: ALL |
| Alexa Jordan | alexa@highergroundlearning.com | Europe/London (UK) | Arithmetic, Geometry, Pre-Algebra, Algebra 1, Algebra 2, Pre-Calculus, Trigonometry, Physics, Grammar, Essays, Creative Writing, Reading, Literature, World Literature, Literary Theory, Study Skills, Spanish, US History, Political Science, European History, SAT, ACT, PSAT | Chemistry, Calculus | Traveling classes only; UK. English: ALL |
| Austin Webb | austinw@highergroundlearning.com | ~America/Phoenix (520) | Arithmetic, Geometry, Pre-Algebra, Algebra 1, Algebra 2, Trigonometry, Statistics, Earth Science, Grammar, Essays, Creative Writing, Reading, Literature, World Literature, Literary Theory, Study Skills, Geography, US History, World History, Psychology | Biology, Chemistry, ACT, SAT | 3–8 hours/wk; English: ALL |
| Alex Cook | alexc@highergroundlearning.com | America/Denver (unknown) | Arithmetic, Geometry, Pre-Algebra, Algebra 1, Algebra 2, Pre-Calculus, Calculus, Trigonometry, Statistics, Biology, Grammar, Essays, Creative Writing, Study Skills, Geography, US History, World History, ACT, SAT | Physics, Reading, Literature, French, European History, Psychology | NEVER CALL — email only |
| Quinn Murphey | quinn@highergroundlearning.com | ~America/Chicago (210 TX) | Arithmetic, Geometry, Pre-Algebra, Algebra 1, Algebra 2, Pre-Calculus, Calculus, AP/IB Calculus, Trigonometry, Statistics, Earth Science, Health & Nutrition, Biology, Biology Honors, Chemistry, Chemistry Honors, Physics, AP/IB Physics, Computer Science, Study Skills | — | "Everything" math; all sciences + CS. (Sheet lists no test prep) |
| Ashley Khouri | ashley@highergroundlearning.com | ~America/New_York (814 PA) | Geometry, Pre-Algebra, Algebra 1, Algebra 2, Earth Science, Biology, Biology Honors, Chemistry, Chemistry Honors, Grammar, Essays, Reading, Study Skills, Literature, Spanish, ACT, SAT, PSAT | MCAT | ⚠ Sheet marked several of her subjects with asterisks but the SPECIFIC ones weren't captured — confirm against the sheet and move any needs-prep subjects across. MCAT placed in needs-prep as an advanced default. |
| Charlotte Thayer | charlotte@highergroundlearning.com | ~America/New_York (FL) | Arithmetic, Geometry, Pre-Algebra, Algebra 1, Algebra 2, Pre-Calculus, Calculus, Trigonometry, Statistics, Physics, Grammar, Essays, Reading, Study Skills, ACT, SAT, PSAT | — | Online only; Florida; open to hours; Math: ALL |
| Ava Alexander | ava@highergroundlearning.com | ~America/New_York (570 PA) | Grammar, Essays, Creative Writing, Reading, Literature, World Literature, Literary Theory, Study Skills, Psychology, SAT | ACT | Proctor-only option; English: ALL |
| Katie Horvath | katie@highergroundlearning.com | America/Denver (801) | Arithmetic, Geometry, Pre-Algebra, Algebra 1, Algebra 2, Biology, Chemistry, Chemistry Honors, Grammar, Essays, Creative Writing, Reading, Literature, World Literature, Literary Theory, Study Skills, Psychology, ACT | Pre-Calculus, SAT, PSAT | Online only; 3–5 hours/wk; English: ALL |
| Andie Arnold | andie@highergroundlearning.com | ~America/Chicago (402 NE) | Arithmetic, Geometry, Pre-Algebra, Algebra 1, Algebra 2, Pre-Calculus, Calculus, AP/IB Calculus, Trigonometry, Earth Science, Biology, Chemistry, Physics, Grammar, Essays, Creative Writing, Reading, Literature, Study Skills, Geography, US History, World History, Psychology, European History, ACT, SAT, PSAT | — | Fill-in / summers |
| Janet Amaya Pisco | janet@highergroundlearning.com | America/Denver (unknown) | Spanish, French, German | — | Alternate Spanish tutor; online only; ASK BEFORE SCHEDULING (whole-person gate — treat like needs-prep for scheduling regardless of subject); contact via WhatsApp |

Excluded per Scarlett: Kelsey Lee. Excluded as non-tutors/former: Melissa Biscupovich (office support), Trevor Smith (moved away), everyone gray/red on the former-tutor pages, Kelsie Rank (Ops Director, not a tutor).

## 2b. Default meeting links (`instructors.default_location`)

From the HGL "ID Link w/Password" sheet (Scarlett provided the link column as exact text — these are verbatim, not transcribed from an image). This field prefills online sessions. Three cases:

- **Seed the Zoom link** for tutors with a dedicated personal room.
- **Google Meet default** — the sheet says "use Google Meet unless they get 4–5 students online regularly." These tutors have **no static room**; leave `default_location` blank and rely on Google Meet generated per session (see the enhancement note below). Do NOT seed their parked backup Zoom links.
- **Leave blank** — per-student, not-on-sheet, or verify-stale tutors; Kelsie sets at onboarding.

| Tutor | default_location to seed |
|---|---|
| Billy Thomas | `https://us06web.zoom.us/j/3451590427?pwd=NzlVczJJZTRFQ2NWNU9TbnBvSm8zZz09` |
| Eric Brown | `https://us02web.zoom.us/j/4794457129?pwd=V2hTY2hHeXVlMHVSM1g1OFJmbm9yZz09` (his group room — confirm it's also his 1-on-1 default) |
| Gwen De Silva | `https://us02web.zoom.us/j/2869190098?pwd=Nnh6bnNCNElSZzQyeHkwdElyYUxWUT09` |
| Quinn Murphey | `https://us06web.zoom.us/j/6651170915?pwd=W1csBEV2vklkXGSbEUEBbMzuEZ8CDC.1` ⚠ the sheet's ID # (947 517 1055) doesn't match this link's meeting ID (665 117 0915) — verify which is right before relying on it |
| Charlotte Thayer | `https://zoom.us/j/4244415352?pwd=ampmaXMwbGxpTmlyTVR0Um9Iak5SUT09` |
| Katie Horvath | `https://zoom.us/j/8921603560?pwd=MEZ0UTVOUUU2bXdSeTc0czZMdmJpdz09` |
| Janet Amaya Pisco | `https://zoom.us/j/3059947617?pwd=K2VSMXlXVDNua2o3SnpMeWcwZzZNQT09` (sheet also notes Google Meet guidance for her — seed the Zoom link, Kelsie can switch) |
| Jason Topa | *(blank — Google Meet default)* |
| Kevin Marren | *(blank — Google Meet default)* |
| Alexa Jordan | *(blank — Google Meet default)* |
| Rebecca Baumher | *(blank — Google Meet default)* |
| Heather Witzel Lakin | *(blank — Google Meet default)* |
| Kaile Cota | *(blank — creates a per-student link each time; Waterford)* |
| Delaney Hall / Julia Fusia / Austin Webb / Alex Cook / Ashley Khouri | *(blank — not on the sheet; Kelsie sets at onboarding)* |
| Ava Alexander | ⚠ *(blank — appears ONLY in the sheet's former/"Old" section; that link `…/5895674126` is likely stale. Kelsie confirms before seeding.)* |
| Andie Arnold | ⚠ *(blank — same: only in the "Old" section, `…/4459487862`, likely stale. Kelsie confirms.)* |

**These are live meeting rooms with embedded passwords, now committed to the repo/migration.** If HGL ever rotates them, this doc + the seed migration are the places to update.

**Optional enhancement (worth considering, not required):** the portal already pushes tutoring sessions to Google Calendar via the service account. For the Google-Meet-default tutors, it could request a Google Meet link on each event (Calendar API `conferenceData.createRequest`) so those sessions get a real meeting link automatically instead of a blank location. Flag for the backlog if auto-Meet is wanted; otherwise blank `default_location` + manual Meet is fine.

## 3. Related items

- **PL-42:** tutors panel gets an Active/Former grouping with reactivate (no deletion once history exists). The former-tutor sheet pages are the source if anyone returns — don't seed them now.
- Verify emails against Google Workspace before seeding (handles inferred from the sheet's truncated links; Delaney = delaneyh@, Austin = austinw@ per sheet; Alex Cook = alexc@ confirmed by Scarlett).
- After seeding, Kelsie flips `tutoring_active` per tutor as they onboard, and confirms timezone + default meeting link then (that flow already exists in the tutors panel). Default links for the dedicated-room tutors are pre-seeded (§2b); the Google-Meet/per-student/blank tutors she sets or leaves as Google Meet.
- **Ashley Khouri's needs-prep split needs verifying against the source sheet** (see her row) — the only row where the specific asterisked subjects weren't captured.
