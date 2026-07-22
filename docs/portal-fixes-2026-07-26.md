# Portal fixes — batch 9 (July 2026, follows batch 8)

One item. Batch 8 (PL-67/68) is in flight — see the coordination note inside. Continues PL-x numbering.

**Standing rules:** plain-English statuses · "Ops Director" · never "engagement" in UI copy · contact block on parent surfaces · `git push` after committing · PL-x IDs in commits · check items off here when shipped · copy for live templates lands as new registry versions, not code edits.

---

## PL-69 · Student pronouns: capture at registration, resolve everywhere emails say "their" ✅

> **Shipped (after batches 10–11, so the sweep covered everything added since this doc was written).**
> **(a)** `students.pronouns` (nullable, she_her | he_him | they_them; migration applied). Captured in three places, all optional with the "{studentFirstName}'s pronouns" label and no explanatory text: the registration student step (label goes live as the name is typed — verified "Student's pronouns" → "Marisol's pronouns"; the waitlist path captures too, same form), the tutoring intake form, and the admin roster's student cell (a small select the Ops Director can set on a call). Round-trip proven: registration with she/her stores it; unrecognized values store as unset — nothing ever blocks.
> **(b)** One pronoun source (registry `pn()` + exported `studentPronounSet()` twin-mirror, proven equal): `{you_or_they}`, `{your_or_their}`, and `{you_have_or_they_have}` parent branches are pronoun-aware with verb agreement; new `{she_he_they}` / `{her_him_them}` / `{her_his_their}` standalones plus `{you_need_or_they_need}` / `{you_dont_or_they_dont}` (agreement-carrying pairs the sweep required); PL-67's `{takingAdvantagePhrase}` wired to the same source ("of her class time with Jordan") — built on the shipped PL-67, not forked.
> **(c)** Authoritative sweep across **live DB versions** (not seeds): converted and published **PR1/2/3 v2** (preheaders + PR1's "confirm their registration"), **#1 v3** ("given them", "help them achieve their best"), **#8 v2** ("do their best", "for their hard work"), **#8b v3** ("their tutor will pick up"), **#9 v4** ("the tools {you_need_or_they_need}" — the old "{you_or_they} need" would have broken agreement as "she need"). Code twins and seeds converted to match. Batch-10/11 additions checked: CX_TUTORING_START, the W2 decline copy, `{classLocationLine}`, and the IN_ instructor templates carry no student-referential they/them (IN_FYI embeds family renders, which are already converted). Doc's false positives left alone (hours "don't expire", policies "they're signed", sessions "need them to be", testimonials, counselor plurals).
> **(d)** Ana is she/her in samples (link audit renders 96/96 with them; #8 spot-checks "Congrats to Ana for her hard work" / "his hard work"). `npm run regress:pronouns` (committed): 49/49 — the full four-state matrix incl. verb agreement, both sources proven identical, and **every converted template's unset render proven byte-identical to its previous version** (the publish script itself refuses to repoint unless that holds).

"Congrats to Ana for their hard work" reads less personal than "…for her hard work." Emails lean on they/them/their for the student throughout. Decision (Scarlett): capture pronouns, use them everywhere, fall back to exactly today's copy when unset.

### a. Schema + capture
- `students.pronouns`: nullable enum `she_her | he_him | they_them`. **Unset = they/them fallback** — nothing ever blocks on it; existing students, QBO-imported families, and public-capture signups keep working untouched.
- Capture in three places, always optional:
  - **Registration form, student step** — a simple select labeled "{studentFirstName}'s pronouns" (or "Student's pronouns" before the name is typed). No explanatory parenthetical.
  - **Tutoring intake form** — same field, same label, pre-filled/skippable like the rest (per the intake conventions).
  - **Admin student record** — editable, so the Ops Director can set it when she learns it on a call.

### b. Resolver plumbing (`comms-variables.ts`)
- The parent-audience branch of every audience-conditional that currently emits they/them/their becomes pronoun-aware: `{you_or_they}` → you / she / he / they · `{your_or_their}` → your / her / his / their · `{you_have_or_they_have}` → you have / she has / he has / they have (mind verb agreement on every "have/has"-style construct) · plus the possessive helper at ~line 202 and any others the sweep finds.
- Add standalone conditionals for future copy: `{she_he_they}`, `{her_him_them}`, `{her_his_their}` (and capitalized variants if the sentence position needs them).
- **Coordination with batch 8:** PL-67's `{takingAdvantagePhrase}` composes "…of their class time…" — once pronouns land, its resolver uses the same pronoun source ("of her class time with Jordan"). Build on top of wherever PL-67 ended up; don't fork.

### c. Copy sweep — convert literal student-referential they/their/them to variables
From a repo grep (Code: re-run authoritatively across **live DB template versions too**, since live copy has drifted from seeds via editor edits):
- **PR1–3 preheaders:** "Complete your payment to save **their** place in class" → "{her_his_their}".
- **#1 thanks:** "you've given **them** one less thing to worry about" · "help **them** achieve **their** best score".
- **#8 wrap-up:** "ready to do **their** best on the exam" · "Congrats to {studentFirstName} for **their** hard work" (the motivating example).
- **#9 next-steps:** "the tools **they** need" · "**they** don't lose any momentum with **their** test prep".
- **Code-composed copy** in `email.ts` (~16 hits — filter to student-referential; e.g. #8b's "their tutor will pick up…") and the tutoring set.
- **Not student-referential — leave alone:** "whenever you need them to be" (sessions), "they don't expire" (hours), "until they're signed" (agreements), testimonial quotes, counselor emails about students in the plural.
- Live templates get the conversion as **seeded new registry versions**; drafts and code copy edit in place.

### d. Samples + verification
- Sample data: give Ana **she/her** so Scarlett's test-send reviews read the way personalized sends will; keep one they/them render covered in tests.
- Unit-test the resolvers across all four states (she/he/they/unset) including verb agreement; extend the golden-render checks so an unset-pronoun student renders byte-identical to today's copy.

---

## Paste-ready handoff prompt for Claude Code

> Read `docs/portal-fixes-2026-07-26.md` (batch 9 — one item, PL-69).
>
> Add nullable `students.pronouns` (she_her | he_him | they_them; unset = they/them fallback, never blocking) captured on the registration student step, the tutoring intake, and the admin student record — label "{studentFirstName}'s pronouns", no explanatory text. Make every audience-conditional's parent branch pronoun-aware with correct verb agreement, add {she_he_they}/{her_him_them}/{her_his_their}, and wire PL-67's {takingAdvantagePhrase} to the same source. Then sweep ALL email copy — live DB template versions included, not just seeds — converting student-referential they/their/them to variables (doc lists known spots and known false positives); live templates get seeded new versions. Sample data: Ana is she/her. Unit-test all four pronoun states incl. verb agreement, and prove unset renders byte-identical to today.
>
> Rules: PL-x IDs in commits; `git push` after committing; standing copy rules apply; check this item off here when shipped.
