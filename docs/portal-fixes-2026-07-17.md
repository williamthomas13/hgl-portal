# Portal fixes — July 17, 2026 (full review walkthrough + Scarlett's test pass)

> **Status (July 17, Code):** PL-19 spec + chunks A–C implemented, committed, and verified
> (typecheck, prod build, smoke suite, live browser pass with a staff session against the dev
> server). Chunk D below has recommendations only, awaiting Scarlett. **Blocked on approval —
> DB writes were denied in this session:** (1) apply
> `supabase/migrations/20260720000001_availability_matching.sql` (additive, idempotent —
> availability capture no-ops gracefully until it lands); (2) run `node scripts/.tmp-fix-a.mjs`
> for the PL-1/PL-2 row fixes. Both are one command / one paste.

Sources: full surface-by-surface review of production (hgl-portal.vercel.app) with code verification against this repo, plus Scarlett's hands-on testing of the 1-on-1 Tutoring admin panel. Companion doc: `docs/AVAILABILITY_MATCHING_SPEC.md` (the PL-19 feature — **do that first**, it's the priority item; PL-28 below is folded into it).

Numbering (PL-x) is stable across this punch-list cycle — keep the IDs in commit messages.

**Known/intentional — do not "fix":** QA data in prod (Roman Thomas Sierra × SAT × Billy, September paid month, XCL events, converted lead, accepted agreement); Stripe test mode / QBO sandbox until cutover; T1–T8 not yet in the template registry and `enrollment_addons.enrollment_id` NOT NULL relaxation (already on the fast-follow list); time-based 7c edges riding the Aug 20 run.

**Note:** production may be a deploy behind this repo — PL-6 shows a label bug in prod whose code here looks correct. Verify against a fresh deploy before chasing ghosts.

---

## A. Pre-launch blockers & data fixes

### PL-1 · Class "Starts" date can contradict the sessions list
**Repro:** Nido class — admin header, instructor view, and parent enrollment card say "Starts 05 September 2026", but sessions run Jul 23 – Aug 27. The parent view contradicts itself on one page: the upcoming-class callout (computed from `sessions[0]`, correct) says July 23 while the card below (stored `classes.start_date`) says September 5.
**Where:** `app/portal/parent-view.tsx:337`, `app/portal/instructor-view.tsx:116`, `app/admin/page.tsx:650` all render stored `start_date`; nothing recomputes or warns when sessions drift.
**Fix:** render "Starts" from the first session everywhere (fall back to `start_date` only when no sessions exist), or keep `start_date` but recompute it on any session change; add an admin warning when they disagree. Plus one-time data fix for the Nido row.
**Why pre-launch:** a wrong start date on a parent surface is a trust-killer.
✅ **Done.** All three surfaces render "Starts" from the first session (`effectiveStartDate` in `app/utils/dates.ts`), and the admin card shows an amber warning when the stored date disagrees. Data fix for the Nido row (and a second drift found on Cape Town, 09-13 vs 09-12) is staged in `scripts/.tmp-fix-a.mjs` — **needs approval to run**.

### PL-2 · Data cleanup: ISD Session 1 is 12:00–10:00 (end before start)
Validation now exists in both the wizard (`class-wizard.tsx:338`) and admin add-session (`admin/page.tsx:120`) — this is purely a bad legacy row that still renders on parent/instructor calendars and in the ICS. Fix the row (presumably 10:00–12:00). Consider a one-off scan for any other end<=start rows.
✅ **Scanned; fix staged.** Full scan found exactly one end<=start row (the ISD 2026-10-13 session, 12:00–10:00). The 10:00–12:00 correction is in `scripts/.tmp-fix-a.mjs` — **needs approval to run**.

### PL-15 · Collateral prints a wrong registration deadline (and possibly wrong year)
**Repro:** ISD class → Collateral → Show previews. Flyer says "REGISTRATION CLOSES 17 SEPTEMBER"; class's `registration_close_date` is 02 October 2026. The letter's offer box appears to read "October **2028** SAT Prep Class" and the printed URL may say "fall28" (preview thumbnail too low-res to be certain — check a full-size render).
**Where:** `app/utils/collateral-templates.ts` / whatever computes the deadline and term label for collateral.
**Fix:** derive the printed deadline from `registration_close_date` (and the term/year label from the class record); verify at full size after fix.
**Why pre-launch:** printed collateral with a wrong date/year is exactly the manual-Canva failure mode this feature replaces.
✅ **Done + full-size verified.** The model now prints `registration_close_date` (the real /register gate; `enrollment_deadline` only backfills classes without one) — ISD flyer renders "REGISTRATION CLOSES 2 OCTOBER". The 2028/fall28 sighting was a low-res misread: full-size render says "October 2026 SAT Prep Class" and the slug is `isd-sat-prep-fall26`; no 2028 or fall28 exists anywhere in either artifact.

### PL-22 · Wizard points to a create-family flow that doesn't exist
The New Student Schedule wizard says "New family? Create the family/student on the main admin page first" (`engagement-wizard.tsx:226`) — but the main admin page has no create-family UI; families only come into existence via class registration or lead conversion. Pick one door and build/point to it. Recommendation: an "Add family/student" affordance on the leads page (7e conversion already creates family+student records correctly), and reword the wizard note to point there.
✅ **Done as recommended.** New `create_family` action on the leads route (family matched by parent email — never duplicated — student matched by name inside the family); a "Create family + student" button on any unconverted lead's detail; wizard note now links to the leads page.

### PL-14 / PL-25 (data half) · Tutor subjects are "none set"
Billy's tutor row has no subjects, which cascades: every subject in the wizard shows "(subject not listed)" and the rate default never populates (see PL-27). Ops task: set real subjects (and default meeting links) per tutor before launch. Belongs on the migration-to-real-operations checklist.
➡ **Ops task, unchanged** — stays on the migration-to-real-operations checklist (Tutors panel → edit → subjects + default location). The PL-27 fix below means the gray Create button now explains this trap when it happens.

### PL-3 · Communications History tab appears unresponsive (verify)
Clicking "History" (tried both element-ref and coordinate clicks, two rounds) left the Upcoming list rendered — rows still showing `scheduled` with Send now/Hold actions. The tab code exists (`admin/communications/page.tsx:93,256`). Possibly an automation artifact — reproduce by hand first; if real, fix. This is the "prove we sent it" surface, so treat as pre-launch if it reproduces.
✅ **Does not reproduce.** Re-tested with a real staff session on the dev server (same prod data): the History tab switches immediately and renders sent/delivered/bounced rows with engagement columns. Automation artifact in the original review — no code change.

### PL-5 · Invoice due date renders one day late (UTC slice)
**Repro:** September 2026 invoice shows "due 2026-08-01". `dueDateFor` correctly computes month-end 23:59 America/Denver (Jul 31), but `app/admin/tutoring/invoices-panel.tsx:279` renders `String(r.due_at).slice(0, 10)` — the UTC calendar date.
**Fix:** format `due_at` in `America/Denver` (one line). Check the parent-facing billing surfaces and T1/T4 emails for the same slice pattern while there.
**Why it matters now:** first real generation run is Aug 20; families will read these dates.
✅ **Done.** Admin panel due/paid dates render in Denver (`denverDate`), and the overdue Ops alert's slice got the same fix. Audited the rest: T2/T4 emails were already Denver-correct (`dueDateFor().label` / explicit `timeZone`), and no parent surface prints `due_at` raw.

## B. Small renders & copy

### PL-4 · Enrolled counts disagree between admin and instructor views
Admin badge counts Paid+Pending+Completed (`app/admin/page.tsx:616`); instructor view shows paid only (`instructor-view.tsx:142`). Same class reads "2 / 15" vs "1 / 15". Spec's capacity gate is the paid count. Either show paid in both, or make admin explicit: "1 paid + 1 pending / 15".
✅ **Done** — admin badge now reads "1 paid + 1 pending / 15" (verified live).

### PL-6 · "2full-length tests" label (verify against fresh deploy)
Prod renders the collateral field label as "the "2full-length tests" bullet"; repo code at `collateral-card.tsx:198` has the space. Likely a stale deploy — verify and redeploy; fix if it persists.
✅ **No code change needed** — re-confirmed the repo renders the space. Deploy current main and re-check prod; if it still shows without the space after that deploy, reopen.

### PL-9 · Parent tutoring card: "Mons 16:00"
Parent-facing surface using 24h time and "Mons" while everything adjacent is "3:00 PM" style. Render "Mondays 4:00 PM" (tutor timezone, matching the "Times shown in Denver" note).
✅ **Done** — renders "Mondays 4:00 PM" (`tutoring-section.tsx`).

### PL-11 · Add-on hours widget says "once your schedule is set up" when one is
`parent-view.tsx:524` — the copy is static; when the family has an active tutoring schedule (the TutoringSection below is populated), reword to point at it ("see your sessions and hours in the 1-on-1 tutoring section below") instead of implying nothing is set up.
✅ **Done** — the card checks for an active schedule per student and points at the tutoring section when one exists; the "once your schedule is set up" copy only shows when it's true.

### PL-16 · Rename tutoring "Schedule" card → "Current Student Schedules"
✅ **Done.**

### PL-23 · "Funding" → "Payment"; strip internal phase refs from UI copy
`engagement-wizard.tsx:359-383`: label "Funding" → "Payment"; option text "invoice month in advance — 7c" and the note "standalone package purchase arrives with 7d" leak build-phase numbers into UI. Reword in plain English (the plain-English rule applies to admin copy too — Kelsie is the audience).
✅ **Done** — "Payment", plain-English options, no phase numbers anywhere in the wizard (verified live).

### PL-25 (copy half) · "(subject not listed)" is cryptic
`engagement-wizard.tsx:262` — means the picked subject isn't in the tutor's subjects list. Clearer: "SAT isn't in Billy's subject list — you can still assign".
✅ **Done** — option reads "Billy — SAT isn't in their subject list (you can still assign)".

### PL-26 · Dates render DD/MM/YYYY in the wizard
Native `<input type="date">` follows browser locale. Spec format is "17 July 2026". Render a formatted label beside pickers (native inputs can't be reformatted); audit other date inputs for the same.
✅ **Done** — new `DateHint` in `admin/ui.tsx` prints "= 17 July 2026" beside the picker. Applied across the audit: engagement wizard start date, session-dialog reschedule date, class wizard (deadline, registration close, copied-session date, add-session), admin add-session, collateral promo deadline, agreements effective date.

### PL-31 · Low-hours warning copy reads backwards
`engagements-panel.tsx:110` — "1.0h left of 15h — low! upsell/convert moment". The trigger logic is right (fires when remaining < ~2 sessions' worth), but the phrasing made Scarlett read it as firing at hour one. Reword: "14 of 15 hours used — 1.0h left · time to talk about next steps". Also confirm the QA data really has 14h drawn (if not, the draw-down accounting needs a look).
✅ **Done, and the accounting checks out** — DB scan: Fakey's package shows 15h purchased, 14.0h consumed across 14 sessions (completed/no-show/forfeited/confirmed), so the warning was firing correctly; only the phrasing was wrong. Now reads "14.0 of 15h used — 1.0h left · time to talk about next steps".

## C. Tutoring-panel UX batch

### PL-17 · Tutor calendar show/hide checkboxes on the schedule view (Google-style, left rail)
✅ **Done** — checkbox rail in the all-tutors day view (hidden while there's only one active tutor; week view keeps its picker).
### PL-18 · Calendar grid scrollable through full 24h (currently fixed 07:00–20:00; needed for cross-timezone tutors)
✅ **Done** — grid spans 00:00–24:00 inside a scroller that opens at 07:00, with sticky day headers (verified live).
### PL-20 · Move "New student schedule" card above the calendars
✅ **Done.**
### PL-21 · Student picker: typeahead instead of dropdown (dropdown won't scale)
✅ **Done** — type-to-search list (top 8 matches on student/parent/email), selected student shows as a pill with "change".
### PL-24 · Online/in-person toggle replacing the free-text Location field
In-person → autofill "Higher Ground Learning"; online → autofill the tutor's saved default meeting link; both overridable (same pattern as the rate override).
✅ **Done** — toggle drives the default, field stays editable; a hint flags tutors with no saved meeting link.
### PL-27 · Grayed-out Create button gives no reason
`engagement-wizard.tsx:199` — `ready` requires student+subject+tutor+rate>0 (+package pick). Likely trap: rate defaults from the subject, but with empty tutor subjects (PL-14) it never populates, so the button sits gray with everything visibly filled. Add inline "what's missing" hints.
✅ **Done** — "To enable Create: …" lists exactly what's missing, including the no-default-rate trap (verified live).
### PL-29 · Same conflict listed twice in the wizard warnings
Dedupe conflict rows by (event, occurrence) — likely overlapping busy blocks matching one occurrence twice.
✅ **Done** (shipped with PL-19/PL-28 — one row per event × occurrence, deduped).
### PL-30 · Students list: Current / Past toggle
✅ **Done** — Current (active/paused) / Past (ended) with counts.
### PL-33 · Move the Google Calendar connection card off the tutoring page
It's owner-level config, not Kelsie's daily surface — group with QuickBooks under an admin-settings area on the main admin page.
✅ **Done** — lives on the main admin page directly under QuickBooks; removed from the tutoring page.

*(PL-28 — conflict horizon beyond two weeks, all-day event handling per Busy/OOO-vs-Free transparency, richer conflict detail — is specced inside `AVAILABILITY_MATCHING_SPEC.md` since it changes the same freebusy path.)*
✅ **PL-19 + PL-28 done** per the spec: `student_availability` migration (pending apply — see status note up top), shared grid on intake + wizard, ranked suggestion chips (verified against the spec's acceptance scenarios: busy-block avoidance, cross-timezone normalization, offer-window constraint, empty grid → hint not error), full-horizon batched freebusy (verified live: "conflicts through Mon, Aug 31" with titles, "busy — private event", and "(all day)" rendering), Busy/OOO-vs-Free all-day rule + workingLocation/birthday skip, and PL-29 dedupe.

## D. Decide-first / investigate

### PL-10 · Converting a lead doesn't move it to "Scheduled — won"
The converted QA lead still sits open at "Intake complete" while its detail says "Converted: family and student records exist." Auto-advance on conversion (or at least badge it). Decide desired behavior first.
💡 **Recommendation (awaiting Scarlett):** don't advance on conversion itself — family/student records existing isn't "won" (intake completes before any consult). Instead, auto-advance the lead to **"Scheduled — won"** at the moment a tutoring schedule is actually created: in the engagement-create route, update any lead with that `student_id` whose status isn't already `scheduled`/`lost`. That matches the pipeline's meaning of "scheduled" and needs no new statuses. Small change in `/api/admin/tutoring/engagement`; say the word.

### PL-12 · Registration page has no human-help contact block
Parent-facing, pre-payment — arguably the surface where "a human is a click away" matters most. The block exists on the parent portal (from app_settings). Decide placement (footer under the form?) and add.
💡 **Recommendation (awaiting Scarlett):** yes, footer card under the registration form — same `loadContactInfo()` source and the same voice the intake page already uses ("Questions, or prefer to register by phone? Email … or call … — we'll take care of it"). One server-side include on `/register/[id]`; no new settings.

### PL-13 · CX / CX-W (cancellation) templates aren't in the registry
Fine if intentionally composed in the cancel flow; if code-side, they're now the only parent emails not editable in the registry. Batch the decision with the T1–T8 registration fast-follow.
💡 **Recommendation (awaiting Scarlett):** batch with the T1–T8 → A4 registry fast-follow as one "register the stragglers" pass (CX, CX-W, T1–T8) so the registry becomes the single rule: *every parent-facing email is editable there*. No urgency before Aug 20 — cancellations are rare and the copy is stable — but doing them together avoids a third straggler category later.

### PL-32 · Duplicate students in the tutoring Students list
Likely pre-dedupe QA leftovers, but confirm: (1) data check for duplicate student rows; (2) verify every student-create path (class registration, intake submit, lead conversion) matches existing students within the family before inserting. If any path inserts blind, that's a bug.
✅ **Confirmed both halves — no bug.** (1) DB scan: the only duplicates are six April 9–22 QA rows in one family (4× "Desmond Roman", 2× "Desmond John"), all predating the family-match fix; each carries exactly one enrollment and nothing else (no engagements/scores/leads). (2) All three create paths match before inserting: class registration (`registration.ts` — email-then-name matcher), intake submit (`intake.ts`, same matcher), and the new PL-22 `create_family` (same rules). Parent-view already merges dupes for display.
💡 **Cleanup recommendation (awaiting Scarlett):** per duplicate identity, keep the oldest row, repoint the other rows' enrollments to it, delete the empties — happy to stage the script like the PL-1/PL-2 one.

---

## Suggested order

1. `AVAILABILITY_MATCHING_SPEC.md` (PL-19 + PL-28) — priority per Scarlett.
2. Chunk A (blockers/data) — before Aug 20.
3. Chunk B + C in one pass (mostly small; C is all in the tutoring panel).
4. Chunk D decisions with Scarlett, then implement.

---

## Paste-ready handoff prompt for Claude Code

> Read `docs/portal-fixes-2026-07-17.md` and `docs/AVAILABILITY_MATCHING_SPEC.md` in this repo.
>
> Work in this order: (1) implement `AVAILABILITY_MATCHING_SPEC.md` end to end (it includes the freebusy fixes labeled PL-28); (2) fix chunk A of the fixes doc (PL-1, PL-2, PL-15, PL-22, PL-5, and reproduce/fix PL-3), including the one-time data fixes it calls for; (3) do chunks B and C in a single pass — they're small renders, copy, and tutoring-panel UX, all file-pointed in the doc; (4) for chunk D, post your recommended answer for each open decision (PL-10, PL-12, PL-13, PL-32 findings) and wait for Scarlett before implementing.
>
> Rules: keep PL-x IDs in commit messages; don't touch the intentional QA data listed at the top of the fixes doc; Stripe stays in test mode and QBO in sandbox; run the existing E2E/regression checks after chunks A and C; the standing copy rules apply to everything you write (plain-English statuses, "Ops Director", no "engagement" in UI copy, human-help contact block on parent surfaces). When done, update `docs/portal-fixes-2026-07-17.md` with a ✅/note per item, same as prior fixes docs.
