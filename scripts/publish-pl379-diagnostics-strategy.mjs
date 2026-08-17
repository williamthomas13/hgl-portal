#!/usr/bin/env node
// PL-379: diagnostics/strategy-session copy conditions on the same class
// facts as the /c pages (PL-369) — publish new versions of the CURRENT
// active bodies with exact-string guards (refuse if an anchor is missing —
// Scarlett's edits win):
//   E0_CONFIRM_PARENT   portal-contents clause → {portalScoresClause}
//   E0_CONFIRM_STUDENT  Compass strategy bullet → - {compassStrategyItem}
//   E1_THANKS           Compass strategy bullet → - {compassStrategyItem}
//   E3_VFAQ             hand-written strategy Q&A → {vfaqStrategyQa}
//   LR_WELCOME          diagnostic section → {lrDiagnosticSection} + clean
//                       renumbering ({lrWhenNumber}/{lrKnowNumber}) + FAQ
//                       topics phrase → {lrFaqTopicsPhrase}
//   W2_SPOT_OPEN        recap promise → {e1IncludesPhrase}
//   CS_CLASS_CONFIRMED  counselor portal phrase → {csPortalContentsPhrase}
// Idempotent: a body already carrying the target token is skipped.
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

const EDITS = [
  {
    key: 'E0_CONFIRM_PARENT',
    doneToken: '{portalScoresClause}',
    replacements: [[
      "your receipts, diagnostic scores once they're in, a calendar feed",
      'your receipts{portalScoresClause}, a calendar feed',
    ]],
  },
  {
    key: 'E0_CONFIRM_STUDENT',
    doneToken: '{compassStrategyItem}',
    replacements: [[
      '- How to best take advantage of your free 30-minute strategy session,',
      '- {compassStrategyItem}',
    ]],
  },
  {
    key: 'E1_THANKS',
    doneToken: '{compassStrategyItem}',
    replacements: [[
      '- How to best take advantage of the free 30-minute strategy session,',
      '- {compassStrategyItem}',
    ]],
  },
  {
    key: 'E3_VFAQ',
    doneToken: '{vfaqStrategyQa}',
    replacements: [[
      `**What is the 30-minute strategy session? And when can I schedule it?**
Each student receives one strategy session with enrollment, during which the instructor will help you craft an individualized study and review plan, build a perfect test-day mindset, understand your diagnostic score report, or go over day-of test strategies.

The strategy sessions usually work best when they're done after the first week of classes, at the earliest. During the first class sessions, you can approach the instructor directly to find and schedule a time during the following week that's mutually agreeable. If you'd like to or need to do the strategy session earlier, however, just let us know and we can try to arrange it.`,
      '{vfaqStrategyQa}',
    ]],
  },
  {
    key: 'LR_WELCOME',
    doneToken: '{lrDiagnosticSection}',
    replacements: [
      [
        `**1. The diagnostic test — this one's time-sensitive.**
{Your_or_names} first diagnostic test is ready now. It's in two parts (Reading & Writing, then Math), best done back-to-back in one sitting. The instructor uses the results to shape the course, so {you_or_name} should complete it **before the first class** if at all possible.

To get {you_or_name} in: click below, hit "register," and provide some quick basic info{together_or_blank}.

[button:Take the diagnostic test]({synapGroupLink})`,
        '{lrDiagnosticSection}',
      ],
      ['**2. When and where.**', '**{lrWhenNumber}. When and where.**'],
      ['**3. Good things to know.**', '**{lrKnowNumber}. Good things to know.**'],
      [
        'class times, what to do if {you_miss_or_name_misses} a session, the free 30-minute strategy session',
        '{lrFaqTopicsPhrase}',
      ],
    ],
  },
  {
    key: 'W2_SPOT_OPEN',
    doneToken: '{e1IncludesPhrase}',
    replacements: [[
      'all the usual course information — diagnostic test access, location details, and everything else —',
      'all the usual course information — {e1IncludesPhrase}, and everything else —',
    ]],
  },
  {
    key: 'CS_CLASS_CONFIRMED',
    doneToken: '{csPortalContentsPhrase}',
    replacements: [[
      "In it you'll find live enrollment for {className}, attendance, and diagnostic scores once the class is underway.",
      "In it you'll find {csPortalContentsPhrase}.",
    ]],
  },
]

let failures = 0
for (const edit of EDITS) {
  const { data: tpl } = await db
    .from('email_templates')
    .select('template_key, live, active_version_id')
    .eq('template_key', edit.key)
    .maybeSingle()
  if (!tpl?.active_version_id) { console.error(`FAIL ${edit.key}: no active version`); failures++; continue }
  const { data: v } = await db
    .from('email_template_versions')
    .select('*')
    .eq('id', tpl.active_version_id)
    .single()
  let body = v.body_markdown
  if (body.includes(edit.doneToken)) {
    console.log(`skip ${edit.key} v${v.version_number} — already carries ${edit.doneToken}`)
    continue
  }
  let ok = true
  for (const [anchor, replacement] of edit.replacements) {
    if (body.split(anchor).length !== 2) {
      console.error(`FAIL ${edit.key}: anchor not found exactly once — hand-review needed:\n  ${anchor.split('\n')[0]}`)
      failures++; ok = false; break
    }
    body = body.replace(anchor, replacement)
  }
  if (!ok) continue

  const { data: latest } = await db
    .from('email_template_versions')
    .select('version_number')
    .eq('template_key', edit.key)
    .order('version_number', { ascending: false })
    .limit(1)
  const nextNumber = (latest?.[0]?.version_number ?? 0) + 1
  const { data: inserted, error } = await db
    .from('email_template_versions')
    .insert([{
      template_key: edit.key,
      version_number: nextNumber,
      subject: v.subject,
      preheader: v.preheader,
      body_markdown: body,
      footer_note: v.footer_note,
      variables_used: v.variables_used,
      notes: 'PL-379: diagnostics/strategy-session copy now conditions on the class record (school class → strategy session; has_diagnostics → diagnostic promises)',
      created_by: 'claude',
    }])
    .select('id')
    .single()
  if (error) { console.error(`FAIL ${edit.key} insert: ${error.message}`); failures++; continue }
  await db
    .from('email_templates')
    .update({ active_version_id: inserted.id, updated_at: new Date().toISOString() })
    .eq('template_key', edit.key)
  console.log(`published ${edit.key} v${nextNumber} (live=${tpl.live})`)
}
process.exit(failures ? 1 : 0)
