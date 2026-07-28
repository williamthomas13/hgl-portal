#!/usr/bin/env node
// PL-204 regression: the term report's numbers match hand-computed fixtures
// (unique far-future QA months so nothing else contributes), refunds are
// excluded, and — the load-bearing check — the MANAGER payload carries no
// dollar field anywhere (deep key scan, not a render assertion).
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

const out = path.join(process.cwd(), 'scripts', '.tmp-build-regress-report')
rmSync(out, { recursive: true, force: true })
execSync(
  `npx tsc app/utils/term-report.ts --outDir ${JSON.stringify(out)} --module commonjs --target es2022 --skipLibCheck --esModuleInterop --jsx react-jsx --moduleResolution node`,
  { stdio: 'inherit' }
)
const require = createRequire(import.meta.url)
const tr = require(path.join(out, 'term-report.js'))
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
let failures = 0
const check = (n, ok, d = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ` — ${d}` : ''}`); if (!ok) failures++ }

const QA_MONTH = '2037-05' // far future, unique to this gate
const cleanup = { classes: [], enrollments: [], students: [], families: [], invoices: [] }
async function destroy() {
  for (const id of cleanup.enrollments) {
    await db.from('enrollment_addons').delete().eq('enrollment_id', id)
    await db.from('enrollments').delete().eq('id', id)
  }
  for (const id of cleanup.invoices) await db.from('tutoring_invoices').delete().eq('id', id)
  for (const id of cleanup.students) await db.from('students').delete().eq('id', id)
  for (const id of cleanup.families) await db.from('families').delete().eq('id', id)
  for (const id of cleanup.classes) await db.from('classes').delete().eq('id', id)
}

try {
  const { data: school } = await db.from('schools').select('id, nickname, name').limit(1).single()
  const { data: cls, error: clsErr } = await db.from('classes').insert([{
    class_type: 'QA-PL204 SAT Prep', school_id: school.id, status: 'open',
    start_date: `${QA_MONTH}-15`, price: 500, capacity: 10, min_enrollment: 3,
  }]).select('id').single()
  if (clsErr) throw new Error('class fixture: ' + clsErr.message)
  cleanup.classes.push(cls.id)

  const { data: fam } = await db.from('families').insert([{
    parent_first_name: 'QA-PL204', parent_last_name: 'Parent',
    parent_email: `billy+qa-pl204-${Math.random().toString(36).slice(2, 8)}@highergroundlearning.com`,
  }]).select('id').single()
  cleanup.families.push(fam.id)
  const { data: stu } = await db.from('students').insert([{
    family_id: fam.id, first_name: 'QA-PL204', last_name: 'Student',
  }]).select('id').single()
  cleanup.students.push(stu.id)

  // Two paid (450 snapshot + 500 fallback-less), one refunded (excluded).
  const mkEnr = async (fields) => {
    const { data, error } = await db.from('enrollments').insert([{ student_id: stu.id, class_id: cls.id, ...fields }]).select('id').single()
    if (error) throw new Error('enrollment fixture: ' + error.message)
    cleanup.enrollments.push(data.id)
    return data.id
  }
  const e1 = await mkEnr({ payment_status: 'Paid', class_price_paid: 450 })
  await mkEnr({ payment_status: 'Paid', class_price_paid: 500 })
  await mkEnr({ payment_status: 'Paid', class_price_paid: 500, cancellation_outcome: 'refunded' })

  // A paid tutoring invoice in the QA month.
  const { data: inv } = await db.from('tutoring_invoices').insert([{
    family_id: fam.id, period: `${QA_MONTH}-01`, status: 'paid', subtotal: 300, total: 300,
  }]).select('id').single()
  cleanup.invoices.push(inv.id)

  // One 5h package sold in the QA month (no engagement → not exhausted).
  const { error: addonErr } = await db.from('enrollment_addons').insert([{
    enrollment_id: e1, hours: 5, price_paid: 400, source: 'cancellation_conversion',
    purchased_at: `${QA_MONTH}-03T12:00:00Z`,
  }])
  if (addonErr) throw new Error('addon fixture: ' + addonErr.message)

  const report = await tr.loadTermReport()
  const row = report.classes.find((c) => c.id === cls.id)
  check('1. class row present with school + month', !!row && row.month === QA_MONTH, JSON.stringify({ month: row?.month }))
  check('2. enrolled counts paid only (refunded excluded)', row?.enrolled === 2, `enrolled=${row?.enrolled}`)
  check('3. class revenue = hand-computed 950 from PL-142 snapshots', row?.revenue === 950, `revenue=${row?.revenue}`)
  check('4. capacity/minimum carried', row?.capacity === 10 && row?.minEnrollment === 3, '')
  const tut = report.tutoringByMonth.find((t) => t.month === QA_MONTH)
  check('5. tutoring month = the one paid invoice, $300', tut?.invoicesPaid === 1 && tut?.revenue === 300, JSON.stringify(tut))
  const pkg = report.packages.find((p) => p.month === QA_MONTH)
  check('6. package month: 1 sold, 5h, $400, none exhausted', pkg?.sold === 1 && pkg?.hours === 5 && pkg?.revenue === 400 && pkg?.exhausted === 0, JSON.stringify(pkg))
  check('7. admin totals present and cover the fixtures',
    report.totals && report.totals.classRevenue >= 950 && report.totals.tutoringRevenue >= 300 && report.totals.packageRevenue >= 400, '')

  // The load-bearing check: manager payload carries NO dollar field anywhere.
  const manager = tr.stripRevenue(report)
  const badKeys = []
  const scan = (obj, pathStr) => {
    if (Array.isArray(obj)) return obj.forEach((v, i) => scan(v, `${pathStr}[${i}]`))
    if (obj && typeof obj === 'object')
      for (const [k, v] of Object.entries(obj)) {
        if (/revenue|total|price|amount|dollar|paid_?amount/i.test(k) && k !== 'invoicesPaid') badKeys.push(`${pathStr}.${k}`)
        scan(v, `${pathStr}.${k}`)
      }
  }
  scan(manager, '$')
  check('8. manager payload deep-scan: zero dollar-shaped keys', badKeys.length === 0, badKeys.slice(0, 5).join(', '))
  check('9. manager role stamped + counts intact', manager.role === 'manager' && manager.classes.find((c) => c.id === cls.id)?.enrolled === 2, '')
} finally {
  await destroy()
  rmSync(out, { recursive: true, force: true })
  console.log('cleanup done (fixtures removed)')
}
process.exit(failures ? 1 : 0)
