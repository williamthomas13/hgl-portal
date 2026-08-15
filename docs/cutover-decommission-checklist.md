# Cutover & decommission checklist (PL-363, recorded Aug 15 2026)

Sequenced per the phased-launch note: **classes go live first** (phase 1); 1-on-1 tutoring
cuts over separately (phase 2). Resend paid is blocking for whichever phase sends real
email first (classes).

## Phase 1 — classes cutover

1. **Resend paid plan** — before any real class email (one registration wave exceeds the
   100/day free tier).
2. **DNS cutover** (the batch-36 7-step runbook) after Scarlett's walkthrough clears.
3. **Mid-flight class imports** — per class, in any order (idempotent):
   ```
   node scripts/import-class-registrations.mjs --class <slug> --csv <export.csv> \
     --mapping <mapping.json> --baseline <baseline.json> --by scarlett@highergroundlearning.com
   ```
   - `baseline.json` = the schedule those families were SHOWN when they registered
     (staff supplies it per class — the schedule-change baseline rule depends on it).
     Only when the schedule genuinely hasn't changed since: `--baseline-current`.
   - Two FULL classes starting next month: import with the paid column (or `--all-paid`);
     waitlists come over via a waitlist column.
   - Two TAKING-REGISTRATIONS classes: import whatever the Sheets/MailerLite export
     holds at cutover (paid + pending mixed).
   - **Imports fire NO emails** — confirmations and every already-due sequence step are
     claimed; future lifecycle steps (T-minus reminders etc.) fire from their natural
     next point. Imported Paid rows are NOT posted to QBO (the old system already
     booked that revenue). Imported Pendings are exempt from the automatic reminder
     ladder/expiry — they surface on Needs Attention with a send-payment-link action.
4. **Registration handoff for the two accruing classes:** repoint their MailerLite
   forms / Squarespace buttons at the portal registration links (`hgl.co` shortcodes),
   then run the SAME import once more as the final sweep — anyone who registered in the
   gap comes over; dedupe by student+class makes the double-import harmless.
5. Verify each imported roster (counts vs the sheet; spot-check a family portal login).

## Phase 2 — tutoring cutover (later, separate)

6. **QBO family import** (`scripts/import-qbo-families.mjs`, the PL-34 importer).
7. Monthly generation, autopay ramp, tutoring templates per the existing plan.

## Launch tail — AFTER 1–2 stable cycles (not at cutover)

8. **MailerLite decommission:**
   - Export ALL lists + consent history (keep the archive).
   - Export the UNSUBSCRIBES and land them in portal suppression **before any portal
     campaign sends**: `node scripts/import-mailerlite-suppressions.mjs --csv unsubscribed.csv`
     (feeds the `marketing_suppressions` gate inside `sendOnce` — the PL-201 choke point).
   - Replace remaining Squarespace signup forms with portal-leads capture.
   - Close the MailerLite account.
9. **Squarespace: DOWNGRADE from Commerce to a site-only plan — do NOT cancel** (the
   brand site stays). Export order history first. Gate: the PL-364 Printful add-on flow
   has round-tripped one real order in sandbox/test mode (notebooks are the last thing
   Commerce still does).
10. **Zapier** per the existing plan.
11. Rich-results tester pass on /c pages + /team (PL-359 launch-tail item).
