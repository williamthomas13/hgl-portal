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
  `npx tsc app/utils/term-report.ts app/utils/tutor-hours-report.ts app/utils/report-period.ts --outDir ${JSON.stringify(out)} --module commonjs --target es2022 --skipLibCheck --esModuleInterop --jsx react-jsx --moduleResolution node`,
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
  const scanTarget = (obj, pathStr, sink) => {
    if (Array.isArray(obj)) return obj.forEach((v, i) => scanTarget(v, `${pathStr}[${i}]`, sink))
    if (obj && typeof obj === 'object')
      for (const [k, v] of Object.entries(obj)) {
        if (/revenue|total|price|amount|dollar|paid_?amount/i.test(k) && k !== 'invoicesPaid') sink.push(`${pathStr}.${k}`)
        scanTarget(v, `${pathStr}.${k}`, sink)
      }
  }
  const scan = (obj, pathStr) => scanTarget(obj, pathStr, badKeys)
  scan(manager, '$')
  check('8. manager payload deep-scan: zero dollar-shaped keys', badKeys.length === 0, badKeys.slice(0, 5).join(', '))
  check('9. manager role stamped + counts intact', manager.role === 'manager' && manager.classes.find((c) => c.id === cls.id)?.enrolled === 2, '')

  // PL-218: the tutor-hours report holds the same line — the manager variant
  // carries hours only. Hours-shaped keys (totalHours, totalsByMonth …) are
  // legitimate; dollar-shaped ones (revenue, listRate, amount, price) never.
  const thr = require(path.join(out, 'tutor-hours-report.js'))
  const now = new Date()
  const toM = now.toISOString().slice(0, 7)
  const fromM = `${now.getFullYear() - 1}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const hoursReport = await thr.loadTutorHoursReport({ tutorId: 'all', fromMonth: fromM, toMonth: toM })
  check('10. tutor-hours admin payload has revenue fields available',
    hoursReport.role === 'admin' && hoursReport.rows.every((r) => 'revenue' in r), '')
  const hoursManager = thr.stripTutorHoursRevenue(hoursReport)
  const badHourKeys = []
  const scanHours = (obj, pathStr) => {
    if (Array.isArray(obj)) return obj.forEach((v, i) => scanHours(v, `${pathStr}[${i}]`))
    if (obj && typeof obj === 'object')
      for (const [k, v] of Object.entries(obj)) {
        if (/revenue|price|amount|dollar|rate/i.test(k)) badHourKeys.push(`${pathStr}.${k}`)
        scanHours(v, `${pathStr}.${k}`)
      }
  }
  scanHours(hoursManager, '$')
  check('11. tutor-hours manager payload deep-scan: zero dollar-shaped keys',
    hoursManager.role === 'manager' && badHourKeys.length === 0, badHourKeys.slice(0, 5).join(', '))
  check('12. tutor-hours category keys are stable machine keys',
    hoursReport.rows.every((r) => /^(1on1|worktype|class|consult):/.test(r.key)), JSON.stringify(hoursReport.rows.map((r) => r.key).slice(0, 5)))

  // PL-345/347: the dashboard snapshot holds the same line — the manager
  // variant carries counts and hours only, never a dollar-shaped key, and
  // the PL-347 period figures survive stripped to counts+hours.
  const fullSnapshot = {
    role: 'admin',
    enrolledAllTime: 12,
    enrolledThisMonth: 3,
    activeEngagements: 4,
    hoursThisMonth: 21.5,
    monthLabel: 'August',
    period: { kind: 'this-quarter', label: 'Q3 2026 · July–September', previousLabel: 'Q2 2026' },
    periodFigures: { enrolled: 5, hours: 12, revenue: 1000 },
    previousFigures: { enrolled: 2, hours: 8, revenue: 600 },
    revenue: { classes: 950, tutoring: 300, packages: 400, grand: 1650 },
    projection: { total: 675, monthLabel: 'September 2026', generateDay: 20 },
  }
  const managerSnapshot = tr.stripSnapshotRevenue(fullSnapshot)
  const badSnapKeys = []
  scanTarget(managerSnapshot, '$', badSnapKeys)
  check('13. snapshot manager payload deep-scan: zero dollar-shaped keys',
    managerSnapshot.role === 'manager' && badSnapKeys.length === 0, badSnapKeys.join(', '))
  check('14. snapshot manager payload keeps the enrollment-side numbers',
    managerSnapshot.enrolledAllTime === 12 && managerSnapshot.enrolledThisMonth === 3 &&
    managerSnapshot.hoursThisMonth === 21.5 && !('revenue' in managerSnapshot) && !('projection' in managerSnapshot), '')
  check('15. snapshot manager keeps period counts+hours, drops period revenue',
    managerSnapshot.periodFigures?.enrolled === 5 && managerSnapshot.periodFigures?.hours === 12 &&
    !('revenue' in (managerSnapshot.periodFigures ?? {})) &&
    managerSnapshot.previousFigures?.enrolled === 2 && !('revenue' in (managerSnapshot.previousFigures ?? {})) &&
    managerSnapshot.period?.previousLabel === 'Q2 2026', JSON.stringify(managerSnapshot.periodFigures))

  // ── PL-347: report-period.ts — boundaries, twins, and the All-time parity
  // guarantee (E). The clock is PINNED so quarter/year math is deterministic.
  const rp = require(path.join(out, 'report-period.js'))
  const NOW = new Date('2026-08-15T18:00:00Z') // Denver: 2026-08-15

  const allTime = rp.resolvePeriod('all-time', { now: NOW })
  check('16. all-time period is unbounded and admits every month bucket',
    allTime.fromMonth === null && allTime.toMonth === null && allTime.previous === null &&
    rp.monthInPeriod(QA_MONTH, allTime) && rp.monthInPeriod('unscheduled', allTime) && rp.monthInPeriod('unknown', allTime), '')

  // The mechanical parity check: scoping the REAL report by All time changes
  // nothing — same row counts, same revenue sums, equal to report.totals.
  const inAll = (rows) => rows.filter((r) => rp.monthInPeriod(r.month, allTime))
  const sum = (rows) => Number(rows.reduce((s, r) => s + (r.revenue ?? 0), 0).toFixed(2))
  check('17. PARITY: All-time-scoped report === the unscoped report (rows and dollars)',
    inAll(report.classes).length === report.classes.length &&
    inAll(report.tutoringByMonth).length === report.tutoringByMonth.length &&
    inAll(report.packages).length === report.packages.length &&
    sum(inAll(report.classes)) === report.totals.classRevenue &&
    sum(inAll(report.tutoringByMonth)) === report.totals.tutoringRevenue &&
    sum(inAll(report.packages)) === report.totals.packageRevenue,
    JSON.stringify({ cls: sum(inAll(report.classes)), totals: report.totals.classRevenue }))

  const q = rp.resolvePeriod('this-quarter', { now: NOW })
  check('18. this-quarter (Denver Aug 2026) = Jul–Sep w/ Q2 twin and plain label',
    q.fromMonth === '2026-07' && q.toMonth === '2026-09' &&
    q.label === 'Q3 2026 · July–September' &&
    q.previous.fromMonth === '2026-04' && q.previous.toMonth === '2026-06' && q.previous.label === 'Q2 2026',
    JSON.stringify(q))

  const tm = rp.resolvePeriod('this-month', { now: NOW })
  const lm = rp.resolvePeriod('last-month', { now: NOW })
  const ty = rp.resolvePeriod('this-year', { now: NOW })
  check('19. this-month / last-month / this-year bounds + previous twins',
    tm.fromMonth === '2026-08' && tm.toMonth === '2026-08' && tm.previous.fromMonth === '2026-07' &&
    lm.fromMonth === '2026-07' && lm.toMonth === '2026-07' && lm.previous.fromMonth === '2026-06' &&
    ty.fromMonth === '2026-01' && ty.toMonth === '2026-12' &&
    ty.previous.fromMonth === '2025-01' && ty.previous.toMonth === '2025-12' && ty.previous.label === '2025',
    JSON.stringify({ tm: tm.label, lm: lm.label, ty: ty.label }))

  const cust = rp.resolvePeriod('custom', { now: NOW, fromMonth: '2026-03', toMonth: '2026-05' })
  const rev = rp.resolvePeriod('custom', { now: NOW, fromMonth: '2026-05', toMonth: '2026-03' })
  check('20. custom range: equal-length previous twin, year-crossing twin months, reversed inputs normalized',
    cust.fromMonth === '2026-03' && cust.toMonth === '2026-05' &&
    cust.previous.fromMonth === '2025-12' && cust.previous.toMonth === '2026-02' &&
    cust.label === 'March–May 2026' &&
    rev.fromMonth === '2026-03' && rev.toMonth === '2026-05', JSON.stringify(cust))

  check('21. bounded periods exclude the honest non-month buckets + respect bounds',
    !rp.monthInPeriod('unscheduled', q) && !rp.monthInPeriod('unknown', q) &&
    rp.monthInPeriod('2026-07', q) && rp.monthInPeriod('2026-09', q) &&
    !rp.monthInPeriod('2026-06', q) && !rp.monthInPeriod('2026-10', q), '')

  check('22. enrolledByMonth carries the fixture month as a COUNT (manager-safe path)',
    typeof report.enrolledByMonth === 'object' &&
    Object.values(report.enrolledByMonth).every((v) => Number.isInteger(v)) &&
    'enrolledByMonth' in manager, '')
} finally {
  await destroy()
  rmSync(out, { recursive: true, force: true })
  console.log('cleanup done (fixtures removed)')
}
process.exit(failures ? 1 : 0)
