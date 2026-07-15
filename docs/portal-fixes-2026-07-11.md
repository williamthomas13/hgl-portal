# Portal fixes — July 11, 2026 (from live smoke test)

Two items found while testing production (hgl-portal.vercel.app). No other issues; comms dashboard, templates, calendar pages, closed-registration state, add-on step, and class lifecycle all verified working.

## 1. Bad-slug registration page hangs (pre-launch fix)

**Repro:** visit `/register/definitely-not-a-real-slug`.
**Expected (master spec §12):** friendly 404 — "class not found" message + link to https://www.highergroundlearning.com.
**Actual:** page renders "Loading class details..." indefinitely, and the tab eventually becomes unresponsive — likely an unhandled error path that keeps retrying the fetch in a tight loop.
**Note:** the API itself behaves correctly — `GET /api/class-info/definitely-not-a-real-slug` returns `{"error":"Class not found."}`. The bug is entirely in the register page's client-side handling of that error response.
**Fix:** handle the not-found (and any non-2xx) response by rendering the spec'd friendly 404 state; make sure there is no unbounded retry. Add a test for the bad-slug path. Check the same error handling on the calendar landing page (`/classes/.../calendar` route) while there, since it fetches the same class data.

**Why pre-launch:** every mistyped or stale hgl.co short link lands here.

## 2. Parent portal: verify enrollment dedupe (check, not necessarily a bug)

**Observed:** signed in and viewing `/portal` (parent view), the same student appeared as two separate identical cards ("Desmond Roman" twice, same class, same status). Known to be duplicate *test data* — but verify the view behaves sanely when duplicates exist:

- If the same student legitimately has multiple enrollments, they should render as **one student card with multiple class rows**, not repeated student cards.
- Check whether the duplication came from duplicate student rows (data) or from the query joining/fanning out (code). If a parent can end up with duplicate student records through any real flow (e.g. registering twice with the same student name), consider deduping on render and flagging for admin.
- Cosmetic, same view: the subtitle under each student name renders as a bare "—" when school/grade is missing — hide the line instead of showing a dash.

No schema changes expected; this is a render/query check with a small fix if the fan-out is real.
