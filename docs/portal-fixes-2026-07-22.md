# Portal fixes — batch 5 (July 2026, follows batch 4)

From Scarlett's full template-review session (all 12 ramp templates read as real sends, plus the batch-3/4 arrivals). Continues PL-x numbering. Five small items, all decided — mostly copy/polish; no schema work.

**Standing rules:** plain-English statuses · "Ops Director" · never "engagement" in UI copy · contact block on parent surfaces · `git push` after committing · PL-x IDs in commits · check items off here when shipped.

**Template ramp status (context, not work):** all 12 originally registered templates are now **live** (Scarlett reviewed each; T_SCHEDULE_CONFIRM v2, T_SCHEDULE_SET v3, and T7 v2 carry her edits). Still drafts by design: #8b, #8b-n (test-sent, under review) and NW (held for the PL-54 amendment below).

---

## PL-56 · Realistic sample data for template previews/test-sends + footer-field hint
Sample data impersonated bugs three times in one review session: sample tutor literally named "your tutor" (read as a missing variable in T8 and T_SCHEDULE_CONFIRM), sample subject literally "tutoring" (rendered "1-on-1 tutoring tutoring"), and "—" for month/total/schedule (T2's subject read "for — — —").
- Give the tutoring-template sample set realistic values: tutor "Billy Thomas", subject "SAT", schedule "Mondays at 4:00 PM, starting September 7 — one hour each week", month "September 2026", total "$480.00", due date "September 30".
- For compose-at-send templates (T2, T4, CX, CX-W), sample the composed blocks with a worked example rather than empty — specifically include a filled T4 attempt-3 render (the highest-stakes email in the set).
- **Footer-note field hint:** the template editor's "Footer note" input renders in the parent-visible email but sits right next to the internal "version notes" input and looks identical — an internal review note briefly went live in a footer this session. Add distinguishing helper/placeholder text, e.g. "Visible to recipients — appears above the standard footer."

## PL-57 · Admin alert copy pass ✅

> **Shipped.** Registration alert: subject "New registration: {student} — {class} ({counts})" (the [HGL Admin] prefix is added by the alert sender; the running-counts ticker stays), body "registered for", counts "3 / 8 min / 15 cap" — and pending shows as "3 + 1 pending" only when there are pending rows. Availability-shared alert body: "the student-schedule wizard" (the word "New" dropped).
- Registration alert: drop "paid" everywhere — subject "[HGL Admin] New registration: {student} — {class}", body likewise, count "(3 / 8 min / 15 cap)". A registration only exists because payment completed; "paid" is noise (and if pending visibility is wanted, use the badge format "3 + 1 pending", still without the word "paid").
- Availability-shared alert: drop the word "New" from the body ("it's new now, but soon it won't be").

## PL-58 · Delivery-mode-aware phrasing in #0 (+ sweep) ✅

> **Shipped.** `{classLocationPhrase}` variable added (in-person → "the classroom location" · online → "the meeting link for class"). New live versions published by patching each template's CURRENT active body (editor edits survive): **#0-P v3** (the approved sentence verbatim), **#0-S v2** and **#1 v2** (both said "classroom location" unconditionally — converted to the variable). Sweep of every live template body + code renderers + seeds found no other hedge. Verified: both modes resolve correctly and all patched versions render clean through the real preview endpoint. One observation left for Scarlett: **E5's subject** "Classroom location for {className}" also reads wrong for online classes (its *body* already resolves `{classroom}` to the meeting link) — no approved replacement wording exists, so it was left alone; editable in the template editor whenever you pick a phrasing.
#0's "and course room location (for both in-person and online classes)" is MailerLite-era hedging — the portal knows `delivery_mode` at render time.
- Add a variable (e.g. `{classLocationPhrase}`) resolving per class: in-person → "the classroom location" · online → "the meeting link for class". Seed #0-P/#0-S new versions using it: "This includes diagnostic test information, instructor information, and {classLocationPhrase}."
- Sweep all live templates for the same hedge ("for both in-person and online", "location or meeting link", etc.) and convert to the variable.

## PL-59 · Waitlist-release email when a class completes full (new) ✅

> **Shipped.** `WR_WAITLIST_RELEASE` registered LIVE (v1, approved copy verbatim, from info@, editable in the template editor). Trigger: `sweepWaitlistRelease` runs from the existing completion sweep in the hourly cron — when the class passes its last session, every still-Waitlisted enrollment gets the email (deduped per enrollment) and the family is upserted onto `class_interest` (same shape/machinery as cancellation). E2E-verified 10/10: send from registry snapshot, correct subject render, interest-list carry, enrollment stays Waitlisted, re-run sends nothing. No enrollments were retroactively affected (zero Waitlisted rows existed at deploy).
Case analysis: CX-W covers a *cancelled* class's waitlist (rare: full class cancelled for non-demand reasons — its copy is correct for that). The common case has NO email: the class ran, stayed full, and the waitlisted family never hears. Add one.
- **Trigger:** the existing class-completion transition (no new cron) → every still-`Waitlisted` enrollment on that class.
- **Interest list:** carry those families onto `class_interest` exactly as cancellation does — the "first to know" promise is backed by the same PL-54 machinery.
- **The tutoring offer is deliberate** (Scarlett: "this is someone who wanted SAT prep from us and was willing to pay — help them out asap"). The {availabilityLink} is the existing tokenized family availability page (family + student records exist for waitlisted enrollments), dropping them into the standard scheduling pipeline. Declining costs nothing — the interest row stays either way. No pricing in the email (that lives in the scheduling conversation).
- Approved copy (register as e.g. `WR_WAITLIST_RELEASE`, from info@, editable):

> Subject: An update on {schoolNickname} {classType} — and an option for {studentFirstName}
> Preheader: We couldn't open a spot — but we can still help right away.
>
> Hi {parentFirstName},
>
> An update on {schoolNickname} {classType}: the class stayed full, and we weren't able to open up a place for {studentFirstName}. No payment was ever taken, and I'm sorry it didn't work out this time.
>
> If {studentFirstName} still wants to get ready, we can help right away with **1-on-1 tutoring** — the same prep, tailored entirely to {studentFirstName}, scheduled around your family. [Share your availability]({availabilityLink}) and we'll propose times, or just reply and we'll talk it through.
>
> And either way, you're still on our list — the moment a new {schoolNickname} {classType} course opens, you'll be the first to know. Nothing to do on your end.
>
> {contactBlock}

## PL-54 amendment · NW notify button → the class's hgl.co marketing link ✅

> **Shipped.** The notify route now points the button at the class's hgl.co short link (protocol added if missing); portal registration page only as fallback when the field is blank. The "notify N families?" prompt states which link the button will use — and warns explicitly when no short link is set so the Ops Director can fill in the collateral card first or knowingly accept the direct link. NW_NEXT_CLASS_OPEN flipped **live**.
The NW "next class open" email's button must NOT deep-link the portal registration page — interested families should land on the Squarespace sales page first. Point the button at the class's existing **hgl.co short-link field** (the collateral card's "more info & registration" destination). Guard: the "notify N families?" prompt checks the field — if blank, warn "no hgl.co link on this class — the button will point at the portal registration page" so the Ops Director fills it in first or knowingly accepts the direct link. NW stays a draft until this ships; flip it live afterward (its other copy is approved as-is). Also note: public-capture signups without a name render "Hi there," — accepted for now.

---

## Paste-ready handoff prompt for Claude Code

> Read `docs/portal-fixes-2026-07-22.md` (batch 5 — five small items, all decided, copy approved inline).
>
> Build in any order; suggested: (1) PL-54 amendment (NW button → the class's hgl.co short link, with the blank-field warning in the notify prompt), then flip NW live; (2) PL-59 the waitlist-release email — trigger on class completion for still-waitlisted enrollments, carry them onto `class_interest`, approved copy verbatim, availability link = the existing tokenized family availability page, register as an editable template; (3) PL-58 the `{classLocationPhrase}` variable + new #0 versions + hedge sweep; (4) PL-57 admin-alert copy pass; (5) PL-56 realistic sample data + the footer-field hint.
>
> Rules: PL-x IDs in commits; `git push` after committing; new/changed templates go through the registry (seed as new versions where a template is already live); standing copy rules apply; check items off in this doc as you ship. Note the ramp state: all 12 original registry templates are now LIVE — code-copy changes to those won't send anymore, so any copy work lands as new template versions, not code edits.
