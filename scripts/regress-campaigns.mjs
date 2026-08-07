#!/usr/bin/env node
// PL-201 regression: Campaigns v1.
// · segment chips resolve correctly alone and composed (QA fixtures)
// · opted-out and suppressed families never resolve
// · the suppression gate lives INSIDE sendOnce and gates ONLY marketing
// · unsubscribe tokens round-trip; forged ones don't
// · quota pause/resume with a capped fixture (transactional reserve honored)
// Send-light: the campaign engine is compiled with sendOnce stubbed; the
// suppression-gate test uses the REAL sendOnce (no key → the marketing gate
// answers before the key check ever runs).
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

const out = path.join(process.cwd(), 'scripts', '.tmp-build-regress-camp')
rmSync(out, { recursive: true, force: true })
execSync(
  `npx tsc app/utils/campaigns.ts app/utils/campaign-send.ts --outDir ${JSON.stringify(out)} --module commonjs --target es2022 --skipLibCheck --esModuleInterop --jsx react-jsx --moduleResolution node`,
  { stdio: 'inherit' }
)
const require = createRequire(import.meta.url)
const emailMod = require(path.join(out, 'email.js'))
const realSendOnce = emailMod.sendOnce
const sendLog = []
emailMod.sendOnce = async (opts) => { sendLog.push(opts); return 'sent' }
emailMod.sendAdminAlert = async () => 'sent'
const camp = require(path.join(out, 'campaigns.js'))
const engine = require(path.join(out, 'campaign-send.js'))
// PL-280: the firewall assertions read the vocabulary + stub context.
const vars = require(path.join(out, 'comms-variables.js'))
const registered = require(path.join(out, 'comms-registered.js'))
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
let failures = 0
const check = (n, ok, d = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ` — ${d}` : ''}`); if (!ok) failures++ }

const rand = Math.random().toString(36).slice(2, 8)
const em = (label) => `billy+qa-pl201-${label}-${rand}@highergroundlearning.com`
const cleanup = { families: [], students: [], enrollments: [], engagements: [], classes: [], campaigns: [], supp: [] }
const capBefore = (await db.from('app_settings').select('value').eq('key', 'resend_daily_cap').maybeSingle()).data?.value ?? null

async function destroy() {
  for (const id of cleanup.campaigns) {
    await db.from('campaign_recipients').delete().eq('campaign_id', id)
    await db.from('campaigns').delete().eq('id', id)
  }
  for (const id of cleanup.engagements) {
    await db.from('tutoring_sessions').delete().eq('engagement_id', id)
    await db.from('tutoring_engagements').delete().eq('id', id)
  }
  for (const id of cleanup.enrollments) {
    await db.from('enrollment_addons').delete().eq('enrollment_id', id)
    await db.from('enrollments').delete().eq('id', id)
  }
  for (const id of cleanup.invoices ?? []) await db.from('tutoring_invoices').delete().eq('id', id)
  for (const id of cleanup.students) await db.from('students').delete().eq('id', id)
  for (const id of cleanup.families) await db.from('families').delete().eq('id', id)
  for (const id of cleanup.classes) await db.from('classes').delete().eq('id', id)
  for (const e of cleanup.supp) await db.from('marketing_suppressions').delete().eq('email', e)
  if (capBefore === null) await db.from('app_settings').delete().eq('key', 'resend_daily_cap')
  else await db.from('app_settings').upsert({ key: 'resend_daily_cap', value: capBefore })
}

try {
  const { data: school } = await db.from('schools').select('id').limit(1).single()
  const { data: subject } = await db.from('subjects').select('id').limit(1).single()
  const { data: tutor } = await db.from('instructors').select('id').limit(1).single()

  const mkFam = async (label, extra = {}) => {
    const { data: fam } = await db.from('families').insert([{
      parent_first_name: `QA-PL201-${label}`, parent_last_name: 'Parent', parent_email: em(label), ...extra,
    }]).select('id').single()
    cleanup.families.push(fam.id)
    const { data: stu } = await db.from('students').insert([{
      family_id: fam.id, first_name: `QA201-${label}`, last_name: 'Student',
    }]).select('id').single()
    cleanup.students.push(stu.id)
    return { famId: fam.id, stuId: stu.id }
  }

  const { data: qaClass, error: qaClassErr } = await db.from('classes').insert([{
    class_type: 'QA-PL201 SAT Prep', school_id: school.id, status: 'open', start_date: '2036-01-10', price: 500, capacity: 10,
  }]).select('id').single()
  if (qaClassErr) throw new Error('class fixture: ' + qaClassErr.message)
  cleanup.classes.push(qaClass.id)

  // A: took the QA class (paid), active tutoring at $120 — no package.
  const A = await mkFam('a')
  const { data: enrA } = await db.from('enrollments').insert([{
    student_id: A.stuId, class_id: qaClass.id, payment_status: 'Paid',
  }]).select('id').single()
  cleanup.enrollments.push(enrA.id)
  const { data: engA } = await db.from('tutoring_engagements').insert([{
    student_id: A.stuId, tutor_id: tutor.id, subject_id: subject.id,
    hourly_rate: 120, funding: 'monthly_billed', recurrence: [], status: 'active',
  }]).select('id').single()
  cleanup.engagements.push(engA.id)

  // B: waitlisted only — class-only, not current.
  const B = await mkFam('b')
  const { data: enrB } = await db.from('enrollments').insert([{
    student_id: B.stuId, class_id: qaClass.id, payment_status: 'Waitlisted',
  }]).select('id').single()
  cleanup.enrollments.push(enrB.id)

  // C: like A but opted out — must NEVER resolve.
  const C = await mkFam('c', { marketing_opt_out: true })
  const { data: enrC } = await db.from('enrollments').insert([{
    student_id: C.stuId, class_id: qaClass.id, payment_status: 'Paid',
  }]).select('id').single()
  cleanup.enrollments.push(enrC.id)

  const emails = (rs) => rs.map((r) => r.email)

  const tookQa = await camp.resolveSegment({ classType: 'QA-PL201 SAT Prep' })
  check('1. classType chip: paid takers only (waitlisted + opted-out excluded)',
    emails(tookQa).includes(em('a')) && !emails(tookQa).includes(em('b')) && !emails(tookQa).includes(em('c')),
    `${tookQa.length} matched`)
  check('2. why-matched is carried', tookQa.find((r) => r.email === em('a'))?.why.includes('took QA-PL201 SAT Prep'), '')

  const tutoring = await camp.resolveSegment({ serviceKind: 'tutoring', rateAtLeast: 100 })
  check('3. tutoring + rate chips compose', emails(tutoring).includes(em('a')) && !emails(tutoring).includes(em('b')), '')

  const waitl = await camp.resolveSegment({ waitlisted: true })
  check('4. waitlist chip', emails(waitl).includes(em('b')) && !emails(waitl).includes(em('a')), '')

  const composed = await camp.resolveSegment({ classType: 'QA-PL201 SAT Prep', currentStudent: true })
  check('5. AND composition narrows (took class AND current)',
    emails(composed).includes(em('a')) && !emails(composed).includes(em('b')), '')

  // --- Unsubscribe tokens + the sendOnce gate --------------------------------
  const tok = camp.unsubscribeToken(em('a'))
  check('6. unsubscribe token round-trips', camp.verifyUnsubscribeToken(tok) === em('a'), '')
  check('7. forged token rejected', camp.verifyUnsubscribeToken(tok.slice(0, -4) + 'beef') === null, '')

  await camp.suppressEmail(em('a'), 'qa')
  cleanup.supp.push(em('a'))
  // PL-280 (Scarlett's per-person rule): a suppressed PARENT email no longer
  // hides the family — the row stays listed, flagged, so student legs can
  // still run; the parent leg itself is refused by sendOnce (check 9).
  const afterSupp = await camp.resolveSegment({ classType: 'QA-PL201 SAT Prep' })
  const suppRow = afterSupp.find((r) => r.email === em('a'))
  check('8. per-person: suppressed parent stays listed, flagged (leg-level, not family-level)',
    Boolean(suppRow && suppRow.parentSuppressed === true), JSON.stringify(suppRow ?? null))
  // The whole-family opt-out (legacy path) still excludes everyone.
  check('8b. suppressEmail no longer flips the family flag',
    !(await db.from('families').select('marketing_opt_out').eq('id', cleanup.families[0]).maybeSingle()).data
      ?.marketing_opt_out, '')

  const marketingResult = await realSendOnce({
    marketing: true, dedupeKey: `qa-pl201-m-${rand}`, emailType: 'CAMPAIGN',
    to: [em('a')], subject: 'qa', html: '<p>qa</p>',
  })
  check('9. sendOnce gate: marketing to a suppressed address → suppressed', marketingResult === 'suppressed', marketingResult)
  const transactionalResult = await realSendOnce({
    dedupeKey: `qa-pl201-t-${rand}`, emailType: 'T1_MONTHLY_PROPOSAL',
    to: [em('a')], subject: 'qa', html: '<p>qa</p>',
  })
  check('10. transactional to the SAME address is NEVER suppressed', transactionalResult !== 'suppressed', transactionalResult)

  // --- Quota pause / resume --------------------------------------------------
  // Cap = used + reserve + 1 → room for exactly ONE of two recipients.
  const dayStart = new Date(new Date().toLocaleDateString('en-CA', { timeZone: 'America/Denver' }) + 'T00:00:00-06:00').toISOString()
  const { count: usedToday } = await db.from('email_sends')
    .select('id', { count: 'exact', head: true })
    .in('status', ['sent', 'delivered', 'bounced', 'complained'])
    .gte('sent_at', dayStart)
  await db.from('app_settings').upsert({ key: 'resend_daily_cap', value: String((usedToday ?? 0) + 20 + 1) })

  const { data: mk } = await db.from('email_templates').select('template_key, active_version_id').eq('template_key', 'MK_OFFER').single()
  const { data: campaign } = await db.from('campaigns').insert([{
    name: 'QA-PL201 pause test', segment: {}, segment_summary: 'qa', template_key: 'MK_OFFER',
    template_version_id: mk.active_version_id, status: 'draft', created_by: 'qa',
  }]).select('id').single()
  cleanup.campaigns.push(campaign.id)
  await db.from('campaign_recipients').insert([
    { campaign_id: campaign.id, family_id: B.famId, email: em('b'), name: 'QA B', why: ['qa'], status: 'pending' },
    { campaign_id: campaign.id, family_id: C.famId, email: em('c2'), name: 'QA C2', why: ['qa'], status: 'pending' },
  ])

  const run1 = await engine.runCampaignSend(campaign.id)
  check('11. campaign pauses at the cap (1 of 2 sent, transactional reserve kept)',
    run1.status === 'paused' && run1.sent === 1 && run1.pendingLeft === 1, JSON.stringify(run1))
  check('12. the send used the marketing flag + CAMPAIGN type',
    sendLog.length > 0 && sendLog.every((s) => s.marketing === true && s.emailType === 'CAMPAIGN'), '')

  await db.from('app_settings').upsert({ key: 'resend_daily_cap', value: '100000' })
  const resumed = await engine.resumePausedCampaigns()
  const { data: campAfter } = await db.from('campaigns').select('status').eq('id', campaign.id).single()
  const { data: recAfter } = await db.from('campaign_recipients').select('status').eq('campaign_id', campaign.id)
  check('13. the sweep resumes it to done', resumed === 1 && campAfter.status === 'done', campAfter.status)
  check('14. per-recipient log complete (all sent)', (recAfter ?? []).every((r) => r.status === 'sent'), '')

  // --- PL-280: family-history chips + the financial firewall -----------------
  // A's history: one $500 paid class (price fallback — no snapshot), active
  // tutoring, no invoices. B: waitlisted only, no tutoring.
  const spentLow = await camp.resolveSegment({ classType: 'QA-PL201 SAT Prep', spentAtLeast: 400 })
  const spentHigh = await camp.resolveSegment({ classType: 'QA-PL201 SAT Prep', spentAtLeast: 600 })
  check('15. spent-$X chip uses the term-report money rule',
    emails(spentLow).includes(em('a')) && !emails(spentHigh).includes(em('a')),
    JSON.stringify({ low: emails(spentLow), high: emails(spentHigh) }))

  const neverTut = await camp.resolveSegment({ tutoringStatus: 'never' })
  check('16. never-bought-tutoring chip', emails(neverTut).includes(em('b')) && !emails(neverTut).includes(em('a')), '')

  const purch = await camp.resolveSegment({ classType: 'QA-PL201 SAT Prep', purchasesAtLeast: 2 })
  check('17. purchases-count chip', !emails(purch).includes(em('a')), '')

  const noBal = await camp.resolveSegment({ classType: 'QA-PL201 SAT Prep', balance: 'none_outstanding' })
  check('18. no-outstanding-balance chip (A has no invoices)', emails(noBal).includes(em('a')), '')
  const { data: qaInv, error: invErr } = await db.from('tutoring_invoices').insert([{
    family_id: A.famId, period: '2036-01-01', status: 'past_due', total: 100,
  }]).select('id').single()
  if (invErr) throw new Error('invoice fixture: ' + invErr.message)
  cleanup.invoices = [qaInv.id]
  const pastDue = await camp.resolveSegment({ balance: 'past_due' })
  const noBal2 = await camp.resolveSegment({ classType: 'QA-PL201 SAT Prep', balance: 'none_outstanding' })
  check('19. past-due chip flips both ways', emails(pastDue).includes(em('a')) && !emails(noBal2).includes(em('a')), '')

  const wlOnly = await camp.resolveSegment({ classType: 'QA-PL201 SAT Prep', classOutcome: 'waitlisted_only' })
  check('20. waitlisted-never-enrolled outcome', emails(wlOnly).includes(em('b')) && !emails(wlOnly).includes(em('a')), '')

  check('21. recipients carry student records for paired sends',
    tookQa.every((r) => Array.isArray(r.studentRecords) && r.studentRecords.every((s) => typeof s.firstName === 'string')), '')

  // The financial firewall, asserted structurally: (a) no composer variable
  // is named after family financial history, so money facts can't be typed
  // into a template; (b) the campaign stub context carries no money values.
  // (amountPaid/invoiceTotal are TRANSACTIONAL per-payment variables —
  // receipts and invoices render them legitimately; on a campaign stub they
  // must resolve empty, asserted in 23. The firewall bans HISTORY
  // aggregates: lifetime spend, balances, past-due, purchase counts.)
  const varNames = Object.keys(vars.VARIABLES)
  const dollarShaped = varNames.filter((n) => /spend|spent|balance|outstanding|pastdue|lifetime|purchases/i.test(n))
  check('22. firewall: no family-financial-HISTORY composer variables', dollarShaped.length === 0, dollarShaped.join(', '))
  const stubCtx = registered.tutoringStubContext({ parentFirstName: 'QA' })
  const stubResolved = vars.resolveVariables(stubCtx, 'parent', {})
  const moneyLeaks = ['amountPaid', 'invoiceTotal']
    .filter((n) => n in stubResolved)
    .filter((n) => /\$\s*[1-9]/.test(String(stubResolved[n].value ?? '')))
  check('23. firewall: campaign stub context carries no money',
    stubCtx.amountPaid === null && stubCtx.price === 0 && moneyLeaks.length === 0, moneyLeaks.join(', '))
} finally {
  await destroy()
  rmSync(out, { recursive: true, force: true })
  console.log('cleanup done (fixtures removed, cap restored)')
}
process.exit(failures ? 1 : 0)
