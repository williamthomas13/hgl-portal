<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Workflow rules (Scarlett, July 2026)

- **Always `git push` to origin after committing.** Vercel deploys production from GitHub `main` — unpushed commits mean prod silently runs stale code (this happened July 17: four verified commits sat local-only and every prod check ran against the old build). End every working session with a push, and confirm the push succeeded.
- If a change needs DB writes you can't perform (migrations, data fixes), say so explicitly at handoff and leave an idempotent migration file plus, if needed, a one-time script — Scarlett or her review assistant applies them via the Supabase dashboard.
- Keep punch-list IDs (PL-x) from `docs/portal-fixes-*.md` in commit messages, and check items off in the doc when they ship.
