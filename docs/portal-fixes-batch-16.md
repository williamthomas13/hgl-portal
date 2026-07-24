# Portal fixes — batch 16 (pre-launch blockers from the July 23 full-codebase audit)

Eleven items, PL-113…123. Sourced from a six-pass audit (security, email logic, money paths, scheduling, frontend, spec coverage); every claim was re-verified in source. These are the fix-before-launch tier; a hardening batch 17 follows separately.

**Standing rules:** plain-English statuses · "Ops Director" · no internal shorthand in reader-facing bodies · every alert deep-links its record · `git push` after committing · PL-x IDs in commits · check items off here when shipped · keep `regress:client-imports` and the full battery green.

## PL-113 · Secrets fail CLOSED: kill the `'dev-secret'` fallback and the cron auth skip

Two fail-open defaults, same root class:
- Every HMAC-signed link (convert, claim/decline, availability, intake, unsubscribe, agreement, counselor digest, classroom request, addon checkout, resume, login-prefill) signs with `process.env.CRON_SECRET ?? 'dev-secret'` — `lifecycle.ts:319,397,417,502,522,542,552,599,619`, `intake.ts:15`, `portal-auth.ts:307`. A missing env var makes every token forgeable with a public string.
- `app/api/cron/reminders/route.ts:1560-1563`: `if (cronSecret && …)` — auth is skipped entirely when the secret is unset; the sweep becomes world-callable.

**Fix:** introduce `TOKEN_SIGNING_SECRET` (separate from the cron bearer — one secret should not serve both roles); a shared `signingSecret()` helper that **throws** when unset (module scope or first use — never a default). Cron route: return 401 unconditionally when `CRON_SECRET` is unset. Deployment note: setting a NEW signing secret invalidates every previously-emailed token — since we're pre-launch with only QA/test links in the wild, set `TOKEN_SIGNING_SECRET=CRON_SECRET`'s current value in Vercel to preserve continuity, or accept the invalidation deliberately and say so in the checkoff. Follow the Resend webhook's pattern (`webhooks/resend/route.ts`) — it already fails closed correctly.
**Verify:** E2E with env var absent in a dev-shaped run → token mint/verify throws, cron 401s; with it present → existing E2Es green.

## PL-114 · Tutoring charge path: atomic claim + Stripe idempotency keys (double-charge window)

`tutoring-stripe.ts:117-143,172-243,246-287`: `issueOrCharge` gates on a plain read; `chargeAutopay`'s claim `.in('status',['confirmed','invoiced'])` matches for BOTH of two concurrent callers; `paymentIntents.create` (and `invoices.create`) carry no idempotency key. Concurrent entry points are real: the confirm follow-up (`after()`), the daily collections sweep's "confirmed but never billed" loop, and the admin retry/send-now buttons — a double-click can charge a family twice.

**Fix:** claim FIRST and atomically — `update({status:'invoicing'}).eq('status','confirmed').select()`, proceed only if the row came back (loser no-ops); pass `{idempotencyKey: 'tutoring:'+invoiceId+':'+attempt}` to every PaymentIntent/invoice create; on the hosted-invoice path, create the Stripe invoice only after the claim, and void the old document if a new one is minted.
**Verify:** E2E: two concurrent `issueOrCharge` calls on one confirmed invoice → exactly one PI/invoice; admin double-click → one charge; replayed idempotency key returns the same PI.

## PL-115 · Late fee: refuse a second application

`app/api/admin/tutoring/invoice/route.ts:85-92`: `apply_late_fee` inserts 10% of the current total with no existing-line check — two clicks = two fee lines (and the second computes off the already-fee'd total: 21%).

**Fix:** reject `apply_late_fee` when a `kind='late_payment_fee'` line exists (clear message back to the UI); compute the fee off the pre-fee subtotal. Disable the button in the UI when a fee line is present.
**Verify:** double-click E2E → one line; re-issue after fee keeps one fee.

## PL-116 · Conversion must not credit the tutoring add-on the family keeps

`convert-tutoring.ts:65,102-125` uses `paid = enrollment.amount_paid` — the Stripe `amount_total` including any in-checkout tutoring add-on (`checkout-paid.ts:158`). The dollar path credits the full amount to the Stripe balance while the family keeps the prepaid add-on hours; the hours path records `price_paid: paid` against the class-only offer. $500 class + $450 add-on → $950 credited + 6 hours kept.

**Fix:** compute `convertedAmount = amount_paid − Σ(enrollment_addons.price_paid for in-checkout addons)`; use it for the balance credit and the conversion addon's `price_paid`. Keep the family's original add-on rows untouched (their hours remain theirs — that's the PL-84 keep-your-hours promise). Update the CX composer's savings math if it reads the same field.
**Verify:** E2E: enrollment with add-on → convert (both paths) → credit/price equals class fee only; keep-your-hours line still renders; no-addon enrollments unchanged.

## PL-117 · Only `confirmed` sessions auto-complete (never-approved sessions were becoming payable)

`timecards.ts:141-153`: `autoCompleteSessions` flips `.in('status',['proposed','confirmed'])` past their end time. `proposed` = explicitly not approved (PL-41 approval hold; 7c pauses auto-confirm while a change request is open) — yet an unresolved month lands on the tutor's timecard AND the family's invoice.

**Fix:** restrict to `['confirmed']`. Then sweep for stranded `proposed` rows whose month came and went: they should either expire/cancel or surface as a state-driven Needs Attention row ("September proposal for {family} was never resolved") — pick the mechanism that fits the 7c change-request flow and document it in the checkoff.
**Verify:** E2E: proposed session past end-time stays proposed and appears nowhere payable/billable; confirmed still completes.

## PL-118 · Deadline renders in the recipient's timezone (W2 claim + PR4 expiry)

`email.ts:1042-1044` (W2 claim deadline) and `waitlist-offers.ts:41-44` (`claimDeadline` variable) render with no `timeZone` → server UTC; the enforced expiry uses the true instant, so a family can read a deadline hours later than the one that fires. Same bug: PR4's expiry date (`email.ts:370-371`), date-only and unzoned.

**Fix:** thread the class/school timezone into both renders, include the zone label in copy ("by Thursday, 3:00 PM (Mexico City time)"); PR4 gets a datetime, not a bare weekday. Grep for any other `toLocaleString`/`toLocaleDateString` without `timeZone` in email-facing code and fix the stragglers (the rest of the codebase passes it deliberately).
**Verify:** render tests pin a non-UTC school and assert the stated time equals the enforced instant in that zone.

## PL-119 · Late registrants must not receive past-dated pre-start emails

`checkout-paid.ts:318-322` supersedes only `synap_access`+`faq` for the LR welcome; `isDue` (`lifecycle.ts:126-129`) is true forever, so a family paying after the class starts also gets #4 ("class starts soon") and #5 for dates in the past on the next hourly sweep.

**Fix:** for enrollments whose `paid_at` postdates a pre-start step's target date, mark those steps superseded (or skip `anchor:'first'` negative-offset steps once class-local today > their target). The LR welcome already carries the essential content. Post-start steps (#6/#7/#8) keep normal behavior.
**Verify:** E2E: pay after session 2 → LR welcome only, no #4/#5; pay before start → sequence unchanged (existing suites green).

## PL-120 · A Resend failure must not permanently lose a tutor batch notice

`tutor-notices.ts:192-200`: `sendOnce` returns `'failed'` without throwing, so the pending row (already claimed `sent`) never reverts and no sweep retries — the notice is lost forever, not "one sweep late" as the comment claims.

**Fix:** when `sendOnce` returns `'failed'`, revert the row to `pending` (same as the catch path). Audit the other `sendOnce` callers that pre-claim state for the same throw-vs-returned-failure blind spot; list any siblings fixed.
**Verify:** E2E with a stubbed failing send → row back to pending → next sweep sends.

## PL-121 · Webhook replay must not flip a Refunded/Completed enrollment back to Paid

`checkout-paid.ts:152-166`: the paid update has no status guard; a redelivered/dashboard-resent `checkout.session.completed` (or the admin match page re-running the path) re-marks a Refunded row Paid with a fresh `paid_at`.

**Fix:** guard the transition — `.in('payment_status',['Pending','Expired','Waitlisted'])` — and when the guard skips on a replay, log + (if the row is Refunded) fire an admin alert, since a genuine payment against a refunded enrollment is exactly the mismatch cockpit's business.
**Verify:** E2E: mark Paid → Refunded → replay the event → still Refunded, alert fired; fresh payment path unchanged.

## PL-122 · Engagement "regenerate" must respect reschedule tombstones

`app/api/admin/tutoring/engagement/route.ts:102-167`: `materializeSessions` dedupes against live rows only (`.in('status',['proposed','confirmed'])`) while the monthly cycle correctly treats `rescheduled`/`cancelled` as taken (`tutoring-billing.ts:280-285`, PL-62). `clearFutureSessions` also deletes replacement sessions and leaves `rescheduled_to_id` dangling. Regenerating after a reschedule can resurrect the original slot (re-billed, plus the late fee already charged on its tombstone) and silently delete the agreed replacement.

**Fix:** include tombstone statuses in the `taken` set; preserve replacement sessions in `clearFutureSessions` (or explicitly cascade with a notice + fee reversal — preserving is simpler and matches the monthly cycle's semantics). Repair pass for any dangling `rescheduled_to_id`.
**Verify:** E2E: reschedule → regenerate → original slot NOT recreated, replacement intact, no duplicate billing; PL-62 suite green.

## PL-123 (small) · Walkthrough sweep: labels, fallbacks, and the hard-coded name ✅ (incl. the post-pull "what they receive" addition)

> **Shipped in two passes** (the doc update below landed after the first pass; its root-cause note matches what was found and fixed). **Pass 1 (Jul 23):** "Show started & closed" label live; `loadContactInfo()` fallbacks are position-based ("the Higher Ground office" / info@) — note /inquire was never hard-coded, it renders the app_settings role record, which itself holds kelsie@ (one-edit change in Contact settings if the public page should differ); unknown `?role=` degrades to the Parent tab; the school-contact picker's silently-erroring query fixed (`.is('ended_at', null)` — no status column exists); the "billingamounts" typo was REAL despite correct source — this Next version's JSX transform eats spaces at inline-element boundaries, fixed with explicit `{' '}`. **Pass 2 (Jul 24, this addition):** (1) picker query errors now SURFACE ("This picker hit a database error instead of returning records: …") instead of reading as empty data — on all three pickers. (2) The school-contact tab gained **"What a school contact receives"**: all six CD/CR/FP templates (digest, CR1/CR2/CR3 classroom loop, final-days push, class-full) rendered with sample data through `renderVersion` + `sampleExtraFor` — the template editor's own pipeline, PL-96 compliant (composed blocks come from composers) — as collapsible cards showing subject + full body ("Hi Marisol, Here's where enrollment stands…"), with a draft badge for any not-yet-live template. Browser-verified: six cards, real sample subjects and bodies, picker intact alongside.

Four small items from the July 23 stakeholder walkthrough:
- **Leads page:** the pipeline toggle still reads "Show won & lost" — finish the PL-109 rename ("Show started & closed"); grep for other won/lost stragglers in UI copy.
- **/inquire:** the "Rather just talk to a person?" block hard-codes kelsie@highergroundlearning.com — render the Manager role's contact from the role record (the PL-112 position-not-name machinery), falling back to info@ if the role record is empty.
- **/admin/view-as:** an unknown `?role=` value renders a broken empty picker (seen with `role=school`) — fall back to the parent tab or show "unknown role". And the **school-contact picker is empty — ROOT CAUSE FOUND (verified in prod SQL):** the picker queries `school_affiliations.eq('status','active')` but that table has NO `status` column (its columns: id, contact_id, school_id, role, started_at, ended_at, digest_frequency, digest_last_sent_at, created_at) — the query errors and the picker silently renders empty. Fix: filter `.is('ended_at', null)` (the actual active signal), and surface query errors in this picker rather than swallowing them (an erroring admin query should never look like "no data"). The counselor view itself is fine — once the picker works, View-as school-contact should render `CounselorView` with the school's registration numbers/attendance/scores as specced. **Plus (Scarlett greenlit):** the school-contact tab also gains a "what they receive" section — the rendered CD/CR/FP email set with sample data (same prose-explainer pattern as the Manager tab) — since the emails are most of the counselor relationship and this doubles as a training aid for new staff. Render via the existing preview machinery (sample-variable pipeline; PL-96 rules apply — samples from composers).
- **View-as manager copy typo:** "billingamounts" → "billing amounts".

**Verify:** labels correct · /inquire shows the role-derived contact · bogus role param degrades gracefully · school-contact tab is functional-or-honest · typo gone.

**Batch-wide verify:** full gate battery + regress:client-imports + the money-path E2Es above run green; no template reseeds expected (PL-118's copy changes are in code composers — re-render the affected samples if their shape changes).
