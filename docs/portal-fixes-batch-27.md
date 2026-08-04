# Portal fixes — batch 27 (BOTH SHIPPED Aug 3 — SSO awaits Scarlett's 30-minute dashboard step to switch on)

**Batch closed and handed off Aug 3, 2026.** Two items: PL-270 (FP counselor final-days rewrite, exact copy) and PL-272 (staff Google Workspace SSO — Option B, approved by Scarlett). Note: the flyer-burst rendering bug flaged during batch 26 was already fixed separately — no PL here.

**Standing rules:** plain-English statuses · no internal shorthand · every alert deep-links its record · samples from composers · `git push` after committing · PL-x IDs in commits · check items off here when shipped · registry template edits ship as new versions with matching code twins (never drift) · verify composed blocks via the composer path, not editor samples · inline confirm banners only.

---

## PL-270 — FP counselor final-days push: full body rewrite (reported Aug 3 — exact copy, from the live "3 days left to register for SLS SAT Prep" send)

The counselor reminder email ("{N} days left to register for {className}" — the FP — Final-days push (counselor) template) gets this body, replacing the current one. Dynamic bits stay dynamic: counselor first name, days-left count, spots-open count, class name, registration link, enrolled count, class minimum.

> Hi {counselorFirstName},
>
> Quick heads-up: registration for the {className} class closes soon ({daysLeft} days left), and there are still {spotsOpen} spots open.
>
> This is the window where a nudge from the school makes the difference — parents who've been meaning to register usually just need one reminder, and one from you carries real weight.
>
> Here's the link, ready to forward:
>
> {registrationLink}
>
> Current count: {enrolledCount} students enrolled. The course requires a minimum of {minStudents} students to run. After the minimum is reached, late registrations may still be possible while spots remain.
>
> Thanks for the assist!
> Higher Ground Learning

Notes: Scarlett's draft used {0} and {min} for the last-paragraph counts — map to whatever the real composer variables are (shown above as {enrolledCount}/{minStudents}); same for the other placeholders. "{daysLeft} days" should degrade sensibly at 1 ("1 day left"). New version via anchor-guard + code twin as applicable; verify via composer path.

✅ **Shipped Aug 3 — FP_DEADLINE_PUSH v2 live.** Variable mapping: "{daysLeft} days left" → the existing `{deadlineCountdown}` (which degrades even better than asked — "3 days left" and "Last day" on the final day); "{spotsOpen} spots" → the existing `{spotsLeftPhrase}` ("3 spots"/"1 spot"); the last paragraph uses two NEW plural-safe variables — `{enrolledCountPhrase}` ("7 students"/"1 student") and `{minStudentsPhrase}` ("3 students"; the minimum is always a sane number ≥1 thanks to the PL-61 fallback, so the sentence never dangles). Body is otherwise your copy verbatim, including the softer close (the old "class calendar and materials go out on schedule" tail is gone). Publish was a guarded full-body replace — it refuses unless six distinctive phrases of the expected current body are all present (never clobbers unseen edits) — and idempotent. Code twin + seed mirror in lockstep. Verified through the composer path with the sample context: subject "3 days left to register for SIS SAT Prep", body renders "closes soon (3 days left), and there are still 3 spots open" and "Current count: 12 students enrolled. The course requires a minimum of 8 students to run." — zero unknown variables.

## PL-272 — Staff sign-in via Google Workspace SSO (Option B — approved by Scarlett Aug 3)

Implement the recommended Option B from the PL-255 feasibility report: Google Workspace SSO for staff roles (admin, manager, tutor). Families and counselors stay magic-link only. Scope per the report: ~1 day of code plus the ~30-minute GCP/Supabase dashboard task — write Scarlett clear step-by-step instructions for her dashboard part and tell her exactly when in the sequence it's needed. Workspace offboarding must terminate portal access (that's the point). Keep the existing "Staff sign-in with password" toggle path coherent with whatever ships (rename/repurpose to "Staff sign-in with Google" as appropriate). Update the sign-in help copy (PL-256 shipped text) if it references how staff sign in.

✅ **Shipped Aug 3 — all code live and deployed; the button politely says "not switched on yet" until you finish the dashboard step below (do it any time, nothing breaks before or after).**

What shipped: the login page's staff toggle is now **"Staff sign-in (Google or password)"** — inside, a primary **Sign in with Google** button (with "use your @highergroundlearning.com Google account" under it) and the existing password form kept below as the fallback. The button pre-checks whether Google sign-in is switched on and shows a plain-English message instead of stranding anyone on a raw error page. The new `/auth/callback` completes the sign-in and then runs THE gate server-side: the Google account must be **@highergroundlearning.com** AND match an **active instructors record or an admin/manager profile** — anyone else (personal Gmail, ex-employee, Workspace account with no portal record) is signed straight back out to /login with a clear message. Admin/manager land on /admin, tutors on /portal (Teaching). Families and counselors are untouched — magic-link remains their only path, and the PL-256 help text was checked: it already says "staff account" without naming a method, so it stands.

On offboarding (the point): removing someone's Workspace account blocks every future Google sign-in — they cannot complete the flow. Any already-open session dies the way it always has: every staff/instructor surface re-checks `instructors.active` / `profiles.role` per request, so the Team access "active" toggle remains the immediate kill switch. Use both when someone leaves: Workspace removal + flip them inactive.

**📋 Scarlett — your one-time setup (~30 min, whenever suits; the button works the moment you finish):**
1. **Google Cloud console** (console.cloud.google.com, signed in as billy@ or any Workspace admin): create/pick a project → "APIs & Services" → "OAuth consent screen" → User type **Internal** (this alone limits sign-in to your Workspace) → app name "HGL Portal", your email for contacts → save.
2. Still in "APIs & Services" → "Credentials" → "Create credentials" → **OAuth client ID** → type **Web application** → name "HGL Portal" → under **Authorized redirect URIs** add exactly: `https://neeabtwvszbhmkatrfol.supabase.co/auth/v1/callback` → Create → copy the **Client ID** and **Client secret** it shows you.
3. **Supabase dashboard** (supabase.com, the hgl project) → Authentication → Sign In / Providers → **Google** → toggle it on → paste the Client ID and Client secret → Save.
4. Same Authentication area → **URL Configuration** → make sure the **Redirect URLs** allow-list contains `https://hgl-portal.vercel.app/auth/callback` (add `http://localhost:3000/auth/callback` too so dev keeps working).
5. **Test**: open hgl-portal.vercel.app/login → "Staff sign-in (Google or password)" → "Sign in with Google" → pick your @highergroundlearning.com account → you should land on /admin. If a personal Gmail tries it, it gets bounced with a message — that's the gate working.

Verified now (everything testable before your step): the button renders and correctly reports "not switched on yet" against the real Supabase project; the OAuth handoff carries the right parameters (Workspace-only hint + PKCE + our callback); a broken/forged callback bounces to /login with "Google sign-in didn't complete", the staff panel reopened, and the intended destination preserved. The only untestable-before-setup part is Google's own consent screen — step 5 covers it, and I'll re-verify end-to-end in the batch after you flip it on if you'd like.
