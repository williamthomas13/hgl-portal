#!/usr/bin/env node
// PL-225 A + A2: publish CS_CLASS_CONFIRMED v(N+1) — Scarlett's copy edits
// from the live ISD review, applied to the CURRENT active version with
// exact-string anchor guards (never re-seed):
//   A2. subject drops " at {schoolNickname}" ({className} already carries the
//       nickname — the old subject doubled it)
//   A2. "you have a **school portal**" → "**we set up a school portal for you**"
//   A2. "no password," → "no password needed,"
//   A.  portal-paragraph trims: "(no more asking us for a count)",
//       ", your student roster", ", every past class at {schoolNickname} with
//       its results" (not true yet — restore if history is ever imported)
// Idempotent: all-applied → no new version. Refuses if any anchor is missing.
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => {
      const k = l.slice(0, l.indexOf('=')).trim(); let v = l.slice(l.indexOf('=') + 1).trim()
      if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1)
      return [k, v]
    })
)
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const KEY = 'CS_CLASS_CONFIRMED'

const EDITS = [
  {
    where: 'subject',
    from: "Everything's ready for {className} at {schoolNickname}",
    to: "Everything's ready for {className}",
  },
  {
    where: 'body',
    from: 'One more thing that makes your life easier: you have a **school portal** with Higher Ground.',
    to: 'One more thing that makes your life easier: **we set up a school portal for you** with Higher Ground.',
  },
  {
    where: 'body',
    from: 'no password, we’ll send you a login link',
    fromAlt: "no password, we'll send you a login link",
    to: null, // computed below from whichever form matched
    toTemplate: (m) => m.replace('no password,', 'no password needed,'),
  },
  {
    where: 'body',
    from: 'live enrollment for {className} (no more asking us for a count), your student roster, attendance, and diagnostic scores once the class is underway, every past class at {schoolNickname} with its results, and fresh downloads',
    to: 'live enrollment for {className}, attendance, and diagnostic scores once the class is underway, and fresh downloads',
  },
]

const { data: t } = await db
  .from('email_templates')
  .select('template_key, live, active_version_id')
  .eq('template_key', KEY)
  .single()
const { data: v } = await db
  .from('email_template_versions')
  .select('version_number, subject, preheader, body_markdown, footer_note')
  .eq('id', t.active_version_id)
  .single()

let subject = v.subject
let body = v.body_markdown
let applied = 0
let already = 0
for (const e of EDITS) {
  const target = e.where === 'subject' ? subject : body
  let from = e.from
  if (!target.includes(from) && e.fromAlt && target.includes(e.fromAlt)) from = e.fromAlt
  const to = e.toTemplate ? e.toTemplate(from) : e.to
  // Check FROM first — "already present" only counts when the source string
  // is gone (the new subject is a substring of the old one, so a to-first
  // check false-positives).
  if (!target.includes(from)) {
    const toVariants = e.toTemplate
      ? [e.from, e.fromAlt].filter(Boolean).map((f) => e.toTemplate(f))
      : [to]
    if (toVariants.some((tv) => target.includes(tv))) { already++; continue }
    console.error(`FAIL ${KEY} v${v.version_number}: anchor not found (${e.where}): "${from.slice(0, 60)}…" — the active copy has drifted; patch by hand.`)
    process.exit(1)
  }
  if (e.where === 'subject') subject = subject.replace(from, to)
  else body = body.replace(from, to)
  applied++
}

if (applied === 0) {
  console.log(`unchanged ${KEY} v${v.version_number} — all ${already} edits already present`)
  process.exit(0)
}

const nextNumber = v.version_number + 1
const { data: inserted, error: vErr } = await db
  .from('email_template_versions')
  .insert([{
    template_key: KEY,
    version_number: nextNumber,
    subject,
    preheader: v.preheader,
    body_markdown: body,
    footer_note: v.footer_note,
    notes: "PL-225 A+A2 (Scarlett, Jul 29 live review): subject de-dupe (nickname lives in {className}); 'we set up a school portal for you'; 'no password needed'; portal-list trims (count aside, roster, past-classes line — last one restorable if history imports)",
    created_by: 'claude',
  }])
  .select('id')
  .single()
if (vErr) { console.error(`FAIL version insert: ${vErr.message}`); process.exit(1) }
const { error: pErr } = await db
  .from('email_templates')
  .update({ active_version_id: inserted.id, updated_at: new Date().toISOString() })
  .eq('template_key', KEY)
if (pErr) { console.error(`FAIL repoint: ${pErr.message}`); process.exit(1) }
console.log(`published ${KEY} v${nextNumber} (live=${t.live}) — ${applied} edits applied${already ? `, ${already} were already present` : ''}`)
