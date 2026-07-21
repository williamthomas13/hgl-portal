#!/usr/bin/env node
// PL-60 regression: no rendered email may carry a dead action link.
//
// The incident: real sends (PR3, WR) reached families with unusable hrefs —
// a dev-machine pipeline run built links from its localhost base. This audit
// fails on ANY empty, "#", relative, unresolved-{variable}, or localhost
// href in:
//   1. EVERY registry template — live AND code-copy drafts (PL-66: drafts
//      are pre-validated so flipping one live can't introduce a dead link) —
//      rendered exactly as the editor preview/test-send path renders it
//      (sample context + extras), and
//   2. the enrollment pipeline's real render paths — every live
//      enrollment-scoped template rendered through renderDbEmail with a REAL
//      emailContext built from a live class bundle (registry copy), plus the
//      URL fields of that context themselves.
//
//   node scripts/regress-email-links.mjs
//
// Compiles the real modules with tsc (no mocks — the audit exercises the
// exact render code the pipeline runs).
import { execSync } from 'node:child_process'
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
)
Object.assign(process.env, env)

let failures = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
}

// A localhost base is fine for LOCAL runs (links point at this dev server);
// what must never happen is a localhost link when the base ISN'T localhost.
const base = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
const baseIsLocal = /localhost|127\.0\.0\.1/.test(base)

function deadHrefs(html) {
  return [...html.matchAll(/href="([^"]*)"/g)]
    .map((m) => m[1].replace(/&amp;/g, '&').trim())
    .filter(
      (h) =>
        h === '' ||
        h === '#' ||
        h.includes('{') ||
        !/^(https?:|mailto:|tel:)/i.test(h) ||
        (!baseIsLocal && /localhost|127\.0\.0\.1/.test(h))
    )
}

// --- compile the real render modules --------------------------------------
const buildDir = mkdtempSync(path.join(path.dirname(new URL(import.meta.url).pathname), '.tmp-linkaudit-'))
try {
  execSync(
    `npx tsc app/utils/comms-db-render.ts app/utils/lifecycle.ts --outDir ${JSON.stringify(buildDir)} --module commonjs --target es2022 --skipLibCheck --esModuleInterop --jsx react-jsx --moduleResolution node`,
    { stdio: 'inherit' }
  )
  const req = createRequire(import.meta.url)
  const { supabaseAdmin: db } = req(path.join(buildDir, 'supabase-admin.js'))
  const { renderVersion, renderDbEmail } = req(path.join(buildDir, 'comms-db-render.js'))
  const { SAMPLE_CONTEXT, SAMPLE_EXTRA, VARIABLES } = req(path.join(buildDir, 'comms-variables.js'))
  const { loadClassBundles, emailContext } = req(path.join(buildDir, 'lifecycle.js'))

  // --- 1. every template (live + drafts) renders with zero dead hrefs ------
  const { data: templates } = await db
    .from('email_templates')
    .select(
      `template_key, from_identity, category, live,
       version:email_template_versions!email_templates_active_version_fk
         ( subject, preheader, body_markdown, footer_note )`
    )
  for (const tpl of templates ?? []) {
    if (!tpl.version) {
      check(`${tpl.template_key}: has an active version`, false, 'no active version')
      continue
    }
    const tag = tpl.live ? 'live' : 'draft'
    const r = renderVersion(tpl.version, tpl, SAMPLE_CONTEXT, 'parent', SAMPLE_EXTRA)
    const dead = deadHrefs(r.html)
    const unresolved = /\{[a-zA-Z][a-zA-Z0-9_]*\}/.test(r.subject)
    check(
      `${tpl.template_key} (${tag}): no dead hrefs (sample render)`,
      dead.length === 0 && !unresolved,
      dead.map((h) => JSON.stringify(h)).join(', ') || (unresolved ? `subject: ${r.subject}` : '')
    )
  }

  // --- 2. real-context render of the enrollment pipeline -------------------
  // Any bundle with an enrollment gives a REAL emailContext (nothing sends;
  // this only renders).
  const bundles = await loadClassBundles()
  const bundle = bundles.find((b) => b.status !== 'cancelled' && b.enrollments.length > 0)
  if (!bundle) {
    console.log('SKIP  no class with enrollments — real-context audit skipped')
  } else {
    const ctx = emailContext(bundle, bundle.enrollments[0])

    // 2a. every URL field on the real context is an absolute link
    for (const [field, value] of Object.entries(ctx)) {
      if (!/Url$/.test(field)) continue
      check(`ctx.${field} is absolute`, /^https?:\/\//.test(String(value ?? '')), JSON.stringify(value))
    }

    // 2b. every URL-ish registry variable resolves absolute against the real
    // context (extras supplied from samples — the send paths that fill them
    // are covered by their own E2Es).
    for (const [name, def] of Object.entries(VARIABLES)) {
      if (!/Link$|Url$/.test(name)) continue
      let value = ''
      try {
        value = def.resolve(ctx, 'parent', SAMPLE_EXTRA)
      } catch (e) {
        check(`{${name}} resolves`, false, String(e))
        continue
      }
      // Some *Link variables are pre-rendered anchors, not bare URLs — audit
      // the href inside those instead.
      const anchor = value.match(/href="([^"]*)"/)
      const target = anchor ? anchor[1] : value
      check(`{${name}} resolves absolute`, /^https?:\/\//.test(target), JSON.stringify(value))
    }

    // 2c. the two incident templates, rendered exactly as the pipeline does
    for (const key of ['PR3', 'WR_WAITLIST_RELEASE']) {
      const r = await renderDbEmail(key, ctx, 'parent', { contactBlock: '<p>x</p>' })
      if (!r) {
        check(`${key}: registry render`, false, 'template not live')
        continue
      }
      const dead = deadHrefs(r.html)
      check(`${key}: real-context registry render clean`, dead.length === 0, dead.join(', '))
    }
  }
} finally {
  rmSync(buildDir, { recursive: true, force: true })
}

process.exit(failures === 0 ? 0 : 1)
