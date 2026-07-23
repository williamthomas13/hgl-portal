# Portal fixes — batch 15

Thirteen items, PL-100…112 — Scarlett's UI/UX review pass (Jul 23). Bigger than usual: one new page (the dashboard), one nav restructure, new schema (tutor pay), and a pipeline rework. Continues PL-x numbering.

**Standing rules:** plain-English statuses · "Ops Director" · never "engagement" in UI copy · no internal shorthand in reader-facing bodies (PL-98) · every alert deep-links its record + one-click actions (PL-92) · `git push` after committing · PL-x IDs in commits · check items off here when shipped.

## PL-100 · Admin dashboard landing page (Needs Attention + Recent Activity)

After login, admin lands on a dashboard page — cards laid out side by side (square/rectangular grid, NOT full-width bands like the current sections).

- **Needs Attention card:** the to-do. **Mirrors the internal alert family** — every condition that fires an email alert also renders here as a row with the same PL-92 deep-link + one-click actions. CRITICAL (Scarlett's explicit requirement): rows must be **state-driven, not send-driven** — derive each row from whether the underlying condition is STILL true (class still teacherless, availability still unscheduled, invoice still unpaid), so acting from the email, the record page, or anywhere else clears the dashboard row automatically. It is truly "what needs attention now", never a stale inbox. Examples: availability shared but not scheduled · class needs an instructor · forms not filled out · autopay failed and family unpaid x days · everything else in the AL family.
- **Recent Activity card:** informational, no action required — new registration, counselor entered classroom details, family shared availability, payment received, timecard submitted. Read-only feed, most recent first, each row linking to its record.
- Open to additional cards where they earn their place — reasonable candidates: upcoming classes at a glance (starts date + paid/min/cap), this week's tutoring session count, next monthly-generation date. Keep it restrained; Needs Attention is the star.
- The existing admin sections remain reachable (see PL-101's nav); the dashboard is the new default landing after login.

## PL-101 · Vertical section navigation (browser-tab style sidebar)

The admin categories are currently stacked horizontally and require scrolling to see them all. Reorganize as a **vertical tab list** (sidebar, like browser tabs / standard app nav): all sections visible at once, one click to switch, active section highlighted. Applies to the main admin page structure; keep deep-link params (`?family=`, `?invoice=`, `?schedule=`, `?class=`…) working — they should select the right vertical tab on arrival (mind the PL-99 late-mount lesson).

## PL-102 · "View as" — see the portal as parent / manager / tutor / school contact

From the admin side, a way to see what each other role sees: parent view, manager view, tutor view, school-contact view. Admin-only control (e.g. a "View as…" switcher) that renders the chosen role's portal view, clearly bannered ("Viewing as {role} — back to admin") so it's never mistaken for the real thing. Read-only impersonation is fine (no acting as the role); pick a representative record where the view needs one (e.g. viewing as parent needs a family — offer a picker). Never leaks admin-only data into the rendered view (this is exactly the pay-visibility boundary in PL-104 — verify the manager view hides amounts).

## PL-103 · Tutors are paid for group classes they teach — into the timecard under a class pay scale

Group-class teaching currently has no pay path — timecards only know 1-on-1 tutoring sessions. Class sessions taught must flow into the instructor's timecard under the class pay category (see PL-104's work-type model). Sessions come from the class schedule; attendance/held status confirms them (ties into PL-106's attendance move).

**Reference — the current paper timecard's columns (Scarlett's screenshot, Jul 23), which define the work-type categories:** Date · Student · Subject · then hours by type: **Test Prep · 1-on-1 · 2-on-1 · Prep Time · Class/Workshop · Other** · Notes. The portal timecard should carry these same work types so nothing the old sheet captured is lost (2-on-1, Prep Time, and Other are real categories today, not just tutoring vs class). These align with the QBO Payroll pay-type names (see PL-104) — per-tutor extras like "chem prep" or "International onsite" fold under the tutor's own title list.

## PL-104 · Tutor pay scales with role-gated visibility + quick timecard verification

- **Pay model — TITLES ONLY, NO AMOUNTS (Scarlett's call, Jul 23):** payroll runs through QBO Payroll, where each employee already has base pay + named additional pay types with their own rates (per-person rates — e.g. Class/Workshop differs per tutor; one-off types like "chem prep" and "International onsite" exist). The portal must NOT duplicate dollar amounts anywhere — no rates in schema, UI, or exports. What it stores per tutor: the list of **pay-type titles** that tutor has in QBO (admin-editable; base pay = the 1-on-1/Test Prep default), so timecard hours are attributed to the right title. This dissolves the amount-visibility question — there are no amounts in the portal for anyone to see.
- **Payroll handoff:** an approved timecard produces a per-tutor **summary of hours by pay-type title** for the pay period (on-screen + copyable), so entering it into QBO Payroll is a transcription glance, not a reconciliation.
- **Visibility:** with no amounts in the portal, titles are visible to admin and manager alike (that was always fine — Kelsie sees titles). Editing a tutor's pay-type title list stays admin-only.
- **Manager approves timecards** (confirm current capability, keep it).
- **Quick-verify button:** on a timecard under review, one click shows that tutor's **scheduled sessions for the pay period** (from the calendar/engagement records) next to the claimed hours — so when Gwendolyn requests a change, verification is a glance, not a lookup expedition. Same state-driven honesty as everywhere: show the schedule as recorded, flag mismatches, decision stays human.

## PL-105 · Score entry: auto-total, fixed sections per exam, two diagnostic slots

- Total score is **calculated, not typed** — currently you can enter EBRW + Math and then anything at all as the total. SAT: total = EBRW + Math, computed and read-only.
- Sections are **fixed per exam type**, not freeform add-a-section: SAT class → EBRW + Math only. ACT class → the corresponding ACT sections (English, Math, Reading, Science) with the composite computed per ACT rules (rounded average of the four) — read-only composite, same principle.
- **Two diagnostic slots per student: first diagnostic and second diagnostic** (the sequence already has both moments — #2 and #6). Entry UI and display show both, clearly labeled.

## PL-106 · Collateral into "Add a new class"; rosters lead with students; attendance moves to instructor view

- **Collateral creation moves into the "Add a new class" flow** — it's part of creating a class, not a roster-page afterthought. (Regeneration after schedule changes stays reachable from the class card.)
- **Live class rosters lead with the registered-student list** — FIRST thing on the card: who's registered (and paid state). Sessions and the rest come after.
- **Attendance moves to the instructor view** — the person who taught marks who attended. It **live-updates in the admin view** (read-only reflection) with an **admin override** for corrections. Ties into PL-103: attendance/held status is what feeds class-teaching pay.

## PL-107 (tiny) · "Video FAQs" is actually "VERY FAQs" ✅

> **Shipped.** Renamed in `comms.ts` (TEMPLATE_LABELS — drives the timelines/dashboard labels), the seed source, and the live registry row (`email_templates.display_name` updated in place, guard-matched on the old name). Those were the only two occurrences in code (grep-verified); the template key stays internal per PL-98.

The #3 template's display name is wrong: `#3 — Video FAQs` → **`#3 — VERY FAQs`** in `comms.ts` (E3_VFAQ), the seed, and anywhere else the display name renders. Template key can stay; it's internal (PL-98 keeps it out of reader-facing copy anyway).

## PL-108 (small) · Lost leads capture a reason ✅

> **Shipped, guard matrix 7/7 + browser-verified.** Closing a lead (the "Close — not now…" button AND picking the status in the dropdown — both intercepted) prompts a quick-pick cause (price / timing / went elsewhere / no response / other) plus free text — optional normally, **required for "other"**; never blank (server-enforced: a reasonless first close is a 400 and the lead stays open). Stored on the lead (`lost_reason_kind` + `lost_reason`, migration `20260806000001` **applied**); shown as a chip on the pipeline row (hover reveals the free text) and a line on the record. Guard subtlety caught during verification: an explicit-null re-close used to wipe the stored reason through the field pick — now the stored reason is preserved (matrix-verified).

Moving a lead to closed (see PL-109 for the rename) prompts for a **reason** — short free-text plus a few quick-pick common causes (price, timing, went elsewhere, no response, other). Stored on the lead, shown on the record and in the pipeline row hover/detail. Not required to be an essay; required to not be blank.

## PL-109 · Pipeline: statuses prompt the next step; "Won"/"Lost" renamed ✅

> **Shipped, browser-verified.** Renames: "Scheduled — won" → **"Started"**, "Lost" → **"Closed — not now"** — verified live that neither old label renders anywhere on the pipeline (labels only; the internal enum values stay, so nothing downstream breaks — the engagement route's auto-advance to Started is untouched, comment updated). **Every status carries its next move on the ROW** (new `NextStepButton`): new/contacted → [Send intake form] (or "next: get a contact email" when there's none) · intake_sent → [Re-send intake form] · **intake_complete / consult_done / proposal_sent → [Schedule {student}]** deep-linking the wizard preload (`?schedule=` — the PL-99-verified flow; intake stamps `student_id`, so the button lights up the moment intake completes; without a student record it points at the detail's "Create family + student") · consult_scheduled → [Mark consult done] · Started → a quiet "see the schedule" link. Buttons stop propagation so the row still expands normally; verified rendering on a live lead.

- Every pipeline status should **surface its next step as an action**, not just sit as a label. "Intake complete" → the record prompts "Schedule {student}" (wizard deep-link, windows preloaded — the PL-92 pattern applied inside the app). Map each status to its one obvious next move (new → contact/intake; intake complete → schedule; scheduled → confirm/start) and put that button on the row/record. The pipeline's job is moving students toward tutoring.
- **Rename (Scarlett's pick): "Won" → "Started", "Lost" → "Closed — not now".** Update everywhere the labels render (pipeline columns, filters, records, any reports/digests); plain-English statuses rule applies. "Closed — not now" pairs with PL-108's reason.

## PL-110 · The scheduling wizard recognizes prospective students (kill the "never re-enter" warning by making it unnecessary)

Context for the current warning: the wizard's student list only contains already-created families, so a new family typed there would duplicate one that exists as a lead — hence "add them on the prospective students page first." Scarlett's point stands: the portal should just KNOW. Fix:

- The wizard's student search also searches **prospective students/leads** (by student + parent name/email). When the match is a lead (Ana, daughter of Alex, already in the pipeline), surface it FIRST — "Ana García — prospective student" — and picking it **pulls the lead through**: creates/links the family+student from the lead record (the same machinery as the leads page's "Create family + student"), carries intake availability into the wizard (the PL-92 preload), and advances the pipeline status (fits PL-109's next-step flow: scheduling IS the next step after intake).
- Creating a genuinely-new family from the wizard is then allowed through the same path (it creates a lead-backed record, not an orphan) — and the warning text goes away entirely.
- Dedupe guard: same-name/same-email match prompts "is this the same family?" before any create.

## PL-111 · Required session notes for 1-on-1 sessions (simple), parent-visible, reminder cadence, timecard gate

- After each 1-on-1 session, the instructor adds a **short session note** — simple by design (what we worked on, a line or two; maybe an optional "for next time"). No rubric, no friction.
- **Notes live on the student's record** in the DB — the durable history. Two read surfaces: (a) **any substitute/covering tutor** can read the student's note history (this is the handoff file — pairs with PL-112); (b) **the parent portal** shows the notes for their own student — what they worked on with the tutor that day. Parent-visible means parent-appropriate: instructors should be told (small inline hint) that parents read these. RLS accordingly: instructors write/read for students they teach or cover, parents read their own student's, admin/manager read all.
- **Cadence, because back-to-back days are real (4–5, 5–6, 6–7, 7–8):** notes are ideal right after each session, but the enforcement is friendly — an **end-of-day reminder** listing that day's sessions still missing notes (one email, not one per session; only sends when something's missing), then **one nudge 2–3 days later** for anything still open. No infinite nagging beyond that — because the backstop is:
- **Timecard gate: a timecard cannot be approved while any of its period's sessions are missing notes.** The approval screen shows exactly which sessions are open (deep-linked, one click to the note form — PL-92 pattern), so the fix is quick, not a hunt. This also slots into PL-104's quick-verify view: session rows there show note-present state.

## PL-112 · Substitute coverage: tutor-initiated request via the matching wizard (subjects only) + "the Manager can help" prompt

- A tutor who needs coverage gets an **easy "Request a substitute"** flow from their portal view for a session/date range.
- Candidate matching reuses the tutor-selection machinery **filtered to subject qualification ONLY** — deliberately OMIT the admin-side fit/style notes (the "what kind of student this tutor works well with" notes are admin-eyes-only and must not render to tutors; verify they're absent from the response payload, not just the UI, same server-side discipline as PL-104).
- The request notifies the chosen candidate (accept/decline) and alerts Ops on every request + resolution (standing alert rules apply: deep-links, state-driven Needs Attention row per PL-100 — "this session still needs coverage").
- Alongside the self-serve path, always prompt: **the Manager can help find a suitable replacement too** — by POSITION, not name (Kelsie today, but never hard-coded; render the role's current holder from config/roles, or just say "your manager" with the contact from the role record).
- A confirmed substitute gets what they need to walk in: the session details, the student's availability/location, and **the student's session-note history (PL-111)** — that's the handoff.

**Verify (batch-wide):** E2E per item · pay-amount visibility tested as manager role AND via view-as · dashboard rows clear when the condition resolves from a non-dashboard path · wizard lead pull-through creates no duplicate family · existing suites (links, pronouns, cancel-class, PL-92) green.
