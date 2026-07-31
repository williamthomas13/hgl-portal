# Portal fixes — batch 25 (ALL 11 SHIPPED Jul 31)

**Batch closed and handed off Jul 31, 2026.** Eleven items: PL-243…PL-245 (copy fixes from the Jul 30 review) and PL-246…PL-253 (availability calendar + live class roster UX from the Jul 31 review).

**Shipped Jul 31 (same day).** Gate battery green: `tsc`, `npm run build`, smoke:public (8), regress:links, regress:pronouns (49), regress:mutation-buttons, regress:client-imports, cancel-class (11), resume-addon. Template versions: **CS_CLASS_CONFIRMED v4 live** (only version published this batch — see the PL-245 note for why E0 needed none). No migrations. **Two doc-premise corrections flagged inline: PL-244 (the letter never had "Best," — signoff added per stated intent) and PL-245 (no E0 version bump needed — the sentence lives in the composed block).**

**Standing rules:** plain-English statuses · no internal shorthand · every alert deep-links its record · samples from composers · `git push` after committing · PL-x IDs in commits · check items off here when shipped · registry template edits ship as new versions with matching code twins (never drift) · verify composed blocks via the composer path, not editor samples (PL-234 lesson).

---

## PL-243 — CS counselor welcome: trim the school-portal paragraph again (reported Jul 30, from the live "Everything's ready for ISD QA Wizard Test" send)

In CS_CLASS_CONFIRMED's portal paragraph, "In it you'll find live enrollment for {className}, attendance, and diagnostic scores once the class is underway, and fresh downloads of the letter and flyer in every format{collateralLanguagesPhrase} — always reflecting the latest class details, so you never have to worry about a stale copy." becomes:

> "In it you'll find live enrollment for {className}, attendance, and diagnostic scores once the class is underway."

(Drops the fresh-downloads clause entirely. New version via anchor-guard; single copy source — the PL-237 no-collateral strip must still compose cleanly with this shorter paragraph.)

✅ **Shipped Jul 31 — CS_CLASS_CONFIRMED v4 live.** Published by `scripts/seed-pl243-cs-trim.mjs` (anchor-guard on the exact old paragraph; idempotent — second run no-op'd). The script also refuses to publish unless all three PL-237 strip anchors (" I've attached the materials for you:" + both bullets) survive in the new body, so the fail-closed no-collateral strip keeps working — verified live through the real compose path (`GET /api/admin/class-confirmed` preview: short paragraph in, "fresh downloads"/"stale copy" gone, attachment list intact, `canSuppress` still true). Seed mirror `comms-template-seed.ts` synced in the same commit. Note this template deliberately has NO code twin (PL-214) — the registry is the only copy source.

## PL-244 — Letter + flyer signoff: "Best," → "Thanks!" (reported Jul 30)

In the generated parent letter (and the flyer if it carries the same signoff), the closing "Best," becomes "Thanks!". This is the collateral generator (PDF/JPG letter + flyer), not an email template — update the generator copy and regenerate samples to confirm.

✅ **Shipped Jul 31 — with a PREMISE CORRECTION, please read.** The generated letter never contained "Best," — it went closing paragraph → signature image → "William Thomas" → title, with **no valediction at all** (verified in `collateral-templates.ts` and in fresh renders; the flyer carries no signoff either — nothing to change there). The only "Best," near that send is in the **CS counselor emails** (CS_CLASS_CONFIRMED / CS_COLLATERAL_FOLLOWUP bodies), which this item explicitly says not to touch — so those were left alone. What shipped: the letter now closes with **"Thanks!"** ("¡Gracias!" in the Spanish letter) as a new valediction line between the closing paragraph and the signature — matching the stated end state. Verified with fresh EN and ES JPG renders through the real artifact endpoint; the ES letter's tighter layout still clears the bottom strip. **If you actually meant the email's "Best," → "Thanks!", say the word — it's a two-line follow-up.**

## PL-245 — E0_CONFIRM_PARENT tutoring-upsell reword (reported Jul 30, from [TEST E0_CONFIRM_PARENT v6]) — exact strings

In the add-on tutoring block: "Want to start earlier instead? [Share your availability]({availabilityLink}) and we'll propose times. Not sure yet? No problem — we'll ask again once the class is done." becomes:

> "If you want to start earlier instead, just [share your availability]({availabilityLink}) and we'll propose times. It's no problem if you're not sure yet; we'll ask you again once the class is done."

(E0 → next version via anchor-guard + code twin. Note: this sentence likely lives in the {addonTutoringBlock} composed block — per the PL-234 lesson, fix the COMPOSER source and keep the editor sample in sync.)

✅ **Shipped Jul 31 — the parenthetical hunch was right, so NO E0 version was published.** Verified against the live E0 v6 body: it holds only the `{addonTutoringBlock}` placeholder, not the literal sentence, so the composer edit reaches live sends immediately and a v7 would have been an empty diff. The sentence turned out to live in **two** composer copies that must change together — the registry variable in `comms-variables.ts` and `addonTutoringBlockHtml()` in `email.ts` (the code-twin fallback; the "one source of truth" comment there was wrong and has been corrected). Both now carry the new wording verbatim. The editor sample composes through the same variable (SAMPLE_CONTEXT has a 5-hour add-on), so it updated itself — verified through the templates preview API: new sentence renders with the availability link, old copy gone.

## PL-246 — "Who's free to teach it" calendar: "Close suggestions" → "Minimize suggestions" (reported Jul 31)

On the teacher-availability calendar reached from a live class roster's "Who can teach it?", the "Close suggestions" control becomes **"Minimize suggestions"** — a collapse that can be re-expanded. Today, closing the suggestions panel loses it with no way to bring it back short of leaving the page. Minimized state should show an affordance (e.g. "Show suggestions") to restore it.

✅ **Shipped Jul 31.** "close suggestions" (which cleared the class context for good) is now "minimize suggestions"; minimized, a slim bar stays in its place — "Suggestions for [class] are minimized · show suggestions" — and restoring brings the full panel back with selections intact. The purple class-session outlines and any instructor overlay stay on the calendar while minimized (that's the point of minimizing — more room to look at the grid). Verified in the browser: minimize → panel gone + bar present → restore → panel back.

## PL-247 — Availability calendar: Billy's calendar populates whether or not he's selected (reported Jul 31)

On the same calendar, Billy's events appear even when he isn't among the selected teachers. Only the calendars of currently selected teachers should render; deselecting a teacher must remove their events.

✅ **Shipped Jul 31.** Root cause: switching the overlay from one instructor to another (or stepping weeks) never blanked the previous instructor's gray busy bands — they stayed painted under the new selection until the new Google fetch resolved, which is exactly "Billy's calendar shows though he isn't selected" (Billy being the most-selected instructor). The overlay effect now clears the bands the instant the selection or range changes. Verified deterministically in the browser with an artificially slowed freebusy response: during the new instructor's fetch the band count is 0 (was: previous instructor's 10), and deselecting drops to 0 immediately. Note the colored class/tutoring blocks are everyone's by design (that's the shared calendar view — filter with the "everyone" dropdown); only the gray Google-busy overlay is per-selected-teacher.

## PL-248 — Availability calendar: add week navigation (reported Jul 31)

The calendar is locked to the current week. Add forward/back week navigation (and ideally a "jump to class dates" or date picker) — the class being staffed often doesn't run in the current week, which makes the view useless for it. Default the view to the week the class starts when arriving from a class context, if that's straightforward; otherwise current week is fine as long as I can page forward.

✅ **Shipped Jul 31.** Small premise note: ‹ / today / › week-month navigation already existed in the controls bar — what was missing was that arriving with a class context still landed on the current week. Now, arriving via "who's free to teach it?", the view jumps straight to the week of the class's first upcoming session (the fit API already computed it; the page just never used it), once per class so your own paging afterwards isn't fought. A **"jump to class dates"** link in the suggestions panel brings you back to the class's week from anywhere. Verified: opening the Aug-5 class's calendar on Jul 31 lands on "Week of 2026-08-03".

## PL-249 — Availability calendar: assign the teacher from here, or return to the roster to assign (reported Jul 31)

When the calendar surfaces a teacher who's free, there's no way to act on it. Add an **"Assign to class"** action on a suggested/selected teacher (assigning them as instructor of the class this calendar was opened for), and/or a back button that returns to the originating live class roster page so the assignment can be made there. Pairs with PL-250 (roster-side assignment) and PL-253 (contextual back navigation).

✅ **Shipped Jul 31 — both halves.** Every non-current candidate row now has **"assign to class"** with an in-page arm-then-confirm (the ConfirmAction pattern; if the candidate has conflicts the confirm says so — you can still assign, informed). On confirm it calls the **new `POST /api/admin/assign-instructor`** — the first surface that can write `classes.instructor_id` outside the creation wizard (staff-gated; refuses cancelled classes and inactive instructors; accepts null to unassign; fast-path `syncInternationalCalendar` after write, same as cancel-class — instructor comms/calendar converge via the hourly sweep as everywhere else). Success shows "[name] is now the instructor for this class" with a link back to the roster, the ranking re-fetches so the "currently assigned" badge moves, and the header gains the PL-253 back link. Verified end-to-end in the browser: assigned a candidate, badge moved, unassigned via the API's null path, roster restored.

## PL-250 — Live Class Rosters: assign/edit instructor, Synapgroup, and class location from the roster page (reported Jul 31)

There's currently no way to assign the instructor from a live class roster, and we often don't know who's teaching until much later. From the roster page we need to be able to: (a) **assign or change the instructor**, (b) **edit the Synapgroup**, and (c) **see the class location and set/edit it** — e.g. when a counselor skips our form and just replies by email with the location. All three should be editable inline on the roster page.

✅ **Shipped Jul 31 — all three inline on the roster header.** (a) The instructor line is now a dropdown of active instructors (plus the current one even if since deactivated) with a confirm before each change; "not yet assigned" clears it. It goes through the same `assign-instructor` API as the calendar's PL-249 button, so consequences are identical from either surface. (b)+(c) Synap group and **Location are now always visible** (previously hidden entirely when unset — exactly wrong for "counselor replied by email with the room") with an *edit* link flipping to input + save/cancel — no `window.prompt`. Location edits play fine with the classroom-request machinery (its badge logic already handles set-directly). Verified in the browser: location set → survives refetch → cleared; instructor assigned via select → verified → unassigned; DB confirmed back to the pre-QA state.

## PL-251 — Live Class Rosters: date / start / end fields misaligned (reported Jul 31)

Where the roster shows date, start time, and end time, the start and end time fields render slightly lower than the date field. Functionality is fine — align the three fields inline on the same baseline.

✅ **Shipped Jul 31.** Actually the date field rendered *higher*, not the times lower: the add-session grid bottom-aligned its cells (`items-end`), and the little "= 15 August 2026" hint under the date input makes that cell taller — bottom-aligning it pushed the date input up a line. The grid is now top-aligned (`items-start`), so all three controls share the same line and the hint hangs below without moving anything. Applied to both copies of this form — the roster's add-session row and the wizard's identical session step (its Add-session button pinned back down with `self-end`). Verified by DOM geometry: date input and both time selects at the same rendered top.

## PL-252 — Record scores must require enrolled students (reported Jul 31)

"Record scores" currently works even when a class has no students enrolled. Scores have to be connected to students in the class, so with zero enrollment the action should be disabled (or fail closed) with a plain-English explanation like "No students are enrolled yet — scores are recorded per student." It becomes available once at least one student is enrolled.

✅ **Shipped Jul 31.** With zero students, expanding "Scores" now shows only: *"No students are enrolled yet — scores are recorded per student, so this unlocks as soon as the first student is enrolled."* — the entry form doesn't render at all (fail closed, one guard inside `ScoresEntry` so the instructor-view copy of the panel gets the same behavior; the family/tutoring surfaces always pass a student and are unaffected). "Enrolled" here means paid *or* pending — a pending student is in the class for scoring purposes. Verified in the browser on a zero-enrollment class.

## PL-253 — Contextual back navigation across deep-linked admin pages (reported Jul 31)

Pages reached by drilling in need a way back to where I came from, not just "Back to admin". Example path: Dashboard → Needs Attention → "Class details missing" → live class roster → "Who can teach it?" → calendar; from the calendar the only exit is "Back to admin", which dumps me at the beginning. Give these pages a back control that returns one step (e.g. "← Back to [class] roster"), preserving context. PL-253's canonical dead end is fixed and the rule audited everywhere.

✅ **Shipped Jul 31.** The calendar (the reported dead end) now shows **"← Back to the [class] roster"** whenever it was opened from a class — it deep-links `/admin?class={id}`, which lands on that exact roster tab; the same link also appears in the assign-success line. "Back to admin" stays as the secondary exit. Audit of the other drill-in pages: student and family profiles already return one step ("← Back to Contacts"); the remaining "Back to admin" pages (tutoring, agreements, leads, communications, match-payment) are one step *below* admin, so for them "Back to admin" IS the one-step back — nothing further to change today. Standing rule going forward: any page reachable from a record must carry that record's context in its URL and offer a one-step back link built from it.

---

**Approved with no changes (Jul 30 review):** all other batch-24 test renders — SV v2, T8 v4, and the rest of E0 v6.
