#!/usr/bin/env node
// Batch 26 template versions, all by anchor-guarded patch of the CURRENT
// active body (never re-seeded; idempotent both ways; hard-fail on drift):
//   PL-269 — CS_CLASS_CONFIRMED + CS_COLLATERAL_FOLLOWUP: "Best," → "Thanks!"
//            (CS_CLASS_CONFIRMED additionally re-asserts the PL-237
//            no-collateral strip anchors before publishing)
//   PL-265 — CD_COUNSELOR_DIGEST: pluralized class noun via the new
//            {digestClassNoun} variable + three copy edits/deletions
//            (the materials sentence lives in the composed
//            {digestClassListBlock} — fixed in the composer, not here)
//   PL-264 — AL_MISSING_DETAILS: tense-aware subject via the new
//            {classDetailsSendPhrase} variable
// Code twins + seed mirror updated in the same commit.
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

// PL-237 fail-closed strip anchors — must survive in CS_CLASS_CONFIRMED.
const STRIP_ANCHORS = [
  " I've attached the materials for you:",
  '- A **letter** meant to be shared with parents',
  '- A **flyer** meant for students',
]

const PLANS = [
  {
    key: 'CS_CLASS_CONFIRMED',
    notes: 'PL-269 (Scarlett, Aug 3): signoff "Best," → "Thanks!" — matches the letter valediction (PL-244)',
    assertAnchors: STRIP_ANCHORS,
    edits: [{ where: 'body', from: 'Best,\n\nWilliam Thomas', to: 'Thanks!\n\nWilliam Thomas' }],
  },
  {
    key: 'CS_COLLATERAL_FOLLOWUP',
    notes: 'PL-269 (Scarlett, Aug 3): signoff "Best," → "Thanks!" — matches the letter valediction (PL-244)',
    edits: [{ where: 'body', from: 'Best,\n\nWilliam Thomas', to: 'Thanks!\n\nWilliam Thomas' }],
  },
  {
    key: 'CD_COUNSELOR_DIGEST',
    notes: 'PL-265 (Scarlett, Aug 1): class-count agreement via {digestClassNoun}; portal-signin and reply-to lines dropped; fence-sitter line softened',
    edits: [
      {
        where: 'body',
        from: "Here's where enrollment stands for the upcoming Higher Ground Learning classes at {schoolName}",
        to: "Here's where enrollment stands for the upcoming Higher Ground Learning {digestClassNoun} at {schoolName}",
      },
      {
        where: 'body',
        from: '\n\nSee live counts and scores any time — sign in at [{portalLink}]({portalLink}) with this email.',
        to: '',
        deletion: true,
      },
      {
        where: 'body',
        from: 'Know a student who\'s still on the fence? Forwarding them (or their parents) the registration link is the single most helpful thing you can do — everything after the click is automatic.',
        to: 'If you know a student who\'s still on the fence, forwarding them (or their parents) the registration link is the single most helpful thing you can do.',
      },
      {
        where: 'body',
        from: '\n\nQuestions about any student or class? Just reply to this email.',
        to: '',
        deletion: true,
      },
    ],
  },
  {
    key: 'T5_TIMECARD_READY',
    notes: 'PL-261: no more "ran a different length" — sessions bill and pay at scheduled duration',
    edits: [
      {
        where: 'body',
        from: 'correct any exception (a no-show, a session that ran a different length), and hit',
        to: 'correct any exception (a no-show), and hit',
      },
    ],
  },
  {
    key: 'AL_MISSING_DETAILS',
    notes: 'PL-264: subject goes tense-aware — {classDetailsSendPhrase} says "goes out {date}" before the date, "is overdue" after',
    edits: [
      {
        where: 'subject',
        from: 'goes out {classDetailsSendDate}',
        to: '{classDetailsSendPhrase}',
      },
    ],
  },
]

for (const plan of PLANS) {
  const { data: t } = await db
    .from('email_templates')
    .select('template_key, live, active_version_id')
    .eq('template_key', plan.key)
    .maybeSingle()
  if (!t) {
    console.log(`skip ${plan.key} — no template row in this environment (code twin carries the copy)`)
    continue
  }
  const { data: v } = await db
    .from('email_template_versions')
    .select('version_number, subject, preheader, body_markdown, footer_note')
    .eq('id', t.active_version_id)
    .single()

  let body = v.body_markdown
  let subject = v.subject
  let applied = 0
  let already = 0
  let failed = false
  for (const e of plan.edits) {
    const target = e.where === 'subject' ? subject : body
    if (target.includes(e.from)) {
      if (e.where === 'subject') subject = subject.replace(e.from, e.to)
      else body = body.replace(e.from, e.to)
      applied++
    } else if (!e.deletion && target.includes(e.to)) {
      already++
    } else if (e.deletion && !target.includes(e.from.trim())) {
      already++ // deletion target already gone (loose check without the \n\n prefix)
    } else {
      console.error(`FAIL ${plan.key} v${v.version_number} (${e.where}): anchor not found: "${e.from.slice(0, 60).replace(/\n/g, '\\n')}…" — the active copy has drifted; patch by hand.`)
      failed = true
    }
  }
  if (failed) process.exit(1)
  for (const anchor of plan.assertAnchors ?? []) {
    if (!body.includes(anchor)) {
      console.error(`FAIL ${plan.key}: a PL-237 strip anchor is missing from the new body — the no-collateral send would fail closed. Not publishing.`)
      process.exit(1)
    }
  }
  if (applied === 0) {
    console.log(`unchanged ${plan.key} v${v.version_number} — all ${already} edits already present`)
    continue
  }
  const nextNumber = v.version_number + 1
  const { data: inserted, error: vErr } = await db
    .from('email_template_versions')
    .insert([{
      template_key: plan.key,
      version_number: nextNumber,
      subject,
      preheader: v.preheader,
      body_markdown: body,
      footer_note: v.footer_note,
      notes: plan.notes,
      created_by: 'claude',
    }])
    .select('id')
    .single()
  if (vErr) { console.error(`FAIL ${plan.key} version insert: ${vErr.message}`); process.exit(1) }
  const { error: pErr } = await db
    .from('email_templates')
    .update({ active_version_id: inserted.id, updated_at: new Date().toISOString() })
    .eq('template_key', plan.key)
  if (pErr) { console.error(`FAIL ${plan.key} repoint: ${pErr.message}`); process.exit(1) }
  console.log(`published ${plan.key} v${nextNumber} (live=${t.live}) — ${applied} edit${applied === 1 ? '' : 's'}${already ? `, ${already} already present` : ''}`)
}
