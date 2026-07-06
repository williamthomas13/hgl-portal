# HGL Portal — Master Spec

**Last updated:** July 5, 2026 (v2.1 — enum + opt-out location aligned with implementation)
**Status:** Foundation complete and verified in production. Phase 2 (email automation + enrollment lifecycle + waitlist + tutoring add-ons) fully specified; content pack complete (15/15); build in progress with Claude Code.
**Stack:** Next.js + Supabase + Stripe on Vercel · Resend for transactional email
**Live:** https://hgl-portal.vercel.app · Repo: github.com/williamthomas13/hgl-portal

---

## 1. Project purpose

Replace the stitched-together group-classes workflow (Squarespace + Arlo + TutorBird + MailerLite + Zapier + Synap + QuickBooks) with a single custom portal. Kills: per-class MailerLite automations, per-class Squarespace shop pages, Zapier payment-detection workarounds, manual spreadsheet reconciliation, and counselors having no visibility into enrollments. MailerLite is retained for marketing/newsletter (College Prep Compass) only.

## 2. Phase history & roadmap

- **Foundation (done, deployed, verified):** schools + school_counselors tables; sessions table; student_email/school_id/grade_level on students; instructor_email/default_location/synap_group/school_id on classes; stripe_session_id/stripe_payment_intent_id/paid_at on enrollments. Stripe webhook sibling bug fixed via enrollment_id in metadata — verified dead in production (back-to-back sibling test, July 2026).
- **Phase 2 (current):** everything in this spec.
- **Phase 3:** Supabase Auth + roles (admin/instructor/counselor/parent) + RLS. Required before the URL is shared publicly.
- **Phase 4:** portal views — instructor (classes/rosters), counselor (school's students), parent (kids' classes/schedule/receipts). #0's "View your registration" button returns here.
- **Phase 5:** course templates (clone template → school-specific cohort).
- **Phase 6:** QuickBooks integration (Stripe payment → QBO revenue record).
- **Later:** TutorBird replacement (purchased 1-on-1 hours become schedulable sessions — see enrollment_addons), Synap integration, portal.highergroundlearning.com subdomain.

## 3. Schema (Phase 2 additions)

- **schools:** `nickname` (text — email display name, e.g. "ASF", "SLS"), `timezone` (IANA, e.g. `America/Mexico_City`, `Europe/Rome`)
- **classes:** `class_type` (text; admin suggests "SAT Prep"/"ACT Prep", free entry allowed), `delivery_mode` (online | in_person), `capacity` (int; default 20 online), `min_enrollment` (int; default 3 online / 8 in-person, editable), `enrollment_deadline` (date, optional — decision checkpoint, not hard close). Class pricing stays per-class per-student (existing field).
- **enrollments:** status enum `Pending | Paid | Completed | Expired | Waitlisted`; `accommodations`, `previous_scores`, `notes` (optional text, on registration form); waitlist ordering by joined-at timestamp (FCFS).
- **families:** `marketing_opt_out` (boolean — suppresses relationship emails only; family-level so one opt-out covers all of a family's enrollments).
- **tutoring_packages:** name, hours, hourly_rate, package_price, phase (`pre_class` | `post_class`), active. Seed pre_class: 5h/$120/$600 · 10h/$105/$1,050 · 15h/$95/$1,425 (regular $130/hr). Seed post_class: 1–9h @ $125/hr · 10h+ @ $115/hr.
- **enrollment_addons:** enrollment_id, package_id, price paid. Purchased hours stored durably — future TutorBird-replacement phase turns them into schedulable sessions.

Computed values (never stored): `diagnostic_due_date` = first session − 1 day. `classTime` = if all sessions share one time range, render it; otherwise render "see the class calendar" + link.

## 4. Email infrastructure

- **Service:** Resend. Domain `highergroundlearning.com` (verification in progress).
- **Env vars:** `RESEND_API_KEY` (Sensitive; .env.local + Vercel), `EMAIL_FROM=Higher Ground Learning <info@highergroundlearning.com>` (default; not sensitive). Env changes apply at next build.
- **Senders:** default `info@`. From `William Thomas <billy@highergroundlearning.com>`: #1, #7, #8, #9.
- **Signature policy:** billy@ emails signed William Thomas; info@ emails signed "Higher Ground Learning" (#2, #3, #4, #6 re-signed accordingly).
- **Preheader support required** on every template (React Email `<Preview>`).
- **Send times:** 8:00 AM school-local, except #5 at 11:00 AM. Timezone from school record.
- **Stripe receipt emails:** OFF (portal #0 is canonical). Check sandbox and live separately.

## 5. Audience & voice system

Every template declares parent / student / both. Blank student_email → send parent-only silently. Student hard bounces → weekly digest.

- **Parent-only:** #0-parent, payment reminders ×4, #1, #7, #9, W1, W2
- **Both:** #2 (distinct versions), #3, #4, #5, #6, #8
- **Student-only:** #0-student, #2-student

**Audience-aware pronoun rendering ("fix pattern"):** shared templates render third-person for the parent send and second-person for the student send via conditional phrases (e.g. `{isStudent ? "you don't" : studentFirstName + " doesn't"}`). Applies to #4, #5, #6 throughout; #3 sign-off only; #8 ships same-copy to both.

## 6. Email sequence

| # | Email | Audience | Timing | From |
|---|---|---|---|---|
| 0 | Registration confirmation (distinct parent/student versions) | parent + student | instant on `checkout.session.completed` | info@ |
| PR1–4 | Payment reminders, escalating copy | parent | ~2h, 24h, 3d, 6d while `Pending`; then → `Expired` | info@ |
| 1 | Thank-you | parent | ~3h after payment | billy@ |
| 9 | Tutoring upsell — **conditional: only if no tutoring add-on** | parent | ~24h after payment | billy@ |
| 2 | Diagnostic/Synap access (distinct versions) | both | 10 days before start | info@ |
| 3 | VFAQs | both | 7 days before | info@ |
| 4 | Class details — **HOLD + alert if instructor or classroom blank** | both | 4 days before | info@ |
| 5 | Location reminder (online classes: classroom renders as meeting link) | both | 1 day before, 11:00 AM | info@ |
| 6 | 2nd diagnostic reminder | both | 7 days after start | info@ |
| 7 | Review request | parent | 1 day after final session | billy@ |
| 8 | Post-class tutoring offer (post_class pricing, BESTSCORE page) | both | 4 days after final session | billy@ |
| W1 | Waitlist confirmation | parent | instant on joining waitlist | info@ |
| W2 | Spot available (48h claim window) | parent | when spot opens | info@ |
| SU | Schedule update ({changesBlock}: only changed fields) | both | when start date/room/instructor changes after #4 sent | info@ |

**Late registration:** if signup postdates pre-start emails, send one combined welcome (thank-you + Synap + FAQ content) immediately, then join remaining schedule.
**Date changes:** recompute all pending sends automatically; sent emails never re-send except the SU trigger above.
**Unsubscribe policy:** transactional (#0, #2, #4, #5, PR, W1, W2, SU) — footer text, no unsubscribe link. Relationship (#1, #3*, #6, #7, #8, #9) — opt-out of non-essential updates via family-level `marketing_opt_out`. (*#3 footer per original MailerLite voice.)

## 7. Content pack — 15/15 complete

Global copy rules applied: "in the days before class starts" everywhere (never a specific day count); diagnostic deadline always "{diagnosticDueDate}, the day before the first class."

**Standard variables:** {parentFirstName}, {studentFirstName}, {schoolNickname}, {classType}, {className}, {firstSessionDate}, {classTime} (computed), {diagnosticDueDate} (computed), {synapGroupLink}, {price}, {instructorName}, {classroom}, {resumePaymentLink}, {expiryDate}, {claimLink}, {claimDeadline}, {waitlistPosition}, {calendarLink}, {addonLink}, {changesBlock}.

- **#0 parent** — adapted from Squarespace order email. Body verbatim + slim summary (class, amount paid, date) + registration recap (incl. accommodations/scores/notes, and tutoring add-on if purchased). Dropped: order #, confirmation code, SKU, view-order button (returns Phase 4), billing address, payment method.
- **#0 student** — "your in / yore inn" opener. Subject: "{schoolNickname} {classType} - you're in!" · Preheader: "See you on {firstSessionDate}". Student-framed Compass bullets, 3 testimonials.
- **PR1** — original MailerLite copy, button → {resumePaymentLink}. Subject: "{studentFirstName}'s registration for {schoolNickname} {classType} isn't confirmed yet" · Preheader: "Complete your payment to save their place in class".
- **PR2** (~24h) — "was something unclear?" angle + FAQs + reply-to-a-human line.
- **PR3** (~3d) — two-line nudge.
- **PR4** (~6d) — expiry version. Subject: "Last reminder: {studentFirstName}'s {schoolNickname} {classType} registration expires soon" · Preheader: "After {expiryDate}, the spot returns to the pool."
- **#1** — Subject: "Thank you, {parentFirstName}" · From: William Thomas · Preheader: "We're looking forward to working with {studentFirstName}". "My amazing mom" story; rewritten Compass paragraph (http://hgl.co/college-prep-compass); 3 testimonials.
- **#2 parent** — Subject: "Important {schoolNickname} {classType} diagnostic test information" · Preheader: "Here's how to access the first practice test." Sign-off "Invested in {studentFirstName}'s success, Higher Ground Learning". Buttons: Synap + calendar page. Hero photo retained.
- **#2 student** — minimal action email. Subject: "Your {classType} diagnostic test is ready" · Preheader: "Finish it by {diagnosticDueDate} — here's how to get in." Includes Synap "click register, provide basic info" onboarding.
- **#3** — Subject: "{schoolNickname} {classType} – here are some VFAQs" · Preheader: "You know, VERY Frequently Asked Questions". Accordion FAQs rendered as expanded plain Q&A. {classTime} + calendar link. Static FAQ links (Squarespace, not moving). Sign-off re-signed HGL.
- **#4** — Subject: "{schoolNickname} {classType} Reminder" · Preheader: "Class starts soon! Open to see where classes will be held." Hold-and-alert email. Pronoun rendering. Re-signed HGL.
- **#5** — Subject: "Classroom location for {schoolNickname} {classType}" · Preheader: "Open up to see where to go for class." Online classes: location renders as meeting link. Pronoun rendering.
- **#6** — Subject: "2nd Diagnostic Reminder for {schoolNickname} {classType}" · Preheader: "Taking practice tests leads to better scores." Pronoun rendering. Re-signed HGL.
- **#7** — Subject: "How did the {schoolNickname} {classType} class go?" · Preheader: "Tell us how we did — it genuinely helps." Review link: https://g.page/highergroundlearning/review?gm.
- **#8** — Subject: "Discounted 1-on-1 Tutoring for students who took the {schoolNickname} {classType} Class" · Preheader: "Keep {studentFirstName}'s momentum going before test day." SAT-specific copy generalized to {classType}/"the test". Page: highergroundprep.com/discount · password **BESTSCORE** (page updated for both tests; SAT1600 honored during transition). Post_class pricing.
- **#9** — Subject: "We didn't want you to miss this" · Preheader: "A lot of people don't notice it". Conditional upsell; savings computed from packages table; {addonLink} honors pre_class pricing until {firstSessionDate} then auto-expires. Footer: "This is actually the only one like it that we're planning to send to you" + opt-out.
- **W1** — Subject: "You're on the waitlist for {schoolNickname} {classType}" · Preheader: "{studentFirstName} is #{waitlistPosition} in line — here's how this works." Explains 48h claim mechanic; no payment taken.
- **W2** — Subject: "A spot just opened in {schoolNickname} {classType} 🎉" · Preheader: "It's {studentFirstName}'s if you want it — you have 48 hours." {claimLink}, {claimDeadline}; "no action needed if plans changed" close.
- **SU** — Subject: "Schedule update for {schoolNickname} {classType}" · Preheader: "One or two details have changed — here's the latest." {changesBlock} renders only changed fields; calendar link + subscription mention.

Full approved body copy for every template lives in the conversation record ("HGL Portal Phase 2 emails" chat) and should be committed with the templates.

## 8. Enrollment lifecycle & waitlist

- `Pending` → PR1–4 → `Expired` (frees capacity spot). `Paid` → `Completed` after the class's final session (per implementation — governs post-class emails #7/#8 eligibility).
- Paid count = capacity → public page flips Register → Join Waitlist (no payment) → W1.
- Spot opens (expiry/refund/capacity raise) → W2 to first in line (FCFS), 48h claim window; on expiry rolls to next; admin alerted per rollover, CC'd per offer.
- Min enrollment: never auto-refund. Alert at deadline (or N days before start): "ASF SAT Prep: 5 paid / 8 minimum". Refund vs. convert-to-1-on-1 is a human decision. Enrollment usually stays open past deadline until full.

## 9. Checkout add-ons

After the registration form, before payment: add-on step offering active pre_class tutoring packages ("only available at registration"). Selection becomes a second line item in the same Stripe checkout session; webhook resolves one payment → one enrollment + recorded add-on. Add-on appears in #0 recap and suppresses #9. No merch/physical products in the portal.

## 10. Admin notifications

**Immediate:** #4 hold-and-alert · payment webhook failures · waitlist offer rollovers · instructor/classroom blank 6 days before start · min-enrollment checkpoint.
**Weekly digest:** new registrations · student-email hard bounces.

## 11. Course calendar feature

ICS endpoint per class (`/api/classes/{id}/calendar.ics`): every session an event, school-local timezone, location or meeting link. One-time download and live subscription URL (auto-updates on date changes). Per-class landing page: Add to Google Calendar · Add to Apple Calendar · Download PDF schedule. All email calendar buttons link here.

## 12. Operational notes & open items

- Resend domain verification: DNS records pending green check → real delivery test → commit → push.
- Squarespace: discount page password BESTSCORE (done/in progress), copy references both tests; keep SAT1600 during transition.
- Stripe dashboard: receipt emails OFF (sandbox + live).
- Housekeeping: rotate STRIPE_SECRET_KEY + STRIPE_WEBHOOK_SECRET (re-add as Sensitive); revoke old WilliamRThom `gho_` OAuth token.
- `info@` and `billy@` exist in Google Workspace ✓.
- Spec home: commit as `docs/SPEC.md` (repo = source of truth); refresh copy in claude.ai project knowledge at phase boundaries.
