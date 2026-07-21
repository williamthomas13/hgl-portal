# Portal fixes — batch 7 (July 2026, follows batch 6)

One item this batch — it was drafted into batch 6 after Code had already shipped it, so it moves here unchanged. Continues PL-x numbering.

**Standing rules:** plain-English statuses · "Ops Director" · never "engagement" in UI copy · contact block on parent surfaces · `git push` after committing · PL-x IDs in commits · check items off here when shipped · realistic sample data (PL-56 standard) for anything new in the registry.

---

## PL-66 · Register ALL remaining hardcoded emails + organize the registry with headings ✅

> **Shipped — 24 new registrations, all code-copy drafts (`live=false`), zero wire changes until you flip them.**
> - **Counselors & schools (7):** CD_COUNSELOR_DIGEST, FP_DEADLINE_PUSH, FP_ALT_CLASS_FULL, CR_CLASSROOM_REQUEST + CR_CLASSROOM_NUDGE_2/3, CX_C_CANCELLATION — full markdown bodies transcribing the code copy, registered under the keys history rows already use.
> - **Tutors & staff (2):** T5_TIMECARD_READY, T3_TUTOR_NOTICE.
> - **Internal [HGL Admin] alerts (15):** registration, roster report, #4 hold-and-alert, missing-details warning, min-enrollment checkpoint, waitlist rollover, no-instructor nudge, webhook failure, QBO failure, billed-without-agreement, availability-shared, intake-complete, and the dunning trio (retries-exhausted, 10-day, 30-day). `sendAdminAlert` gained `templateKey`/`vars`: framing (subject + body) is editable in the registry, the composed guts ride the new `{alertDetailsBlock}` block variable, and the `[HGL Admin]` prefix is always added by the sender. Every call site passes its key + scalars ({alertStudentName}, {alertCounts}, …).
> - **Exclusions per doc:** the magic sign-in email stays code-only. **Doc corrections found during the sweep:** the LR combined welcome was already registered and registry-rendered (LR_WELCOME, webhook + cron both) — nothing to do; there is no consult-confirmation email (consult scheduling creates a Google Calendar event only), so "consult" is covered by the intake-complete alert registration. Minor unnamed alerts (paid-after-cancel, resume mismatches, schedule-approval pings, gcal failure, etc.) remain code-only; the `templateKey` mechanism now exists whenever they're wanted.
> - **Registry organization:** the templates page shows the grouped headings with per-group counts — verified live: Class sequence (14) · Payment reminders (4) · Waitlist & interest (4) · Cancellation (2) · Agreements (2) · Tutoring families (12) · Counselors & schools (7) · Tutors & staff (2) · Internal admin alerts (15). Flat scan feel kept within groups; AG_* got the small Agreements group.
> - **Sample data:** every new registration renders truthfully (counselor "Marisol", worked digest card, "3 days left"/"3 spots", timecard "14.5 hours, September 1 – 15", worked alert details block); new URL variables ({classroomFormLink}, {timecardLink}) fall back to the portal link, never "#".
> - **Verification:** `npm run regress:links` now audits **drafts too** (a template can't flip live with a dead link) — 90/90 incl. all 24 new. Wire-identity proven: golden diff of every touched renderer against the pre-PL-66 commit (14/14 byte-identical after whitespace normalization), cancel-class regression 11/11 through the converted CX-C path, and a live sendAdminAlert call with a draft template delivered the exact code-twin subject with the AL_ key stamped on the history row. Ready for your ramp: test-send sweep → review → flip, same as the parent/student set.

Every outbound email still composed purely in code joins the template registry as a **code-copy draft** (identical ramp: the code twin keeps sending until Scarlett test-sends, reviews, and flips each live). From the code sweep of `email.ts` / `intake-emails.ts` / `timecards.ts` / alert senders:

- **Counselor/school-facing:** enrollment digest (`{schoolNickname} enrollment update — …`), final-days push (`{d} days left to register for {label}`), the full-roster variant (`{label} is full 🎉`), classroom request (`Where will {label} be held?`) + both re-nudges (`Still need a room…`, `Last call: room needed…`), counselor cancellation heads-up (`{label} has been cancelled`).
- **Family-facing stragglers:** the LR combined-welcome inline variant (`You're in — and here's everything you need for {className}`), consult/intake confirmations.
- **Staff/tutor-facing:** timecard confirm request + related tutor notices.
- **Internal `[HGL Admin]` alerts:** new registration, roster report, #4 hold-and-alert, min-enrollment checkpoint, waitlist rollover, payment webhook failure, QBO sync failure, billed-without-agreement, availability-shared, dunning/Ops escalations. Register with their composed data blocks exposed as **block variables** (framing copy editable; computed guts stay composed) — same pattern as T2/T4/CX.
- **Exception (recommended; Scarlett may override):** the magic sign-in link email stays code-only — a copy edit that breaks its link variable locks users out of the portal. Exclude it from the registry.
- **Registry organization:** the templates page gets grouped headings with per-group counts — *Class sequence · Payment reminders · Waitlist & interest · Cancellation · Tutoring families · Counselors & schools · Tutors & staff · Internal admin alerts*. Keep the flat scan/search feel within groups. (AG_REQUEST/AG_NUDGE from PL-63 slot under Tutoring families or a small Agreements group — Code's call.)
- Every new registration ships with realistic sample data so Scarlett's test-send review reads truthfully; the PL-60 link audit (`npm run regress:links`) must cover the new templates' URL variables too.
- After shipping, Scarlett runs the ramp on the new set (test-send sweep → review → flip), same as the parent/student set.

---

## Paste-ready handoff prompt for Claude Code

> Read `docs/portal-fixes-2026-07-24.md` (batch 7 — one item, PL-66).
>
> Register every remaining hardcoded outbound email in the template registry as code-copy drafts per the doc's list (counselor set, LR inline variant, consult/timecard notices, and the full [HGL Admin] alert family with composed blocks exposed as block variables), excluding the magic sign-in email. Add the grouped headings with per-group counts to the templates page. Give each new registration realistic sample data, and extend `npm run regress:links` to cover their URL variables. Nothing changes on the wire until Scarlett flips templates live — verify the code twins keep sending identically while drafts exist.
>
> Rules: PL-x IDs in commits; `git push` after committing; standing copy rules apply; check this item off here when shipped.
