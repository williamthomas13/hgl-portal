# Portal fixes — batch 16 (pre-launch blockers from the July 23 full-codebase audit)

Eleven items, PL-113…123. Sourced from a six-pass audit (security, email logic, money paths, scheduling, frontend, spec coverage); every claim was re-verified in source. These are the fix-before-launch tier; a hardening batch 17 follows separately.

**Standing rules:** plain-English statuses · "Ops Director" · no internal shorthand in reader-facing bodies · every alert deep-links its record · `git push` after committing · PL-x IDs in commits · check items off here when shipped · keep `regress:client-imports` and the full battery green.

## PL-113 · Secrets fail CLOSED: kill the `'dev-secret'` fallback and the cron auth skip ✅

> **Shipped; zero `'dev-secret'` occurrences remain (repo-grep), 6/6 signing checks + live 401s.** New `app/utils/signing.ts` (added to the `regress:client-imports` server-only list) with TWO helpers because the audit's list undercounted — the fallback also lived in `schedule-approval.ts`, `tutoring-billing.ts`, `qbo.ts` ×2, and `gcal.ts`, and two of those are **credential-encryption key derivations**, not link tokens: (1) `signingSecret()` for every HMAC link/state token (lifecycle ×9, intake, login-prefill, schedule approval, billing proposals, QBO OAuth state); (2) `credentialKeySecret()` for the AES keys encrypting stored QBO tokens + the Google service-account JSON — these stay derived from `CRON_SECRET` **deliberately** (switching the derivation would orphan the stored credentials on deploy; rotation already surfaces as "reconnect", documented in place). Cron route now 401s **unconditionally** when `CRON_SECRET` is unset (fail closed), verified live: no header → 401, wrong bearer → 401.
>
> ⚠️ **One deliberate deviation from the spec:** `signingSecret()` prefers `TOKEN_SIGNING_SECRET` but **falls back to `CRON_SECRET`** (throws only when BOTH are unset) instead of hard-throwing when the new var is missing. Reason: pushes to main auto-deploy, and nobody can set Vercel env vars from this session — a hard throw would have broken every signed-link mint in production at the next deploy. No public default survives either way. **Action for Billy/Scarlett: add `TOKEN_SIGNING_SECRET` in Vercel** (set it to CRON_SECRET's current value for token continuity, or a fresh value to deliberately invalidate outstanding links) — that completes the role separation. Verified: throws with both unset, CRON_SECRET-only fallback works, TOKEN_SIGNING_SECRET wins when both set, minted tokens are byte-identical to the legacy CRON_SECRET signatures (nothing in the wild breaks), round-trip verify green. Dev `.env.local` carries the new var.

Two fail-open defaults, same root class:
- Every HMAC-signed link (convert, claim/decline, availability, intake, unsubscribe, agreement, counselor digest, classroom request, addon checkout, resume, login-prefill) signs with `process.env.CRON_SECRET ?? 'dev-secret'` — `lifecycle.ts:319,397,417,502,522,542,552,599,619`, `intake.ts:15`, `portal-auth.ts:307`. A missing env var makes every token forgeable with a public string.
- `app/api/cron/reminders/route.ts:1560-1563`: `if (cronSecret && …)` — auth is skipped entirely when the secret is unset; the sweep becomes world-callable.

**Fix:** introduce `TOKEN_SIGNING_SECRET` (separate from the cron bearer — one secret should not serve both roles); a shared `signingSecret()` helper that **throws** when unset (module scope or first use — never a default). Cron route: return 401 unconditionally when `CRON_SECRET` is unset. Deployment note: setting a NEW signing secret invalidates every previously-emailed token — since we're pre-launch with only QA/test links in the wild, set `TOKEN_SIGNING_SECRET=CRON_SECRET`'s current value in Vercel to preserve continuity, or accept the invalidation deliberately and say so in the checkoff. Follow the Resend webhook's pattern (`webhooks/resend/route.ts`) — it already fails closed correctly.
**Verify:** E2E with env var absent in a dev-shaped run → token mint/verify throws, cron 401s; with it present → existing E2Es green.

## PL-114 · Tutoring charge path: atomic claim + Stripe idempotency keys (double-charge window) ✅

> **Shipped, 9/9 money-path E2E green against real Stripe test mode — now a standing gate (`npm run regress:tutoring-charge`, self-compiling, self-cleaning, send-light).** (1) **Atomic claim:** `issueOrCharge` claims `confirmed→invoicing` with `.select()` before touching Stripe — exactly one of two concurrent callers proceeds (verified: `["hosted_invoice","noop_lost_claim"]`), the loser no-ops; new `'invoicing'` status + `issue_attempts` counter via migration `20260811000001` (**applied**; both admin panel and parent portal render the transient state). (2) **The retry path has its own claim:** `chargeAutopay`'s attempts bump doubles as an optimistic lock (`.eq('charge_attempts', snapshot)`) — covers the sweep calling it directly, where the status-based claim can't help; verified one winner. (3) **Idempotency keys everywhere:** PaymentIntents `tutoring:pi:{id}:{attempt}`, hosted invoice create/items/finalize `tutoring:{inv,itemN,fin}:{id}:{issue_attempts}` — a same-attempt duplicate returns the SAME Stripe object. (4) **Failure releases the claim** (catch reverts `invoicing→confirmed` so the sweep genuinely retries) and the sweep reverts claims stranded >15 minutes by a crash; a re-issue **voids the superseded document** if still open (the admin re-issue path already did; this covers crash-window leftovers). Verified end-to-end: two concurrent calls → exactly ONE Stripe invoice / ONE PaymentIntent (counted by customer, not the laggy search API); admin double-click on an invoiced row → both no-op; dunning path never strands `'invoicing'`. One harness lesson worth keeping: the first run "failed" because the FIXTURE silently violated `qty_hours not null` — the module then correctly minted a $0 invoice which Stripe auto-pays; fixture inserts now hard-fail on error.

`tutoring-stripe.ts:117-143,172-243,246-287`: `issueOrCharge` gates on a plain read; `chargeAutopay`'s claim `.in('status',['confirmed','invoiced'])` matches for BOTH of two concurrent callers; `paymentIntents.create` (and `invoices.create`) carry no idempotency key. Concurrent entry points are real: the confirm follow-up (`after()`), the daily collections sweep's "confirmed but never billed" loop, and the admin retry/send-now buttons — a double-click can charge a family twice.

**Fix:** claim FIRST and atomically — `update({status:'invoicing'}).eq('status','confirmed').select()`, proceed only if the row came back (loser no-ops); pass `{idempotencyKey: 'tutoring:'+invoiceId+':'+attempt}` to every PaymentIntent/invoice create; on the hosted-invoice path, create the Stripe invoice only after the claim, and void the old document if a new one is minted.
**Verify:** E2E: two concurrent `issueOrCharge` calls on one confirmed invoice → exactly one PI/invoice; admin double-click → one charge; replayed idempotency key returns the same PI.

## PL-115 · Late fee: refuse a second application ✅

> **Shipped, 6/6 E2E green.** `apply_late_fee` now (1) refuses when a `late_payment_fee` line exists ("This invoice already carries the late fee — it applies once."), (2) computes the fee off the **pre-fee subtotal** (sum of non-fee lines, never the possibly-fee'd total), and (3) — beyond the spec — is race-proof: a **partial unique index** (`tutoring_invoice_lines_one_late_fee`, migration `20260812000001` **applied**) makes the database refuse a concurrent double-apply that slips past the read-then-insert check, with the 23505 mapped back to the same friendly message. The UI button becomes "late fee applied ✓" once the line exists and the confirm message quotes the correct pre-fee-based amount. Verified: sequential re-apply 400s; a true concurrent double-apply returns one 200 + one 400 with exactly one $20 line on a $200 invoice; total lands 220, never 242.

`app/api/admin/tutoring/invoice/route.ts:85-92`: `apply_late_fee` inserts 10% of the current total with no existing-line check — two clicks = two fee lines (and the second computes off the already-fee'd total: 21%).

**Fix:** reject `apply_late_fee` when a `kind='late_payment_fee'` line exists (clear message back to the UI); compute the fee off the pre-fee subtotal. Disable the button in the UI when a fee line is present.
**Verify:** double-click E2E → one line; re-issue after fee keeps one fee.

## PL-116 · Conversion must not credit the tutoring add-on the family keeps ✅

> **Shipped, 6/6 E2E green.** One fix point: `loadConversionRecord` now computes `paid = max(0, amount_paid − Σ price_paid of enrollment_addons where source ≠ 'cancellation_conversion')` — both conversion paths inherit it, since the hours path's `price_paid` and the dollar path's balance credit (and `creditAmount`) all read `record.paid`. Verified with the doc's own scenario: $950 total ($500 class + $450 in-checkout add-on) → record.paid $500, conversion addon minted at $500/6h, **the family's original add-on row untouched** (their hours stay theirs — the PL-84 promise); no-addon enrollments unchanged ($500 → $500). The CX composer needed **no change**: `cancellation-copy.ts` already documents and uses the class fee (`classes.price`) — "never amount_paid" — so the savings math was never on the buggy field.

`convert-tutoring.ts:65,102-125` uses `paid = enrollment.amount_paid` — the Stripe `amount_total` including any in-checkout tutoring add-on (`checkout-paid.ts:158`). The dollar path credits the full amount to the Stripe balance while the family keeps the prepaid add-on hours; the hours path records `price_paid: paid` against the class-only offer. $500 class + $450 add-on → $950 credited + 6 hours kept.

**Fix:** compute `convertedAmount = amount_paid − Σ(enrollment_addons.price_paid for in-checkout addons)`; use it for the balance credit and the conversion addon's `price_paid`. Keep the family's original add-on rows untouched (their hours remain theirs — that's the PL-84 keep-your-hours promise). Update the CX composer's savings math if it reads the same field.
**Verify:** E2E: enrollment with add-on → convert (both paths) → credit/price equals class fee only; keep-your-hours line still renders; no-addon enrollments unchanged.

## PL-117 · Only `confirmed` sessions auto-complete (never-approved sessions were becoming payable) ✅

> **Shipped, 4/4 E2E green.** `autoCompleteSessions` now flips `confirmed` only. **Stranded-proposal mechanism (the decision + why):** proposals whose end time passed surface as a state-driven **Needs Attention row** on the PL-100 dashboard — "{student}'s proposed session on {date} passed without approval — confirm it happened, reschedule it, or cancel it" — deep-linking the student's schedule. Chosen over auto-expiry because a proposal paused mid-change-request (the 7c flow) represents an unresolved HUMAN conversation; auto-cancelling would silently decide it, and the house rule is that money and commitments never move themselves. The row clears the moment anyone resolves the session from any path, like every dashboard condition. Verified: a past-end `proposed` session survives the sweep untouched while its `confirmed` sibling completes, and a timecard recompute over the period counts only the confirmed hour — never-approved time is no longer payable or billable.

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

## PL-121 · Webhook replay must not flip a Refunded/Completed enrollment back to Paid ✅

> **Shipped, 4/4 E2E green.** The paid flip now carries `.in('payment_status', ['Pending','Expired','Waitlisted'])`; when the guard skips an EXISTING row, replays are told apart from genuine mismatches: **Paid/Completed → quiet no-op** (logged, `replay_noop`, `paid_at` untouched — no false mismatch alarm), **Refunded → refused + admin alert** with a deep link into the payment matcher ("if this is a replay, nothing to do; if the family genuinely paid again, match it deliberately"), and a truly unmatched session still raises the existing mismatch alert. Verified: fresh Pending→Paid unchanged; same-session replay no-ops with `paid_at` identical; a Refunded row survives a replay Refunded with the alert path exercised; Completed equally protected. **One deliberate semantic note:** the admin attach-payment action re-running against an already-Paid enrollment now no-ops too (it shares this path by design) — half-failed consequence repairs converge via the hourly sweeps instead, and attaching to a Refunded row goes through the alert + deliberate-match flow rather than silently re-flipping.

`checkout-paid.ts:152-166`: the paid update has no status guard; a redelivered/dashboard-resent `checkout.session.completed` (or the admin match page re-running the path) re-marks a Refunded row Paid with a fresh `paid_at`.

**Fix:** guard the transition — `.in('payment_status',['Pending','Expired','Waitlisted'])` — and when the guard skips on a replay, log + (if the row is Refunded) fire an admin alert, since a genuine payment against a refunded enrollment is exactly the mismatch cockpit's business.
**Verify:** E2E: mark Paid → Refunded → replay the event → still Refunded, alert fired; fresh payment path unchanged.

## PL-122 · Engagement "regenerate" must respect reschedule tombstones

`app/api/admin/tutoring/engagement/route.ts:102-167`: `materializeSessions` dedupes against live rows only (`.in('status',['proposed','confirmed'])`) while the monthly cycle correctly treats `rescheduled`/`cancelled` as taken (`tutoring-billing.ts:280-285`, PL-62). `clearFutureSessions` also deletes replacement sessions and leaves `rescheduled_to_id` dangling. Regenerating after a reschedule can resurrect the original slot (re-billed, plus the late fee already charged on its tombstone) and silently delete the agreed replacement.

**Fix:** include tombstone statuses in the `taken` set; preserve replacement sessions in `clearFutureSessions` (or explicitly cascade with a notice + fee reversal — preserving is simpler and matches the monthly cycle's semantics). Repair pass for any dangling `rescheduled_to_id`.
**Verify:** E2E: reschedule → regenerate → original slot NOT recreated, replacement intact, no duplicate billing; PL-62 suite green.

## PL-123 (small) · Walkthrough sweep: labels, fallbacks, and the hard-coded name

Four small items from the July 23 stakeholder walkthrough:
- **Leads page:** the pipeline toggle still reads "Show won & lost" — finish the PL-109 rename ("Show started & closed"); grep for other won/lost stragglers in UI copy.
- **/inquire:** the "Rather just talk to a person?" block hard-codes kelsie@highergroundlearning.com — render the Manager role's contact from the role record (the PL-112 position-not-name machinery), falling back to info@ if the role record is empty.
- **/admin/view-as:** an unknown `?role=` value renders a broken empty picker (seen with `role=school`) — fall back to the parent tab or show "unknown role". And the **school-contact picker is empty** despite counselor contacts existing — either fix the query, or if school contacts genuinely have no login surface, replace the picker with "what they receive" (the rendered CD/CR/FP set) so the tab is honest.
- **View-as manager copy typo:** "billingamounts" → "billing amounts".

**Verify:** labels correct · /inquire shows the role-derived contact · bogus role param degrades gracefully · school-contact tab is functional-or-honest · typo gone.

**Batch-wide verify:** full gate battery + regress:client-imports + the money-path E2Es above run green; no template reseeds expected (PL-118's copy changes are in code composers — re-render the affected samples if their shape changes).
