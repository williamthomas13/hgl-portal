# Portal fixes — batch 4 (July 2026, follows batch 3)

From live template review + a real cancellation exercised end-to-end (Nido, July 18). Continues PL-x numbering (batches 1–3: `portal-fixes-2026-07-17.md`, `-19.md`, `-20.md`). Two items, both decided by Scarlett.

**Standing rules:** plain-English statuses · "Ops Director" · never "engagement" in UI copy · contact block on parent surfaces · `git push` after committing · PL-x IDs in commits · check items off here when shipped.

**Live context:** the Nido QA class is now genuinely **cancelled** (deliberately, to render a real CX_FAMILY — it worked, offer stack and add-on variant included). Its 9 orphaned scheduled sends were hand-cancelled with reason "PL-55 manual cleanup" — that manual step is the bug evidence, not something to undo.

---

## PL-54 (approved, incl. part b) · "You'll hear first" becomes a real mechanism

CX-W currently promises "just reply to this email and we'll make sure you hear first" — a reply into an inbox with no system behind it. Replace with an automatic interest list + notify flow.

### a. Interest list, auto-populated at cancellation
- New table (suggest `class_interest`): family/contact email (+ student where known), school_id, class_type, source (`cancellation | public_form`), created_at, notified_at nullable.
- On class cancellation, every **waitlisted** family is added automatically (they already asked to be in). Dedupe on (email, school, class_type).
- **CX-W copy change (approved direction; wording final unless Scarlett edits in the editor):**

> You're still on our list — the moment a new {schoolNickname} {classType} course opens, you'll be the first to know. Nothing to do on your end.

### b. Public "tell me when the next one opens" (approved to ship now)
On the public registration page's **closed** and **full** states (and the cancelled-class state), add a minimal email-capture: one email field + optional student name → creates a `class_interest` row with source `public_form`. Friendly confirmation inline ("You're on the list — we'll email you when the next {schoolNickname} {classType} course opens."). No account, no payment, no extra fields — this is demand capture, keep it frictionless. Rate-limit / dedupe politely (re-submitting the same email just reconfirms).

### c. Notify flow — admin prompt, not silent auto-send
- When a class is created (or reopened) matching school + class_type of unnotified interest rows, the admin class card shows: **"N families are waiting to hear about this class — notify them?"** with a preview count and one confirm.
- On confirm: each gets the new notify email (template key suggestion `NW_NEXT_CLASS_OPEN`, from info@, registered in the editor like everything else): short, warm, registration link/button, "first come, first served" implied not stated. Mark rows notified. Log in `email_sends` (class_id set) so it shows in comms History.
- Prompt (not auto-send) is deliberate: classes are sometimes created before they're ready to announce — the Ops Director picks the moment; the system does the remembering.
- Suggested notify copy (seed as v1, editable):

> Subject: A new {schoolNickname} {classType} class just opened
> Preheader: You asked us to tell you first — here it is.
>
> Hi {parentFirstName},
>
> You asked us to let you know when the next {schoolNickname} {classType} course opened — it's open now:
>
> {classSummaryLine}
>
> [button:See details & register]({registrationLink})
>
> Spots fill in order of registration, so don't wait too long.
>
> {contactBlock}

## PL-55 (confirmed bug, pre-launch) · Cancelling a class must cancel its pending emails

**Repro (live, Nido cancellation July 18):** confirm-cancel ran — class flipped to cancelled, CX_FAMILY composed+delivered correctly (offer stack, add-on variant — that part is solid) — but the class's **9 scheduled sequence sends survived** (#4/#5/#6/#7/#8 for the enrolled family, parent + student). #4 "Class details" was due the next morning: the "we cancelled your class… here's your classroom" failure mode. Spec (Phase 4 §12) says all pending sends cancel atomically with the cancellation.
**Fix:** the cancel-class handler bulk-cancels every `scheduled`/`held` row with that class_id (status→cancelled with reason, matching the comms-dashboard convention), in the same transaction as the status flip and CX sends — or ordered so a failure is loud, never swallowed. Investigate why it didn't run (missing step vs swallowed error mid-sequence).
**Regression test:** cancel a class with a populated schedule → assert zero scheduled/held sends remain for it, CX delivered, status cancelled — one atomic outcome.
**Adjacent verify (same flow):** the "school contact gets a heads-up" send produced nothing for Nido — likely because the school has no contact on file. Confirm that's the reason, and make the compose panel say so explicitly ("no school contact on file — nobody to notify") instead of silently skipping.

---

## Paste-ready handoff prompt for Claude Code

> Read `docs/portal-fixes-2026-07-21.md` (batch 4 — two items, decided).
>
> Do PL-55 first (small, pre-launch: bulk-cancel pending sends atomically with class cancellation + the regression test + the no-school-contact visibility fix). Then PL-54: the `class_interest` table, auto-population of waitlisted families at cancellation, the approved CX-W copy change, the public capture on closed/full/cancelled registration states, the admin "N families are waiting — notify them?" prompt, and the `NW_NEXT_CLASS_OPEN` template (seed copy in the doc, registered/editable, from info@).
>
> Rules: PL-x IDs in commits; `git push` after committing; new templates join the editor registry; standing copy rules apply; the Nido class stays cancelled (it's the QA evidence); check items off in this doc as you ship.
