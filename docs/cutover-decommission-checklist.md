# Cutover & decommission checklist (PL-363, recorded Aug 15 2026)

Sequenced per the phased-launch note: **classes go live first** (phase 1); 1-on-1 tutoring
cuts over separately (phase 2). Resend paid is blocking for whichever phase sends real
email first (classes).

## Phase 1 — classes cutover

1. **Resend paid plan** — before any real class email (one registration wave exceeds the
   100/day free tier).
2. ~~**hgl.co legacy forwards inventory**~~ **RETIRED (PL-448, Sep 1):** the registrar's
   real setup turned out to be ONE wildcard — hgl.co/{anything} forwards to
   highergroundlearning.com/{anything} — and the portal now replicates exactly that: any
   hgl.co path that isn't a known code (or a deliberate override) 301s to the same path on
   the main site, forever. **No per-path inventory exists to migrate, so there is nothing
   for Scarlett to inventory — the step is gone.** The "Legacy hgl.co forwards" panel
   section survives only for OVERRIDES (a path that must go somewhere *different* than its
   same-named main-site page); the /act row was retired as redundant (the wildcard covers
   it identically). Resolution order: reserved portal routes → evergreen codes → legacy
   overrides → wildcard 301.
   **PL-384 note (unchanged):** the printed class codes (isd, mis, nido, sls) need NO
   registrar action and NO reprinting — they are their schools' evergreen codes now; the
   portal serves each code's newest open class right at hgl.co/{code} (interest page
   between classes), with registration at hgl.co/{code}/register. Click history carried
   over unchanged.
3. **DNS cutover** (the batch-36 7-step runbook) after Scarlett's walkthrough clears.
   - **PL-410 post-DNS: re-verify Google Calendar push channels.** Google stores the
     webhook URL *inside* each channel, so channels registered pre-cutover keep
     pointing at the old host. Once `PRODUCTION_BASE_URL` flips, the hourly sweep
     re-registers every channel against the new domain automatically (it compares
     each row's stored `webhook_url`); within the hour, spot-check
     `gcal_watch_channels` rows show the new domain AND hand-move one QA event —
     the drift banner should appear within ~1 minute.
4. **Mid-flight class imports** — per class, in any order (idempotent):
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
5. **Registration handoff for the two accruing classes:** repoint their MailerLite
   forms / Squarespace buttons at the permanent registration links
   (`hgl.co/{code}/register` — the PL-384 evergreen codes, never per-class links),
   then run the SAME import once more as the final sweep — anyone who registered in the
   gap comes over; dedupe by student+class makes the double-import harmless.
6. Verify each imported roster (counts vs the sheet; spot-check a family portal login).

## Phase 2 — tutoring cutover (later, separate)

7. **QBO family import** (`scripts/import-qbo-families.mjs`, the PL-34 importer).
8. Monthly generation, autopay ramp, tutoring templates per the existing plan.

## Launch tail — AFTER 1–2 stable cycles (not at cutover)

9. **Squarespace "Classes" nav → the portal's /classes browse page** (PL-378 A) — repoint
   the nav link at cutover; the sqsp classes grid is replaced by the portal page.
9b. **Homepage "Upcoming classes" strip → the portal embed (PL-385).** Paste this ONCE
   into a Squarespace CODE block where the manual strip lives (then never edit it again —
   every future change ships portal-side):
   ```html
   <div id="hgl-upcoming-classes">
     <noscript><a href="https://hgl-portal.vercel.app/classes">See upcoming classes →</a></noscript>
   </div>
   <script src="https://hgl-portal.vercel.app/embed/upcoming-classes.js" defer></script>
   ```
   (After the domain cutover the two URLs become the portal's final domain — re-paste once
   then, or paste with the final domain at cutover time.) The strip auto-reflects classes
   opening/closing; when nothing is open it renders a modest "join the interest list" line
   pointing at /classes — never an empty hole. Preview any time at
   https://hgl-portal.vercel.app/sqsp-embed-test.html (the none-open state:
   /embed/upcoming-classes.js?preview=empty). Script blocked → the noscript "See upcoming
   classes →" link still shows.
10. **MailerLite decommission:**
   - Export ALL lists + consent history (keep the archive).
   - Export the UNSUBSCRIBES and land them in portal suppression **before any portal
     campaign sends**: `node scripts/import-mailerlite-suppressions.mjs --csv unsubscribed.csv`
     (feeds the `marketing_suppressions` gate inside `sendOnce` — the PL-201 choke point).
   - Replace remaining Squarespace signup forms with portal-leads capture.
   - Close the MailerLite account.
11. **Squarespace: DOWNGRADE from Commerce to a site-only plan — do NOT cancel** (the
   brand site stays). Export order history first. Gate: the PL-364 Printful add-on flow
   has round-tripped one real order in sandbox/test mode (notebooks are the last thing
   Commerce still does).
   **PL-385 gate on the downgrade target:** the chosen plan must still allow CODE/EMBED
   blocks (Squarespace Business tier or equivalent — record the chosen plan here when
   decided: ______). If Scarlett lands on a plan without embeds, the honest fallback is a
   plain "See upcoming classes →" button to /classes — note it on the homepage, don't fake
   a strip.
12. **Zapier** per the existing plan.
13. Rich-results tester pass on /c pages + /team (PL-359 launch-tail item).
