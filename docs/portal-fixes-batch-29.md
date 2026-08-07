# Portal fixes — batch 29 (CLOSED Aug 7 — ready to ship)

**Batch closed and handed off Aug 7, 2026.** Nine items: PL-279 (FO campaign — GO, final copy inside), PL-280 (campaign engine family-history segmentation — plan before build), PL-281 (QBO TimeActivity push — GO), PL-282 (returning thank-you pair — Scarlett's final copy, exact strings), PL-283 (per-tutor calendar colors from Kelsie's palette), PL-284 (Calendar → Classes sidebar), PL-285 (multi-select tutors + select/deselect all), PL-286 (ACT Science optional + STEM score), PL-287 (Registration deadline surfaced on rosters).

**Standing rules:** plain-English statuses · no internal shorthand · every alert deep-links its record · samples from composers · `git push` after committing · PL-x IDs in commits · check items off here when shipped · registry template edits ship as new versions with matching code twins · verify composed blocks via the composer path · inline confirm banners only.

---

## PL-279 — Build the FO follow-on campaign (GO from Scarlett Aug 7 — registry sequence per your PL-274 recommendation; copy below transcribed from her proven sends and confirmed by her)

Build per the PL-274 amendment-D mechanics (per-cohort rolling windows, ONE shared code portal-validated per feeder class, {endDate} composed per cohort, tokenized auto-apply links preferred, suppress once registered, sends on the hourly sweep). Tags mapped to composer variables ({followOnClassName}, {followOnRegistrationLink}, {discountAmount}, {discountCode}, {endDate}, plus the usual family/school/class variables). Present rendered samples for Scarlett's sign-off before the sequence goes live.

### Stage 1 — Announcement
**FO-1P (parent)** · subject: "SAT Advanced Math opportunity for {schoolName} students"
> Dear {parentFirstName},
>
> I just wanted to let you know that we've opened up registration for our online course, *{followOnClassName}*.
>
> *Deep Dive* is an advanced class that is designed for students who have already taken our SAT class (as {studentFirstName} has) or who already have an SAT math score of 650 or above.
>
> In the class, our expert instructors guide students through the most challenging SAT math concepts that are often left out of regular SAT classes. With a focus on the most difficult and least frequently tested topics, this class was created to help students like {studentFirstName} learn even more strategies to solve the most challenging SAT math questions.
>
> As a special offer for {schoolName} students who recently took one of our {className} courses, **we're discounting this specialized course by USD {discountAmount}**.
>
> Since we're expecting the class to fill up, we're only leaving this discount offer open until {endDate}.
>
> To register or learn more about the course, you can visit {followOnRegistrationLink} and **use the code {discountCode} to get your discount.**
>
> We hope to see {studentFirstName} in class!
>
> To {studentFirstName}'s continued progress,
>
> William

**FO-1S (student)** · subject: "{schoolName} {className} - Math score boost opportunity"
> Hey {studentFirstName},
>
> Just a heads up that registration is open for *{followOnClassName}*.
>
> *Deep Dive* is an advanced class that is designed for students who have already taken our SAT class (like you!) or who already have an SAT math score of 650 or above.
>
> The class focuses on the most difficult and least frequently tested topics, and was created to help you learn even more strategies to solve the most challenging SAT math questions. We want you to make your score 🔥🔥🔥.
>
> {studentFirstName}, since you recently took the {schoolName} {className} class, **we're discounting this specialized course by USD {discountAmount}**.
>
> We're expecting the class to fill up, so we're only leaving this discount offer open until {endDate}.
>
> To register or learn more about the course, you can visit {followOnRegistrationLink} and **use the code {discountCode} to get your discount.**
>
> We hope to see you in class, {studentFirstName}!
>
> To your continued progress,
>
> William

### Stage 2 — Deadline reminder
**FO-2P (parent)** · subject: "SAT Math Reminder for {schoolName} students"
> Hello {parentFirstName},
>
> I'm writing just to give you a quick heads up that the USD {discountAmount} discount for our upcoming class, *{followOnClassName}*, ends on {endDate}. (That's really soon!)
>
> Since {studentFirstName} already took our {schoolName} {className} class, we wanted to make sure you received a discount, but…since we're expecting the class to be quite popular, we're only leaving this discount offer open until {endDate}.
>
> The class isn't perfect for everyone, so I understand if it may not be a good fit for {studentFirstName}.
>
> To register or learn more about the course, you can visit {followOnRegistrationLink} and use the code {discountCode} to get your discount.
>
> If you're considering enrolling {studentFirstName}, but you're wondering if the course is right for them, you can reply to this message and ask anything you'd like.
>
> To {studentFirstName}'s burgeoning confidence,
>
> William

**FO-2S (student)** · subject: "{schoolName} {className} - Quick Reminder"
> Hi {studentFirstName},
>
> I just wanted to remind you that we've got a pretty useful math class coming up.
>
> *{followOnClassName}* focuses on the most difficult SAT Math concepts. Each concept may only show up rarely, but mastering all of them adds up!
>
> **We're discounting our upcoming Advanced SAT Math course by USD {discountAmount} for students who took the {schoolName} {className} class – that's you!**
>
> We're expecting the class to fill up, so we're only leaving this discount offer open until {endDate}. That's soon!
>
> **To register or learn more about the course, you can visit {followOnRegistrationLink} and use the code {discountCode} to get your discount.**
>
> If you have any questions, just reply to this message! Easy peasy.
>
> To crushing the math section,
>
> William Thomas

### Stage 3 — Extension
**FO-3P (parent)** · subject: "Bad News, Great News for {schoolName} {className} Students"
> Hi {parentFirstName},
>
> A lot of parents and students reached out to us after hearing about our *{followOnClassName}* class. So many, in fact, that we weren't able to get back to everyone as quickly as we would've liked. For some, that meant missing out on the discount while they waited for answers.
>
> So, in order to ensure that every family has a fair opportunity to secure their spot in the class *and* take advantage of the discount we offered, we extended the discount.
>
> You now have until **{endDate} at midnight** to save {discountAmount} using the code {discountCode}.
>
> If you missed out earlier, this is your chance to secure a spot for {studentFirstName}. Just click the link below to sign up...
>
> {followOnRegistrationLink}
>
> Learning to solve these most difficult math problems is transformative – both for {studentFirstName}'s scores *and* their confidence.
>
> Let's make it happen together!
>
> William

**FO-3S (student)** · subject: "{schoolName} {className} – Bad News, Great News"
> What's up {studentFirstName}!
>
> Bad news: some of you missed your chance to enroll in our *{followOnClassName}* class while you waited to hear back from us for more info.
>
> Great news? We extended the discount.
>
> You now have until **{endDate} at midnight** to save {discountAmount} using the code {discountCode}.
>
> Tell someone who cares to sign up here...
>
> {followOnRegistrationLink}
>
> See you there? See you there.

Notes: stage-3 sends only if that cohort's window actually extended (admin action or configured auto-extend — recommend which). "Deep Dive"-specific phrasing (the italicized shorthand, "Advanced SAT Math course") should degrade sensibly for a future different follow-on class — recommend how (e.g. {followOnShortName}) without rewriting Scarlett's voice.

## PL-280 — Campaign engine: family-history awareness, parent+student pairs, and composer variables (reported Aug 7)

Scarlett's aside on the PL-279 recommendation, promoted to an item: the campaign engine exists precisely because MailerLite campaigns can't know a family's history with us and therefore can't market the right products — so the gaps you cited against it (no scheduling, no parent+student pairs, no variables) are gaps to close, not reasons it stays limited. It should gain: (a) audience segments expressible in the FULL family-history record — **everything we know about what a family has and hasn't done with us**: classes taken (which, when, at which school, completed vs cancelled vs waitlisted), tutoring history (subjects, hours used/remaining, packages, active vs lapsed), and financial history (amounts paid, outstanding/past-due invoices, credits, refunds, promo codes used) — combinable, e.g. "took an SAT class + never bought tutoring + no outstanding balance" or "spent >$X across 2+ classes"; (b) parent+student paired sends; (c) the full composer variable set. Segment previews must show who matches before sending, and financial fields are for SEGMENTATION — never rendered into marketing copy without an explicit variable Scarlett chooses. Scope against the batch-21 campaigns roadmap (the roadmap lives in the batch-21 doc — the claude/ path previously cited doesn't exist) and report a plan before building.

## PL-281 — QBO payroll: post approved hourly timecards as TimeActivity rows (GO from Scarlett Aug 7)

Per your PL-276 feasibility report: build it — approved hourly timecards post as TimeActivity rows against matched employees on the existing sync rails (~1–2 days). Salaried tutors never become TimeActivity rows; CSV export stays as fallback; PL-212 guard rails carry over. Employee-matching failures fail loud (plain-English admin alert, not a silent skip).

✅ **Shipped Aug 7 — sandbox-verified E2E on the real rails.** Migration `20260829000001` APPLIED: `instructors.qbo_employee_id` (match-only cache) + `qbo_sync_log` grows a third source (`timecard_id`, kind `timecard_time`, three-way XOR, payment-intent relaxed but still required for payment rows, **unique index = one push per card EVER** — a reopened-and-re-approved card that already pushed is a human conversation, not a second TimeActivity). Pieces: `listEmployees()` + `createTimeActivity()` in qbo.ts (same shapes as the receipt helpers; ONE TimeActivity per card — total hours, TxnDate = period end, description carries the by-work-type breakdown the payroll clipboard shows plus the timecard id for crash-recovery adoption, since TimeActivity has no DocNumber); the sync worker gains `syncTimecardRow` with **PermanentSyncError** — configuration failures (unmatched employee, salaried card, reopened card) fail the row and alert IMMEDIATELY instead of burning 2h of backoff; on success the card flips approved→exported (same milestone the CSV click marks). **Fail-loud is double-layered**: the push button's response names every refused tutor and why (unmatched → "open Settings → QuickBooks → Employee matching"; salaried → never pushed; already-exported → "pushing again would double their hours", skipped), and sync-time failures send the timecard-flavored AL_QBO_FAILURE. UI: **Push to QuickBooks (N)** beside Export CSV (inline confirm), the QBO panel's new **Employee matching** card (admin-only, match-ONLY — the portal never creates QBO employees), and the sync log shows timecard rows as "timecard hours · tutor · period". **Salaried rails**: filtered at the button AND re-guarded in the worker (survives a pay-type edit between enqueue and drain). **Exported-card decision** (the flagged Billy Jul 16–31 question): exported cards are NOT pushable — their hours went to payroll via CSV; pushing would double-pay. CSV stays untouched as fallback + audit trail. **Sandbox E2E 14/14** (`scripts/verify-pl281-e2e.mjs`, fixture-clean): existing accounting scope DOES cover Employee reads + TimeActivity writes (no re-consent — the PL-276 open question answered), QA card → TimeActivity created in sandbox against Emily Platt → row synced → card exported → second drain no-op → duplicate row blocked by the index → unmatched tutor failed at attempt 1 with the matching message → everything deleted (sandbox TimeActivity included), Billy's mapping restored to null. Setup for go-live: match each hourly tutor once in Settings → QuickBooks → Employee matching (production employees must exist in QBO Payroll first).

## PL-282 — Returning-family thank-you pair: Scarlett's final copy (Aug 7 — replaces the [PLACEHOLDER] drafts from PL-274 amendment A; exact strings)

Publish these as the live returning-family thank-you templates (parent + student), replacing the placeholder drafts. New versions via anchor-guard + code twins; verify via composer path. Note both bodies are diagnostics-agnostic by design (no diagnostic promises — the E0/E2 conditioning from PL-274 B carries that load).

**Parent** · subject: "Thank you (again!), {parentFirstName}" · preheader: "You're making all the right calls"
> Hi {parentFirstName},
>
> You registered {studentFirstName} for the {className} class, and I wanted to take a moment to say thank you...again!
>
> The first time a family trusts us with their student's future, it means a lot. When they come back, it means even more. There's no better compliment you could pay us than giving us another chance to work with {studentFirstName}, and we don't take it lightly.
>
> We've watched {studentFirstName} put in the work once already, so we know what {she_he_they} {is_are} capable of. This next class is about building on that — taking what's already strong and pushing it further.
>
> In the days before the course starts, you and {studentFirstName} will receive the necessary course information. Everything will also be waiting in your family portal, same as before — the class schedule, receipts, and {studentFirstName}'s progress, no password needed.
>
> Thanks for continuing this journey with us.
>
> William

**Student** · subject: "{studentFirstName}, welcome back" · preheader: "Round two. Let's go."
> Hey {studentFirstName},
>
> You're back! That's the best news we've had all week.
>
> You've been registered for the {className} class, and since you've already been through one of our classes, you know how this works: we'll send you everything you need in the days before the course starts.
>
> Here's the thing about coming back for more — it says something about you. Plenty of students finish a class and call it good, but you decided to keep leveling up. That's exactly the kind of student this class was built for.
>
> We'll see you in there.
>
> William

✅ **Shipped Aug 7 — both templates LIVE as v2** (`scripts/seed-pl282-returning-final.mjs`, idempotent, refuses to publish if the seed still says PLACEHOLDER; seed + code twin `returningThanksEmail` carry your exact strings in lockstep, twins now send from billy@ like the templates always declared). One missing piece your copy needed: **`{is_are}` didn't exist** — added to the variable vocabulary AND the email.ts pronoun twin (she is / he is / they are / "Ana is" for name_only; unset → are), so "{she_he_they} {is_are} capable of" agrees in every state. Two registry-plumbing fixes rode along: E1_RETURNING_STUDENT was stamped role *parent* (now student — timeline badges read right), and both keys were missing from TEMPLATE_LABELS (raw keys would have shown on comms surfaces). **Verified via the composer path** (`scripts/verify-pl282-composer.mjs`, the exact renderEmail call the thank-you sweep makes): 35/35 — registry version served (not the fallback), pronoun agreement across all four states, zero unresolved variables, no placeholder remnants, and confirmed diagnostics-agnostic (no diagnostic promises in either body). regress:links + regress:pronouns green.

## PL-283 — Portal calendar: per-tutor colors matching Kelsie's existing Google Calendar palette (reported Aug 7, screenshot on file)

Kelsie already color-codes each tutor's Google calendar; when tutors appear in the portal calendar their colors should match what she's used to. Per-tutor color field on the instructors record (admin-editable swatch picker, ideally the Google Calendar palette), applied wherever a tutor's events/sessions render in portal calendars. Seed from her current scheme (approximated from the screenshot against the standard Google Calendar palette — verify shades against her actual calendar settings before hard-coding):
- Kelsie Rank — dark green (Basil ~#0B8043) · Billy Thomas — brown (Cocoa ~#795548) · Eric Brown — orange (Pumpkin ~#EF6C00) · Gwen De Silva — purple (Grape ~#8E24AA) · Jason Topa — amber/orange (Tangerine ~#F09300) · Julia Fusia — salmon (Flamingo ~#E67C73) · Kevin Marren — lime (Pistachio ~#7CB342) · Linden Hughes — blue (Blueberry ~#3F51B5) · Rebecca Baumher — teal (Eucalyptus ~#009688).
Tutors without an assigned color get a distinct unused palette color automatically (stable per tutor, not random per render). Keep event text legible on every assigned color (the PL-271 usableAccent lesson).

✅ **Shipped Aug 7 — with one verification caveat.** `instructors.calendar_color` (migration `20260828000001`, applied; hex-checked like `schools.accent_color`), swatch picker in the instructor editor offering the full official 24-color Google Calendar calendar-list palette + an Auto option. **Verifying against Kelsie's real settings isn't possible programmatically**: her per-tutor colors live in HER Google account's calendarList (per-viewer data), and the portal's Google identity is a service account scoped to events+freebusy — it cannot read her list. What WAS verified: all nine hexes are exact official palette values, so they'll match Google's swatches pixel-for-pixel; the one discrepancy is a NAME — #F09300 is the palette's **Mango**, not Tangerine (hex kept — the screenshot's shade is what matters). Seeded 7 of 9 (`scripts/seed-pl283-tutor-colors.mjs`, idempotent, never overwrites a later edit): **Kelsie Rank and Linden Hughes have no instructor record in test data** — the mapping stays in the script; re-run it when they exist. Rendering: admin-calendar 1-on-1 blocks wear the tutor color (text via new `textOnColor`, the generalized usableAccent lesson — white on dark, slate on light; dashed border = proposed, struck+faded = cancelled), a "Tutors (1-on-1)" legend row appears, **class blocks keep Kelsie's status-color language verbatim** (that legend is class machinery) and get a small tutor dot instead; the Tutoring schedules view colors chips the same way (terminal statuses keep their styling + a tutor-colored left bar). Auto-colors: `autoTutorColor()` — deterministic hash into the unclaimed palette, stable per tutor. One PL-274 gap fixed in passing: the calendar API resolved class-session times by school timezone only — `classes.timezone` now wins, so school-less classes stop rendering mistimed.

## PL-284 — Move the admin Calendar from the top nav into Classes (reported Aug 7)

The Calendar tab primarily serves classes (its legend is Proposed — not confirmed / Confirmed · in person / Confirmed · online / Cancelled). Move it out of the top nav and into **Classes as a left-sidebar item** (alongside Live class rosters / Add a new class / Schools / Branding & collateral). Keep every existing deep link working (redirect /admin/calendar and the ?suggest= availability flow, "who's free to teach it?", the PL-253 back-links) — nothing that lands on the calendar today may 404.

✅ **Shipped Aug 7.** Topline back to six tabs; `/admin/calendar` **keeps its URL** (no redirect needed — nothing can 404) and now wears the Classes sidebar chrome with Calendar selected (the Campaigns-wears-Contacts pattern; new exported `CLASSES_SIDEBAR`), while the topline highlights Classes when you're there. The Classes group on /admin gains the Calendar link entry. Deep links audited exhaustively (grep): the only inbound links are the topline (updated), the roster's "who's free to teach it?" `?suggest=` link, and the calendar's own API fetch — `?suggest=`, the PL-253 back-links, and the PL-161 fit overlay all read `window.location.search` and are untouched. Verified live: /admin/calendar renders with sidebar + Classes highlighted.

## PL-285 — Current Student Schedules: multi-select tutors + select/deselect all (reported Aug 7)

In Tutoring → Current Student Schedules the tutor picker is single-select. Make it multi-select (render selected tutors' schedules together — pairs with PL-283 colors) with **Select all / Deselect all** controls.

✅ **Shipped Aug 7.** The week-view `<select>` is now color-dotted toggle chips (every active tutor) + **Select all / Deselect all**; default = everyone selected. Selected tutors' sessions render together, colored per PL-283. Single-tutor behaviors degrade honestly: exactly one selected → that tutor's timezone + their Google busy shading (as before); several → America/Denver and a note that shading needs a single tutor (the freebusy endpoint is single-tutor by construction). Deselect-all shows a plain empty state instead of a silent blank grid (and skips the query — `.in()` with an empty list is a PostgREST error, not "no rows"). The PL-262 alert deep link still lands on its session's tutor+week (now as a one-tutor selection). Day mode's existing show/hide rail is untouched, now color-dotted. Verified live: chip toggle, Deselect all → empty state, Select all restores. Note: test data has one `tutoring_active` tutor, so the multi-tutor overlay itself is exercised by mechanism, not by eye — flag anything odd when a second tutor goes active.

## PL-286 — ACT scoring: Science is now optional; composite without Science + STEM score when present (reported Aug 7)

The ACT's Science section is now optional. Score entry and every score display/report must reflect: **composite computes WITHOUT Science** (average of the non-Science sections); when Science IS taken, the student also gets a **STEM score = average of Math and Science**. Science field becomes optional in entry (no validation requiring it); historical records with Science keep their data; check everywhere scores render (roster scores panel, family portal, performance report, counselor-visible surfaces, milestone pings) for composite math and for showing STEM only when Science exists.

✅ **Shipped Aug 7.** One formula source stays true: `EXAM_OPTIONAL_SECTIONS`/`requiredSections()` + `computedTotal()` (ACT = rounded average of English/Math/Reading only) + new `computedStem()` (rounded avg of Math+Science, null unless Science exists) all live in ScoresEntry and feed both entry surfaces. Entry: Science labeled "(optional)", save gates only on the required three, composite tooltip says Science doesn't count, a STEM readout appears live once Science is typed; the group grid mirrors all of it ("(opt)" header, "· STEM n" beside totals, plain-English "Science is optional" in the validation message). Display audit: the shared ScoresTable (family portal ×2, counselor portal, public class roster, instructor roster) appends "· STEM: n" to the sections cell only when a row carries Science — as a local twin of computedStem, because those render server-side and must not import the browser supabase client ScoresEntry pulls in; the ScoresEntry history list shows the same; the family-profile one-liner shows the stored total (already composite) unchanged. **Performance report: a live pre-existing ACT bug fixed** — superscore summed best-per-section unconditionally, printing a ~144-scale number beside 1–36 composites; it's now the rounded average of best English/Math/Reading for ACT classes (SAT keeps the sum), and the report grows STEM (1st)/STEM (final) columns only for an ACT class where someone took Science. Historical rows: data untouched, stored totals stand (correct under the rules when recorded), STEM computes at render so old Science rows get it free. "Milestone pings" resolved to nothing: no email anywhere sends a score value (the IN_DIGEST milestones are enrollment counts). Verified live: E30/M28/R32 → composite 30 with Record enabled and Science blank; adding Science 20 → STEM 24, composite unchanged.

## PL-287 — Live class rosters: show "Registration deadline" instead of "Registration closes" (reported Aug 7)

The roster currently surfaces "Registration closes" — the automatic sign-up cutoff, which matters at setup but isn't referred back to. What we run decisions on (run/don't-run, book travel or don't, ask the counselor to re-promote or don't) is the **registration deadline** (the commit-by enrollment deadline the flyer already prints). Swap the roster's surfaced field: show "Registration deadline: <date>" with its edit control; demote registration-closes to the class setup/edit area (still editable, just not front-and-center). Make sure the labels are used consistently everywhere both dates appear (wizard, roster, emails, needs-attention conditions).

✅ **Shipped Aug 7.** The naming rule now holds everywhere: **"Registration deadline" always means `enrollment_deadline`** (the commit-by date, flyer-printed) and **"Registration closes (sign-up cutoff)" always means `registration_close_date`**. Roster class card: "Registration deadline: <date> · edit" is the surfaced line — and this is the FIRST post-wizard edit control the deadline has ever had, which also un-deadens the min-enrollment decision brief's "Extend the deadline — set it on the class page" link (it pointed at a page with no such control); registration-closes demotes to a small gray setup line, still editable. Wizard: field renamed "Registration deadline" (was "Enrollment deadline"), closes-field labeled "(sign-up cutoff)" with a decisions-run-on-the-deadline hint; review step matches. Emails: **CS_CLASS_CONFIRMED v6 published** (anchor-guarded, `scripts/seed-pl287-cs-deadline.mjs`, seed in lockstep) — it said "Registration closes {enrollmentDeadline}" in two places, the cutoff's words filled with the deadline's date while IN_DIGEST uses the same words for the actual close date; now "The registration deadline is {enrollmentDeadline}". Wording only, same date — reword freely if the phrasing isn't yours. The min-enrollment brief's picture line likewise now says "the registration deadline is in N days". Deliberately untouched: the FLYER burst ("REGISTRATION CLOSES {date}" fed by the deadline) — that's your collateral copy with PL-15 history behind it; flagged here rather than edited. Instructor-roster "registration closes {date}" already pairs label↔close-date correctly. Verified live on the roster: deadline surfaced with edit, cutoff demoted.
