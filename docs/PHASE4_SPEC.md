# HGL Portal — Phase 4 Spec: Portal Views

**Draft v2 · July 6, 2026 · Companion to hgl-portal-master-spec.md (v2.3)**
**Depends on:** Phase 3 auth + RLS read scopes (shipped, pending push of `9a251f7`).
**Scope:** three authenticated read-mostly views — instructor, counselor, parent — plus counselor digests, the classroom-request loop, score display groundwork, and the account-provisioning decisions these force.
**v2 changes:** all §8 open items resolved by Scarlett (July 6); added counselor enrollment digest + final-3-days push, classroom-request form, instructor default meeting link, Synap score display architecture, sibling/returning-family requirement, course collateral (letter/flyer) as Phase 4.5.

---

## 1. Goals & non-goals

**Goals:** instructors see their classes, rosters, and scores; counselors see their school's enrollments and scores without emailing HGL; parents see their kids' classes, schedules, and receipts. Kill "email the counselor an enrollment count" and "email the counselor asking for a room" for good.

**Non-goals:** roster editing, self-serve schedule changes, refunds, tutoring-hour scheduling (TutorBird-replacement phase), live Synap API integration (ingestion method decided separately — §6).

## 2. Account provisioning model — DECIDED

**Passwordless magic link + OTP code fallback. Accounts provisioned implicitly from existing data. Public signup stays disabled.**

Every legitimate user already exists in the DB (`families.parent_email`, `school_counselors.email`, `classes.instructor_email`, admin allowlist). Login = prove you own an email we already have.

**Flow:**
1. `/login` — single email field. Lookup across the four sources.
2. Match → Supabase Auth sends **both** a magic link and a 6-digit OTP code in the same email (OTP covers expired links and school-district link-scanners that consume one-time links). No match → nothing sent; the on-screen response is identical either way (no enumeration): "If this email is associated with Higher Ground Learning, a login link and code are on their way — check your inbox and spam folder." plus a help paragraph steering parents to the exact registration email (alternate/work-email mismatches happen) and to info@highergroundlearning.com. Submitted emails are trimmed/lowercased before lookup; obviously malformed addresses (missing @) get an inline "that doesn't look like a valid email" before submission.
3. First login lazily creates `auth.users`; a `profiles` table links roles.
4. **Session lifetime: 30 days** (decided). *Amended July 6: the Supabase free plan locks the session time-box at "never" — accepted deviation; sessions persist until sign-out. Revisit on a paid plan.*

**Roles** derived from data, not stored: parent ⇐ `families.parent_email` · counselor ⇐ `school_counselors.email` · instructor ⇐ any `classes.instructor_email` · admin ⇐ `ADMIN_EMAILS` allowlist. Multi-role emails get a **role switcher** (decided).

**Deliverability note:** magic links ride the same verified Resend domain as all money emails. Send via Resend SMTP configured in Supabase Auth (decided — see §10 checklist).

## 3. Parent view (`/portal`)

- **My students** — one card per student in the family: name, school, grade/grad year. Siblings appear side by side automatically (families → students is one-to-many; see §7).
- **Per student, enrollments** — class, status badge (Pending / Paid / Completed / Expired / Waitlisted incl. position), instructor, classroom/meeting link (blank fields render "details coming soon", mirroring the #4 hold rule).
- **Session schedule** — reuse the visual session calendar from `/register/{slug}` read-only, school-local timezone, with Add-to-Calendar/subscribe buttons (§11 ICS).
- **Diagnostic scores** — once score ingestion exists (§6): per-student score summary per class. Ships dark (hidden) until the scores table has data.
- **Receipts** — per paid enrollment: amount, date, Stripe reference, tutoring add-on line. **Receipt PDF: IN** (decided) — generated from our own data using the same PDF machinery as §8 collateral.
- **Pending enrollments** show the resume-payment button ({resumePaymentLink} target).

## 4. Counselor view

Scoped by RLS to their school.

- **Open/upcoming classes** — class, dates, price, **paid count / capacity**, waitlist depth, registration link with copy button, and download buttons for the parent letter / student flyer once §8 ships.
- **Roster per class** — student name, grade, enrollment status, **diagnostic scores, and accommodations** (decided: counselors DO see scores + accommodations). Still excluded: parent contact details, payment amounts, notes.
- **Past classes** — collapsed, same roster minus registration link.

### 4a. Counselor enrollment digest (new)

- **Default: weekly email** per counselor summarizing each open class at their school: paid count / capacity, new enrollments since last digest, waitlist depth, registration link.
- **Frequency self-serve:** footer links ("weekly · every 2 weeks · monthly · pause") — tokenized one-click, no login, writes `school_counselors.digest_frequency`.
- **Final-week push:** on each of the **last 3 days** before the class's `enrollment_deadline` (fallback: first session date), send a daily version framed for last-minute signups: spots remaining + registration link to forward. Fires regardless of digest frequency; suppressed if the class is already full (switches to a "class is full 🎉 + waitlist depth" one-off instead).
- Infrastructure: same scheduled-send cron as Phase 2 emails.

### 4b. Classroom-request loop (new)

Replaces "Scarlett emails the counselor, counselor replies, Scarlett edits the class."

- **Trigger:** class is `in_person` and `classroom` blank at **14 days** before first session (configurable).
- **Email to counselor:** "Where will {schoolNickname} {classType} be held?" containing a single-question tokenized form (no login). Free-text answer, e.g. "Room C19 in the high school."
- **On submit:** writes `classes.classroom`, alerts admin ("Counselor set ASF SAT Prep location: Room C19"), and everything downstream — #4, #5, ICS calendar, portal views, letter/flyer — picks it up automatically. If #4 already sent, triggers the existing SU schedule-update email.
- **No response:** two re-nudges (at 11 and 8 days before start); then the existing #4 hold-and-alert remains the backstop at 6 days. Nothing silently breaks.
- Admin can still set the room directly at any time; the pending request auto-cancels.

## 5. Instructor view

Scoped by RLS to classes where `instructor_email` = login email.

- **My classes** — upcoming + past, session calendar, enrollment count vs min/capacity, Synap group link.
- **Roster** — student name, student email, grade, school, accommodations / previous scores / notes (instructors keep full intake fields), **diagnostic scores** (§6), paid vs pending flag. No payment amounts.
- **Meeting link (new):** instructors get a `default_meeting_link` (stored per instructor — new `instructors` table or key-value on profile). Online classes auto-populate `classroom` from it at class creation; admin can override per class. The view shows the effective location: onsite room, or the override link, or the default. This also feeds emails #4/#5 automatically.

## 6. Score display & Synap ingestion (new)

**Display layer (Phase 4):** a `student_scores` table (student_id, class_id, test_label, section scores, total, taken_at, source). Parent/counselor/instructor views render from it as specced above; all three ship dark until data exists.

**Ingestion (decide after investigation):** scores live in Synap, so the method depends on what Synap exposes:
1. **Synap API** available → scheduled sync job (best case; this becomes the "Synap integration" roadmap item).
2. **CSV export only** → admin "Upload Synap export" button mapping rows to students by student_email. Still kills the manual Google Sheet workflow.
3. Investigation task: ~30 min review of Synap API/export docs before committing. Owner: Scarlett/Code.

Either path feeds the same table, so the display work is never wasted.

## 7. Siblings & returning families (requirement, mostly already true)

The model already handles siblings: one family row per parent email; students one-to-many; enrollments per student; the Stripe sibling webhook bug was fixed in Foundation and verified in production. Parent login shows all children, past and present classes.

**Explicit Phase 4 requirement:** the registration form must match on parent email and **attach new students/enrollments to the existing family** instead of creating duplicates — covering both "two siblings, same class" and "younger sibling, two years later." Add a test for a repeat parent email with a new student.

## 8. Course collateral: parent letter + student flyer (Phase 4.5 fast-follow)

Replaces per-class manual Canva work.

- Two PDF templates designed once in code (letter: parent-voiced overview; flyer: student-facing one-pager). Merge fields all exist already: school, class type, dates/times, price, instructor, classroom, registration URL (+ QR code of the hgl.co link on the flyer).
- Generated on demand: buttons in admin class view and counselor portal. Never stale — regenerating after a schedule change is automatic by construction.
- Main cost is design polish, not plumbing; same PDF machinery powers parent receipt PDFs (§3).
- Sequenced as fast-follow so it doesn't block portal-view launch.

## 9. Entry points & routing

- **Root URL (`/`): keep the marketing-site redirect.** Nobody lands on the bare domain intentionally — all traffic arrives via `/register/{slug}` links and email buttons to `/portal`. Flipping root to the portal login is bundled with the future `portal.highergroundlearning.com` subdomain cutover.
- **Email #0 "View your registration" button:** `/portal?enrollment={id}` → active session deep-links to the card; no session → `/login` with email prefilled via signed query param, one tap for the magic link, redirect back. (Confirmed.)
- All portal routes: unauthenticated → `/login?next=…`.

## 10. Admin additions

- `ADMIN_EMAILS` allowlist (env var, v1).
- Counselor management (add/remove per school, set digest frequency) in admin UI.
- Instructor management incl. `default_meeting_link`.
- Classroom-request status visible on the class (requested / answered / overridden).
- Configure Supabase Auth to send via Resend SMTP (decided) — link + OTP in one template.

## 11. Acceptance checklist

- [ ] Parent magic-link + OTP login shows exactly their family's students/enrollments/schedules/receipts; second-family RLS verified. Email trimmed/lowercased before lookup; malformed addresses get an inline validity error before submission; match and no-match show the identical "login link and code are on their way — check your inbox and spam folder" response (with the exact-registration-email / info@ help copy), and no-match sends nothing.
- [ ] Sibling test: repeat parent email + new student attaches to existing family; both kids visible in one login.
- [ ] Counselor sees own school only; sees scores + accommodations; cannot see parent contact, payments, or notes.
- [ ] Counselor digest sends weekly by default; footer frequency links work without login; final-3-days push fires against a test deadline; full-class variant suppresses the push.
- [ ] Classroom-request form (tokenized, no login) writes `classes.classroom`, alerts admin, triggers SU when #4 already sent.
- [ ] Instructor sees rosters + intake fields for own classes only; online class auto-fills meeting link from instructor default; onsite override displays correctly.
- [ ] `student_scores` display renders in all three views when seeded manually; hidden when empty.
- [ ] Receipt PDF downloads with correct amount, date, add-on line.
- [ ] #0 button deep-links in both auth states; root URL still redirects to highergroundlearning.com.
- [ ] Multi-role email gets the role switcher.

## 12. Class cancellation flow (new — added July 6)

Closes the loop the master spec left as "refund vs. convert is a human decision": today the decision triggers a manually written email and nothing stops the automation. New behavior:

- **`classes.status`:** `open | cancelled` (default open). Cancelling is an explicit admin action, never automatic — min-enrollment alerts remain advisory only.
- **Admin "Cancel class" flow:** admin opens the class → Cancel → a form composes the cancellation email before anything sends:
  1. **Tutoring conversion offer (optional, on by default):** admin picks the number of 1-on-1 hours to offer for the already-paid fee (**default: 8 hours**, editable). Portal auto-computes the display math from `tutoring_packages` regular rate vs **`classes.price` only — never `amount_paid`** (amended July 6: the cancelled product is the group class; tutoring add-ons are a separate purchase that survives cancellation in every outcome, including refund — refund = class fee only). E.g. "10 hours (a savings of 42% / $551 vs our typical fees)." Hours picker, math generated, no hand calculation; sanity flag when offerHours × regular rate ≤ class price.
  2. **Credit-to-next-course offer (optional):** free-text expected term (e.g. "February or March 2027").
  3. Full refund is **always** listed as an option in the email regardless of toggles.
  4. Preview rendered per family — amended July 6: the math is identical for all families; the preview differs only in **which CX variant renders**. Add-on families get the combined-total wording ({addonHours}, {totalHours} = offerHours + addonHours) and the keep-your-hours reassurance line; the confirm summary lists which families get the add-on variant. → admin confirms → send.
- **On confirm, atomically:**
  - Class → `cancelled`; enrollments `Paid` → keep status but flag `class_cancelled` (refund handling stays manual in Stripe for now); `Pending` → `Expired` immediately (no cancellation email to unpaid — their PR sequence just stops).
  - **All pending scheduled sends for the class are cancelled:** #2–#6 pre/post-start emails, PR reminders, counselor digest entries, final-days push, classroom-request emails, SU. Nothing class-related sends after cancellation except the cancellation email itself.
  - Cancellation email (template CX) sends to **both parent and student of Paid enrollments** from billy@ (pronoun-rendered per the Phase 2 fix pattern; blank student_email → parent-only silently, per the standard audience rule). Waitlisted families get a short separate note (CX-W) releasing them.
  - Counselor/school contact gets a plain notification ("class cancelled; families have been offered X").
  - ICS calendar feed empties (subscribed calendars auto-clear); registration page flips to the existing "class full" state (reads better than a cancellation notice; no waitlist button) + link to main site.
- **Reply handling stays human:** parents reply to billy@ with their preference; recording the outcome (refunded / converted / credited) is an admin field on the enrollment for bookkeeping, not automated Stripe action in this phase.

## 13. Resolved decisions log (July 6)

Magic link + OTP: YES · signup disabled: YES · session 30d · multi-role: switcher · receipt PDF: in · counselors see scores + accommodations: YES (contact/payments/notes still no) · root URL: marketing redirect until subdomain cutover · Synap ingestion method: pending investigation, Scarlett looking into it (§6.3) · classroom-request re-nudges: two (11d, 8d).
