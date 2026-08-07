#!/usr/bin/env node
// PL-292/293/294 verification (composer path; send-light):
//   292 — the two v2 pronoun spots agree in all four states (unset renders
//         Scarlett's original words byte-for-byte).
//   293 — {followOnInfoBlock} renders the marketing link when the class has
//         one and vanishes without a trace when it doesn't.
//   294 — auto-extend: deadline passed + switch ON + under minimum →
//         cohort extends + extension stage arms; switch OFF → nothing;
//         at/above minimum → nothing.
import { readFileSync, rmSync } from 'node:fs'
import { execSync } from 'node:child_process'
import path from 'node:path'
import { createRequire } from 'node:module'
import { createClient } from '@supabase/supabase-js'

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => {
      const k = l.slice(0, l.indexOf('=')).trim(); let v = l.slice(l.indexOf('=') + 1).trim()
      if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1)
      return [k, v]
    })
)
for (const [k, v] of Object.entries(env)) process.env[k] ??= v
delete process.env.RESEND_API_KEY

const out = path.join(process.cwd(), 'scripts', '.tmp-build-verify-pl292')
rmSync(out, { recursive: true, force: true })
execSync(
  `npx tsc app/utils/follow-on.ts app/utils/lifecycle.ts --outDir ${JSON.stringify(out)} --module commonjs --target es2022 --skipLibCheck --esModuleInterop --moduleResolution node --jsx react-jsx`,
  { stdio: 'inherit' }
)
const require = createRequire(import.meta.url)
const fo = require(path.join(out, 'follow-on.js'))
const lifecycle = require(path.join(out, 'lifecycle.js'))
const { renderVersion, clearTemplateCache } = require(path.join(out, 'comms-db-render.js'))
const { SAMPLE_CONTEXT, sampleExtraFor } = require(path.join(out, 'comms-variables.js'))
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

let pass = 0, fail = 0
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`PASS  ${name}`) }
  else { fail++; console.error(`FAIL  ${name}${detail ? ' — ' + String(detail).slice(0, 250) : ''}`) }
}
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Denver' })
const addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }

// --- load the two v2 parent templates (drafts render via renderVersion —
// the editor/view-as pipeline, i.e. the composer path) ----------------------
async function loadActive(key) {
  const { data: t } = await db
    .from('email_templates')
    .select('template_key, display_name, from_identity, category, audience, live, active_version_id')
    .eq('template_key', key).maybeSingle()
  const { data: v } = await db
    .from('email_template_versions')
    .select('subject, preheader, body_markdown, footer_note, version_number')
    .eq('id', t.active_version_id).maybeSingle()
  return { t, v }
}

// PL-292: pronoun agreement across all four states.
const STATES = [
  { p: 'she_her', them: 'her', their: 'her' },
  { p: 'he_him', them: 'him', their: 'his' },
  { p: 'name_only', them: 'Ana', their: "Ana's" },
  { p: null, them: 'them', their: 'their' }, // unset = Scarlett's original words
]
{
  const rem = await loadActive('FO_REMINDER_PARENT')
  const ext = await loadActive('FO_EXTENSION_PARENT')
  check('v2 active: FO_REMINDER_PARENT', rem.v.version_number === 2, `v${rem.v.version_number}`)
  check('v2 active: FO_EXTENSION_PARENT', ext.v.version_number === 2, `v${ext.v.version_number}`)
  for (const st of STATES) {
    const ctx = { ...SAMPLE_CONTEXT, studentFirstName: 'Ana', studentPronouns: st.p }
    const label = st.p ?? 'unset'
    const r1 = renderVersion(rem.v, rem.t, ctx, 'parent', sampleExtraFor('FO_REMINDER_PARENT'))
    check(
      `FO-2P[${label}]: "right for ${st.them}"`,
      r1.html.includes(`the course is right for ${st.them},`),
      r1.html.match(/course is right for [^,]{1,20},/)?.[0]
    )
    const r2 = renderVersion(ext.v, ext.t, ctx, 'parent', sampleExtraFor('FO_EXTENSION_PARENT'))
    check(
      `FO-3P[${label}]: "${st.their} confidence"`,
      r2.html.includes(`${st.their} confidence`),
      r2.html.match(/and<\/em> [^ ]{1,12} confidence/)?.[0]
    )
    const leftover = (r1.html + r2.html).match(/\{[a-zA-Z_]+\}/g)
    check(`FO[${label}]: no unresolved variables`, !leftover, String(leftover))
  }
  // PL-293: info block present with the sample's marketing URL…
  const ctx = { ...SAMPLE_CONTEXT }
  const withInfo = renderVersion(rem.v, rem.t, ctx, 'parent', sampleExtraFor('FO_REMINDER_PARENT'))
  check('info block: renders the marketing link', withInfo.html.includes('https://hgl.co/advanced-sat') && /More info about/.test(withInfo.html))
  // …and vanishes cleanly without one.
  const ctxNo = { ...SAMPLE_CONTEXT, followOn: { ...SAMPLE_CONTEXT.followOn, infoUrl: null } }
  const withoutInfo = renderVersion(rem.v, rem.t, ctxNo, 'parent', sampleExtraFor('FO_REMINDER_PARENT'))
  check('info block: vanishes when no marketing page', !/More info about/.test(withoutInfo.html) && !withoutInfo.html.includes('followOnInfoBlock'))
}

// --- PL-294: auto-extend on the real sweep ---------------------------------
const FO_KEYS = ['FO_ANNOUNCE_PARENT', 'FO_ANNOUNCE_STUDENT', 'FO_REMINDER_PARENT', 'FO_REMINDER_STUDENT', 'FO_EXTENSION_PARENT', 'FO_EXTENSION_STUDENT']
const { data: target } = await db.from('classes').insert([{
  class_type: 'QA FO Target 294', school_id: null, price: 500, capacity: 20,
  min_enrollment: 3, delivery_mode: 'online', start_date: addDays(today, 40),
  slug: 'qa-pl294-target', status: 'open', timezone: 'America/Denver',
  promo_code: 'QA294', promo_amount: 50, fo_auto_extend: false,
}]).select('id').single()
const { data: feeder } = await db.from('classes').insert([{
  class_type: 'QA FO Feeder 294', school_id: null, price: 450, capacity: 20,
  min_enrollment: 3, delivery_mode: 'online', start_date: addDays(today, -40),
  slug: 'qa-pl294-feeder', status: 'open', timezone: 'America/Denver',
  follow_on_class_id: target.id,
}]).select('id').single()
// Deadline already passed: last session 20 days ago (base deadline −6d).
await db.from('sessions').insert([{ class_id: feeder.id, session_date: addDays(today, -20), start_time: '16:00', end_time: '18:00' }])
const { data: fam } = await db.from('families').insert([{ parent_first_name: 'QA294', parent_last_name: 'PL294', parent_email: 'qa-pl294@example.com' }]).select('id').single()
const { data: stu } = await db.from('students').insert([{ family_id: fam.id, first_name: 'QA', last_name: 'F294' }]).select('id').single()
await db.from('enrollments').insert([{ class_id: feeder.id, student_id: stu.id, payment_status: 'Completed', enrolled_at: new Date().toISOString(), paid_at: new Date().toISOString() }])

const cleanup = async () => {
  await db.from('email_templates').update({ live: false }).in('template_key', FO_KEYS)
  await db.from('email_sends').delete().eq('class_id', feeder.id)
  await db.from('enrollments').delete().in('class_id', [feeder.id, target.id])
  await db.from('sessions').delete().eq('class_id', feeder.id)
  await db.from('classes').delete().in('id', [feeder.id, target.id])
  await db.from('students').delete().eq('id', stu.id)
  await db.from('families').delete().eq('id', fam.id)
}

try {
  await db.from('email_templates').update({ live: true }).in('template_key', FO_KEYS)
  clearTemplateCache()
  const bundle = async () => (await lifecycle.loadClassBundles(feeder.id))[0]

  // Switch OFF → deadline passed, nothing extends, nothing sends.
  let report = await fo.sweepFollowOnForBundle(await bundle())
  let { data: f1 } = await db.from('classes').select('fo_extended_until').eq('id', feeder.id).maybeSingle()
  check('auto-extend OFF: no extension, no sends', !f1.fo_extended_until && report.attempts.length === 0, JSON.stringify(report))

  // Switch ON + AT minimum → still nothing (the class doesn't need rescue).
  // Real enrollments, a different family (min_enrollment 0 would hit the
  // PL-61 nonsense-minimum fallback and read as 3).
  await db.from('classes').update({ fo_auto_extend: true }).eq('id', target.id)
  const { data: fam2 } = await db.from('families').insert([{ parent_first_name: 'QA294b', parent_last_name: 'PL294', parent_email: 'qa-pl294b@example.com' }]).select('id').single()
  const stus2 = []
  for (let i = 0; i < 3; i++) {
    const { data: s2 } = await db.from('students').insert([{ family_id: fam2.id, first_name: `QB${i}`, last_name: 'F294' }]).select('id').single()
    stus2.push(s2.id)
    await db.from('enrollments').insert([{ class_id: target.id, student_id: s2.id, payment_status: 'Paid', enrolled_at: new Date().toISOString() }])
  }
  report = await fo.sweepFollowOnForBundle(await bundle())
  ;({ data: f1 } = await db.from('classes').select('fo_extended_until').eq('id', feeder.id).maybeSingle())
  check('auto-extend ON but at minimum: nothing', !f1.fo_extended_until && report.attempts.length === 0, JSON.stringify(report.attempts))
  await db.from('enrollments').delete().eq('class_id', target.id)
  await db.from('students').delete().in('id', stus2)
  await db.from('families').delete().eq('id', fam2.id)

  // Switch ON + under minimum → extends once + extension stage arms.
  report = await fo.sweepFollowOnForBundle(await bundle())
  ;({ data: f1 } = await db.from('classes').select('fo_extended_until').eq('id', feeder.id).maybeSingle())
  check('auto-extend ON + under minimum: cohort extended a week', f1.fo_extended_until === addDays(today, 7), f1.fo_extended_until)
  check('auto-extend: extension pair attempted', report.attempts.some((a) => a.stage === 'extension'), JSON.stringify(report.attempts.map((a) => a.stage)))
  const extAttempt = report.attempts.find((a) => a.stage === 'extension' && a.audience === 'parent')
  check('auto-extend: extension subject is Scarlett\'s', /Bad News, Great News/.test(extAttempt?.subject ?? ''), extAttempt?.subject)

  // Once per cohort: a second sweep must not extend again.
  const before = f1.fo_extended_until
  await fo.sweepFollowOnForBundle(await bundle())
  ;({ data: f1 } = await db.from('classes').select('fo_extended_until').eq('id', feeder.id).maybeSingle())
  check('auto-extend: once per cohort (no re-extend)', f1.fo_extended_until === before)
} finally {
  await cleanup()
}
const { data: leftover } = await db.from('classes').select('id').in('slug', ['qa-pl294-target', 'qa-pl294-feeder'])
check('cleanup: fixtures gone', (leftover ?? []).length === 0)
const { data: tpls } = await db.from('email_templates').select('live').in('template_key', FO_KEYS)
check('cleanup: templates back to draft', (tpls ?? []).every((t) => !t.live))

rmSync(out, { recursive: true, force: true })
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail > 0 ? 1 : 0)
