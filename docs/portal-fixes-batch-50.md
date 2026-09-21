# Portal fixes — batch 50 (CLOSED for hand-off Sep 21, 2026 — 9 items, PL-461…469)

**Standing rules:** all prior, plus the PL-460 rule (every call-to-action lands where the action can be done).

(Opened + closed Sep 21, 2026. Next PL: PL-470.)

**ORDER: the cutover waits on PL-463, PL-464, PL-465 — ship those three (and the small PL-467) FIRST and say so in the header note the moment they are on prod.** Then PL-466, PL-461, PL-462. Code does NOT run any import against prod — Scarlett + Claude run the dry runs and the imports themselves.

**Go-live state (Sep 21):** QA purge APPLIED on prod by Scarlett + Claude (1,297 rows + 3 QA logins; snapshot kept locally; post-purge dry run = 0 families / leads / contacts / sends, only `mis-sat-prep-fall26` survives). Eric + Kelsie are managers. Intuit app has BOTH development and production keys issued (Scarlett, Sep 21). Next: create Leone XIII school + current SLS / ASF / Leone XIII classes → silent import of the four rosters → public-page walkthrough → domain → QBO production → Stripe live → DNS.

## PL-461 — T1R "Updated proposal": the family hears back after a change request — and staff can close one WITHOUT an email (Scarlett, Sep 20–21)
PL-459 F stopped honestly: no family-facing re-send path exists. Build it, with the copy below (APPROVED by Scarlett Sep 21), and make the no-email close a first-class choice.
- **Three ways to close an open change request, side by side on the invoice row's change-request box (375px too):**
  1. **Send updated proposal** (primary once a session was changed or a note is typed) → sends T1R to the family (billing-contact routing per PL-454: same verdict as T1 — billing contact to, parent cc), marks the request handled, restarts the family's auto-confirm window from now.
  2. **Mark handled — no email** → for when staff settled it by phone/WhatsApp ("5:00 am" is unusual enough that Kelsie would rather call). Asks for a one-line reason (activity feed), sends NOTHING, marks handled. Then the row offers the two existing next steps plainly: **confirm for family** (they agreed on the phone — the existing control) or leave it awaiting the family's own confirm (auto-confirm window restarts from now, on the schedule as it now stands). Never auto-sends T1R later because a session changed — the email is a choice, not a side effect.
  3. **Reschedule a session** (PL-459 A) stays the way to make the change itself; it does not close the request.
  Same pattern as other staff-decides-whether-to-email surfaces in the portal (find the closest existing one and match its wording/controls rather than inventing a new idiom; name it in the ship note).
- **Preview before send:** the T1R button opens the rendered email (what changed + note) with Send / Back — staff see exactly what the family will get.
- **Registry template `T1R_UPDATED_PROPOSAL`** — `billing: 'copies-parent'`, audience parent, from info@, transactional, sequence `T1r`:
  - **Subject:** `Updated: {studentNames}'s tutoring schedule for {tutoringMonthLabel}`
  - **Preheader:** `We've replied to your change request — please take a look and confirm`
  - **Body:**
    ```
    ## {studentNames}'s updated {tutoringMonthLabel} schedule

    Thanks for letting us know what wasn't working. You asked:

    > {requestQuote}

    {staffNoteBlock}

    **What changed**

    {changeSummaryBlock}

    Here's the full {tutoringMonthLabel} schedule as it stands now:

    {scheduleBlock}

    {monthTotalLine}

    [button:Confirm schedule]({confirmOneTapLink})

    [Still not right? Request another change →]({confirmLink})

    If we don't hear from you within {autoconfirmDays} days, this updated schedule confirms automatically, exactly as shown.

    {contactBlock}
    ```
  - `{changeSummaryBlock}`: one line per session moved / added / removed since the proposal the family last saw, in the family's timezone — "Tuesday, Oct 27 — moved from 4:00 PM to 5:00 AM". Nothing changed (note-only reply) → "No changes to the schedule — see our note above."
  - `{staffNoteBlock}`: the typed reply, verbatim, as its own paragraph; omitted entirely when empty (no empty heading). `{requestQuote}`: the family's request text, escaped.
  - Deliberately NOT in this email: `{autopayBlock}`, `{packageNote}`, and T1's month-end policy sentence (they saw all three in T1; this email is about the one thing they asked for).
  - Sample data for the comms preview + the variable docs, like every registry template. Ships as a DRAFT for the usual review send → ramp.
- **Family proposal page:** after T1R (or a no-email close), the page shows the current schedule with Confirm live again and a small "Updated {date} in reply to your request" line; a second request re-opens the loop (pill back to "Change requested — needs our reply").
- **Staff email (PL-459 D) stays as approved;** its "then mark the request handled" clause becomes true in both senses once this ships.
- CTA registry: register the three controls + T1R's two links (PL-460 gate).

## PL-462 — Instructor view: `?class=` focus (proposed by Code in PL-460)
As proposed in the PL-460 ship note — instructor-facing links that name a class land on that class's card, scrolled + highlighted, not the top of the instructor view. Register in the CTA gate.

## PL-463 — Instructor comms + calendar must stay quiet for records-only and finished classes (found Sep 21 while preparing the silent import)
PL-457's audit row says instructor IN_WELCOME / DIGEST / MIN_DECISION are "gated by `instructors.comms_enabled`" — that column was DROPPED in PL-327 (`20260906000005`); the live gate in `instructor-comms.ts` is `pref_class_digests !== 'off'`, default ON, and the header comment there still describes the old switch. Consequence: assigning a real instructor (Gwen, Kevin, Rebecca…) to the SLS / Leone XIII / ASF / MIS record-only classes would send them an IN_WELCOME mid-class, roster-change pings as the import lands (the `today >= deadline && today <= lastSession` branch), and push class-session events to their Google calendars. **Workaround in force:** the new record-only classes are created with NO instructor (MIS keeps Billy) until this ships; then Scarlett sets the real ones — SLS: Gwen De Silva · MIS: Rebecca Baumher · Leone XIII: Kevin Marren · ASF: Kevin Marren + Eric Brown (her tracker's "Classes & Dates" tab; if a class can hold only one instructor, Kevin, and say so).
- **Evidence (Sep 21, 09:05 UTC):** minutes after the purge cleared the send log (and with it every dedupe key), the hourly sweep re-sent `IN_WELCOME` for `mis-sat-prep-fall26` — a class two weeks into its run — plus a `T5_TIMECARD_READY` for Sept 1. Both went to Billy only because MIS carries Billy as instructor; with Rebecca assigned it would have gone to her. So: once-per-class instructor sends have no date guard, only a dedupe key.
- **Created Sep 21 via the wizard (Claude, at Scarlett's request):** `sls-sat-prep-fall26` (8 sessions Mon/Wed Sep 7–30, 18:30–20:30 Milan, $749, deadline + cutoff Sep 4, NO instructor) and `asf-sat-prep-fall26` (in person, 10 sessions 14:45–16:00 Mexico City incl. the optional Sep 25 Skill Mastery Lab, $749, cap 18, deadline + cutoff Sep 8, NO instructor). `leone-sat-prep-fall26` created the same day (school "Leone — Istituto Leone XIII", Europe/Rome, with `billy@` as a PLACEHOLDER first contact at Scarlett's instruction — the form would not save without one, PL-467; 8 sessions Tue/Thu Sep 8–Oct 1, 18:30–20:30, $749, deadline + cutoff Sep 4, NO instructor). Per-class Synap groups set on all four; MIS price corrected 750 → 749; ASF location = "ASF campus — Room US 109".
- **A.** No instructor send and no gcal class-event write for a class whose last session is in the past (verify each of IN_WELCOME, digest, roster ping, min-decision, FYI; say which already had the guard).
- **B.** No instructor roster/welcome sends caused by `source='import'` `comms_muted` enrollments: a class whose Paid enrollments are ALL muted is a records-only class → instructor sends + gcal writes skip it (derive; no new column unless needed — say which).
- **C.** Correct the PL-457 audit row and the stale header comment in `instructor-comms.ts`.
- **D.** After it ships, Scarlett swaps the real instructors onto the four classes; verify nothing sends and no calendar events appear (send log + one instructor calendar).
- Extend `regress:silent-import` with the instructor assertions.

## PL-464 — Families without a parent email: key on the student's address, and never send the same person two copies (Scarlett, Sep 21)
"For the missing parent emails, we don't have them either — sub in the student email. Sometimes this happens. We may need logic that sorts by student email if parent email doesn't exist and/or only sends one email (for the times we email both parent and student) if parent and student email are identical." Two real cases in the rosters about to be imported (one ASF, one Leone XIII).
- **A. Import:** a row with a blank parent email and a student email imports with `families.parent_email` = the student's address (the family key stays ONE column — no second identity path), and the family is visibly marked "no parent email on file — using the student's address" wherever staff read the family (profile header + roster hover is enough). A row with NEITHER address is refused with a clear line, as today. Same rule for the staff "add a family/registration" paths if they require a parent email today — report what they do.
- **B. One person, one email:** wherever a send fans out to a parent leg and a student leg (`_p` / `_s` sequence twins, confirmations, SU schedule updates, cancellation, message-the-class, FO campaign, anything else the PL-457 audit listed as family/student), if the two legs resolve to the SAME address (case-insensitive, trimmed) send ONE. **Proposed rule — Scarlett's veto:** the PARENT version goes (it carries the money/logistics the student version omits); the student leg is recorded in the send log as cancelled "same address as the parent leg" so the log stays honest and the dedupe key is claimed. Do it at the ONE choke point if the fan-out has one; otherwise a shared helper both loops call — not per-call-site expressions (the PL-454 lesson).
- **C.** Also collapse when a billing contact (PL-454) equals the parent or student address — never two copies to one inbox.
- **D. When a real parent email turns up later:** staff edit the family's parent email through the existing family-facts path; the marker clears itself; logins follow the new address. Verify; no new UI unless that path can't do it.
- Gate: extend `regress:billing-recipient` (or a sibling) — same-address family gets exactly one send per fan-out across every key in the registry.

## PL-465 — Import everyone the old system knows about — including the people who DIDN'T end up in a seat (Scarlett, Sep 21)
"Should these students be included for accuracy, so that when we switch over they're not lost? We at least have a profile for them with notes of what happened. Same for students in the cancelled classes." The tracker holds four kinds of people beyond seated students: refunded (Leone XIII ×1, Nido ×1), moved to 1-on-1 before/instead of class (MIS ×1, and everyone in the cancelled Nido / Cairo / AISCT cohorts), and deferred to a future course (ASF ×1). Plus one seated SLS student with 5 paid extra 1-on-1 hours.
- **A. Per-row `outcome` column (mapping key `outcome`; default `enrolled`):**
  - `enrolled` → today's behavior (+ `--silent`).
  - `refunded` → enrollment created then set `Refunded` through the SAME path the admin "mark Refunded" uses (so counts/waitlist/suppression behave identically), silent, with the sheet's note (e.g. "Refund 7/17"). Never enqueues QBO.
  - `moved_to_tutoring` · `deferred` · `class_cancelled` → **NO enrollment** (rosters, paid counts, reports and the instructor's class stay truthful — these people never sat in the class): family + student are created/matched through THE one upsert path, school attached by nickname, and a dated staff note is written on the record: what they registered for, that they paid (amount if mapped), what happened, and the sheet's own note text verbatim. Use the existing staff-notes surface on the family/student profile; if there isn't one that shows on the family profile, STOP and say so (don't bury it in a column nobody renders).
- **B. `--records-only` (no `--class`):** for the cancelled cohorts whose class rows no longer exist (Nido Aug, Cairo Aug/Sept, AISCT Oct) — every row is family + student + note, nothing else. Unknown school nickname → reported, not created (Scarlett adds "CAC — Cairo American College" herself).
- **C. `addonHours` column ("Extra 1on1 Hours Paid"):** creates the enrollment's tutoring add-on in the state a PAID add-on has — hours on the books, schedulable and decrementable through the normal tutoring flow — with no Stripe ids, `source='import'`, NOT enqueued to QBO (the old system booked it), no emails. Scarlett wants this one student (5 hours) to be the first real test of running add-on hours through the portal. If an add-on cannot exist without something the import can't supply (a `tutoring_packages` ref, a price snapshot…), report exactly what and propose the smallest honest default — do not fake a payment.
- **D. `accommodations` column** → the student's accommodations field the intake already captures (NOT free-text notes), verbatim. `graduatingYear`, `studentEmail` as today.
- **E. Dry run prints a per-row verdict table** (row → outcome → what would be created / matched / skipped and why) and totals per outcome. Idempotent on re-run for every outcome (student+class for enrollments; student+note-hash for notes).
- **F.** A student who appears in two sheets (e.g. a sibling, or moved between cohorts) matches the same family/student — report matches in the verdict table.
- Extend `regress:silent-import` with one row of each outcome + an add-on row.

## PL-466 — Compound names are first-class (Scarlett, Sep 21)
"A lot of our students have two last names and the portal should be able to handle this." The fields already accept spaces; make sure nothing downstream mangles them. Audit + fix: every place that derives something from a name — greetings ({studentFirstName} must be the WHOLE first-name field: "Stefano Carlo", never the first token), initials/avatars, sort order (by the whole last-name field: "Marchini Cigognini" sorts under M), roster/report/PDF columns (no truncation that drops the second surname; wrap instead), search (either surname finds the student), dedupe/record-match prompts (accent- and case-insensitive; "Uzunoglu" ≈ "Uzunoğlu"), the anonymized class report, collateral, QBO customer display names, and the single-name-column splitters in the importers (`parentName`/`studentName` "split on the last space" is WRONG for these families — when only a full name is mapped, import refuses to guess and asks for explicit first/last columns; Claude is preparing the cleaned files with explicit columns). Registration form: helper text under Last name — "Include both surnames if you use two." Report the list of sites checked.

## PL-467 — A school can be added without a contact (found Sep 21)
The wizard's "➕ Add a new school…" REQUIRES a first contact ("room requests, digests, and the final-days push all need someone to email") — but after the purge all six existing schools legitimately have zero contacts, the Schools panel already renders "No active contact — the school gets no digests and nobody can open its portal", and Scarlett specifically does NOT want Leone XIII's counselor in the portal until that class ends. Make the first contact optional in the add-school form (same honest "no active contact" state; the class wizard's existing warnings about who gets room requests stay). Also give the Schools panel its own "Add a school" button — today the only door is inside the class wizard. Until this ships Claude/Scarlett add Leone XIII with a placeholder or wait — Scarlett's call.

## PL-468 — In-person classes: "on campus" is known at sign-up, the ROOM comes later — model both (Scarlett, Sep 21)
"It's normal for us to say the class is on ASF campus so parents know it's not online when signing up. After the class meets minimum registration we get the specific classroom confirmed from the counselor — here it's US 109. Can the portal handle that distinction?" Today it can't: there is ONE field, `classes.default_location`. Typing "ASF campus" into it SUPPRESSES the classroom request (the wizard says "Blank = counselor gets asked 14 days out"), and the counselor's answer OVERWRITES it (`classroom-request` route → `default_location`), so you get either the campus or the room, never "campus now, room later".
- **Venue (known at creation) vs room (confirmed later):** add a class-level venue line for in-person classes — default composed from the school ("On campus at {school name}"), editable — shown on the public class page, register page, flyer/letter, and E-series emails from day one. `default_location` keeps its meaning as the ROOM: blank until confirmed, asked of the school contact by the existing CR flow, never suppressed by the venue being set.
- **Rendering rule, one helper:** room known → "{venue} · {room}" (e.g. "ASF campus · Room US 109"); room not yet known → "{venue} — classroom to be confirmed" (families) and the existing hold/alert logic for the class-details email (#4) still keys on the ROOM being blank. Per-session location overrides keep working.
- **Timing:** Scarlett's real trigger is "once the class meets minimum registration", not only "14 days out" — ask at whichever comes first (min reached, or T-14 if min was already reached earlier), never before min is reached (no point asking a counselor for a room for a class that may not run). Say in the ship note if this changes any existing CR timing.
- Online classes unchanged (venue hidden; location = meeting link). Migration additive. Data fix in the same batch: `asf-sat-prep-fall26` currently carries "ASF campus — Room US 109" in the one field → venue "ASF campus", room "Room US 109".
- CTA registry: the counselor's room form + the staff "Counselor set … location" alert keep their landings.

## PL-469 — The daily email cap is a setting staff can see and change; the health card stops saying 100 (Scarlett, Sep 21)
HGL is on Resend Pro (50k/month, NO daily limit — confirmed by Scarlett). The portal still assumes the free tier: `app_settings.resend_daily_cap` has no row, so `system-health.ts`, `campaign-send.ts` and the campaigns route all fall back to `?? 100` — the health card reads "2 / 100", would warn "approaching the daily cap" at a busy registration day, and campaigns would PAUSE at 80 sends (cap − 20 transactional reserve).
- Make it a real setting under Settings (number + plain-language help: "Your Resend plan's daily limit. Pro has none — this is a safety brake for campaigns, not a Resend limit"), audit-logged like other settings; ONE reader helper instead of three `?? 100` fallbacks.
- Health card: shows sends today against the brake only as a brake ("312 today · campaign brake 1,500"), never "sends are failing" unless Resend actually returned quota errors (that signal should come from real send failures, not arithmetic). Add the month-to-date count vs the plan's monthly quota (also a setting) — that IS the real Pro limit.
- Confirm in the ship note that transactional sends are never blocked by this number (only campaigns pause).
- Until it ships, Claude sets the row by hand to the value Scarlett picks.

