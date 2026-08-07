#!/usr/bin/env node
// PL-274 amendments B/C/F: the family sequence's diagnostic/Synap/location
// copy becomes switch-aware via composed variables that resolve from the
// enrollment context (no extras plumbing — every send path conditions
// identically). Anchor-guarded patches of the CURRENT active bodies;
// idempotent; refuses on drift. Seed mirror + code twins ride the commit.
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

const PLANS = [
  {
    key: 'E0_CONFIRM_PARENT',
    notes: 'PL-274B: diagnostic promise conditions on the class has_diagnostics switch',
    edits: [{
      from: 'This includes diagnostic test information, instructor information, and {classLocationPhrase}.',
      to: 'This includes {e0IncludesPhrase}.',
    }],
  },
  {
    key: 'E0_CONFIRM_STUDENT',
    notes: 'PL-274B: diagnostic promise + due-date aside condition on has_diagnostics',
    edits: [
      {
        from: 'such as {classLocationPhrase} and information to access your initial diagnostic test.',
        to: 'such as {e0StudentIncludesPhrase}.',
      },
      {
        from: '(By the way, that test is due {diagnosticDueDate}!)',
        to: '{diagnosticDueLine}',
      },
    ],
  },
  {
    key: 'E1_THANKS',
    notes: 'PL-274B: course-information list conditions on has_diagnostics',
    edits: [{
      from: 'such as {classLocationPhrase} and diagnostic test access.',
      to: 'such as {e1IncludesPhrase}.',
    }],
  },
  {
    key: 'E3_VFAQ',
    notes: 'PL-274C: location answer states the KNOWN location (open classes know it at creation); diagnostic Q&A conditions on has_diagnostics',
    edits: [
      {
        from: `**What's the exact location for the class?**
We don't have that information confirmed just yet, but we'll write you again when we know!`,
        to: '{vfaqLocationAnswer}',
      },
      {
        from: `**What if I didn't get the diagnostic test information?**
No problem — you can get to it right here: [button:Take the diagnostic test]({synapGroupLink}). It's due {diagnosticDueDate}, the day before your first class. (It also went to your inbox, so it's worth a search of your spam folder for next time.)`,
        to: '{vfaqDiagnosticQa}',
      },
    ],
  },
  {
    key: 'E4_CLASS_DETAILS',
    notes: 'PL-274B/F: diagnostic P.S. conditions on the switch; open online classes state the meeting link; {instructorBio} paragraph (empty drops cleanly)',
    edits: [{
      from: `P.S. If {you_havent_or_name_hasnt} found a moment to take the diagnostic test yet, {you_or_they} can still do so by clicking below. If {you_have_or_they_have} already completed the test, no need to let us know. We surely have it.

[button:Access Diagnostic Tests]({synapGroupLink})`,
      to: `{openClassMeetingBlock}

{instructorBioBlock}

{diagnosticPsE4Block}`,
    }],
  },
  {
    key: 'E5_LOCATION',
    notes: 'PL-274B/F: diagnostic P.S. conditions on the switch; open online classes state the meeting link',
    edits: [{
      from: "P.S. If {you_still_havent_or_name_still_hasnt} taken the first diagnostic test, don't worry. It's still available [here]({synapGroupLink}).",
      to: `{openClassMeetingBlock}

{diagnosticPsE5Block}`,
    }],
  },
]

for (const plan of PLANS) {
  const { data: t } = await db
    .from('email_templates')
    .select('template_key, live, active_version_id')
    .eq('template_key', plan.key)
    .maybeSingle()
  if (!t) { console.log(`skip ${plan.key} — no template row`); continue }
  const { data: v } = await db
    .from('email_template_versions')
    .select('version_number, subject, preheader, body_markdown, footer_note')
    .eq('id', t.active_version_id)
    .single()

  let body = v.body_markdown
  let applied = 0
  let already = 0
  let failed = false
  for (const e of plan.edits) {
    if (body.includes(e.from)) {
      body = body.replace(e.from, e.to)
      applied++
    } else if (body.includes(e.to)) {
      already++
    } else {
      console.error(`FAIL ${plan.key} v${v.version_number}: anchor not found: "${e.from.slice(0, 55).replace(/\n/g, '\\n')}…" — patch by hand.`)
      failed = true
    }
  }
  if (failed) process.exit(1)
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
      subject: v.subject,
      preheader: v.preheader,
      body_markdown: body,
      footer_note: v.footer_note,
      notes: plan.notes,
      created_by: 'claude',
    }])
    .select('id')
    .single()
  if (vErr) { console.error(`FAIL ${plan.key} insert: ${vErr.message}`); process.exit(1) }
  const { error: pErr } = await db
    .from('email_templates')
    .update({ active_version_id: inserted.id, updated_at: new Date().toISOString() })
    .eq('template_key', plan.key)
  if (pErr) { console.error(`FAIL ${plan.key} repoint: ${pErr.message}`); process.exit(1) }
  console.log(`published ${plan.key} v${nextNumber} (live=${t.live}) — ${applied} edit${applied === 1 ? '' : 's'}`)
}
