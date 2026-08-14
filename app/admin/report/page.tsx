'use client'

import { useEffect, useMemo, useState } from 'react'

// PL-204: "how's this term going" without opening QuickBooks. Plain tables
// with totals, filters compose (school × month × class type), read-only,
// rows deep-link their class/tutoring pages. The API decides what this page
// can even see: admins get the revenue view + enrollment view; managers get
// enrollment only (their payload carries no dollar fields at all).

/* eslint-disable @typescript-eslint/no-explicit-any */

const money = (n: number | undefined) =>
  n == null ? '' : `$${Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 })}`

export default function TermReportPage() {
  const [report, setReport] = useState<any>(null)
  const [error, setError] = useState('')
  const [school, setSchool] = useState('')
  const [month, setMonth] = useState('')
  const [classType, setClassType] = useState('')

  useEffect(() => {
    fetch('/api/admin/report')
      .then(async (r) => {
        const j = await r.json().catch(() => ({}))
        if (!r.ok) setError(j.error ?? `The server returned ${r.status}.`)
        else setReport(j)
      })
      .catch(() => setError("Couldn't load the report."))
  }, [])

  const isAdmin = report?.role === 'admin'
  const classes: any[] = useMemo(() => report?.classes ?? [], [report])
  const schools = [...new Set(classes.map((c) => c.school))].sort()
  const months = [...new Set(classes.map((c) => c.month))].sort().reverse()
  const types = [...new Set(classes.map((c) => c.classType))].sort()

  const filtered = classes.filter(
    (c) =>
      (!school || c.school === school) &&
      (!month || c.month === month) &&
      (!classType || c.classType === classType)
  )
  const filteredRevenue = filtered.reduce((s, c) => s + (c.revenue ?? 0), 0)
  const filteredEnrolled = filtered.reduce((s, c) => s + c.enrolled, 0)

  return (
    <div className="min-h-screen bg-gray-50 p-10">
      <div className="max-w-5xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-hgl-slate">
            {isAdmin ? 'Revenue & enrollment' : 'Enrollment'}
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Computed from the same paid records QuickBooks sync reads — the numbers can&apos;t disagree with QBO.
            Read-only{isAdmin ? '' : ' · enrollment view'}.{' '}
            {/* PL-218: the spreadsheet replacement lives beside this report. */}
            <a href="/admin/report/tutor-hours" className="text-hgl-blue underline">
              Tutor hours breakdown →
            </a>
          </p>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}
        {!report && !error && <p className="text-sm text-gray-500">Loading…</p>}

        {report && (
          <>
            {/* Filters compose. */}
            <div className="flex flex-wrap gap-2 text-sm">
              <select value={school} onChange={(e) => setSchool(e.target.value)} className="border border-gray-300 rounded p-1.5 bg-white">
                <option value="">All schools</option>
                {schools.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <select value={month} onChange={(e) => setMonth(e.target.value)} className="border border-gray-300 rounded p-1.5 bg-white">
                <option value="">All months</option>
                {months.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
              <select value={classType} onChange={(e) => setClassType(e.target.value)} className="border border-gray-300 rounded p-1.5 bg-white">
                <option value="">All class types</option>
                {types.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>

            <div id="classes" className="bg-white rounded-lg shadow-md p-5">
              <h2 className="text-lg font-bold text-hgl-slate mb-3">Classes</h2>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs font-bold text-gray-500 uppercase tracking-wide border-b border-gray-200">
                      <th className="py-2 pr-4">Class</th>
                      <th className="py-2 pr-4">Month</th>
                      <th className="py-2 pr-4">Enrolled</th>
                      <th className="py-2 pr-4">Capacity</th>
                      <th className="py-2 pr-4">Minimum</th>
                      {isAdmin && <th className="py-2 pr-4 text-right">Paid revenue</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filtered.map((c) => (
                      <tr key={c.id}>
                        <td className="py-2 pr-4">
                          <a href={`/admin?class=${c.id}`} className="text-hgl-blue underline">
                            {c.school} {c.classType}
                          </a>
                          {c.status !== 'open' && <span className="text-xs text-gray-400 ml-1.5">{c.status}</span>}
                        </td>
                        <td className="py-2 pr-4">{c.month}</td>
                        <td className={`py-2 pr-4 font-semibold ${c.minEnrollment != null && c.enrolled < c.minEnrollment ? 'text-amber-700' : ''}`}>
                          {c.enrolled}
                        </td>
                        <td className="py-2 pr-4 text-gray-500">{c.capacity ?? '—'}</td>
                        <td className="py-2 pr-4 text-gray-500">{c.minEnrollment ?? '—'}</td>
                        {isAdmin && <td className="py-2 pr-4 text-right font-semibold">{money(c.revenue)}</td>}
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-gray-300 font-bold text-hgl-slate">
                      <td className="py-2 pr-4">Total ({filtered.length} class{filtered.length === 1 ? '' : 'es'})</td>
                      <td />
                      <td className="py-2 pr-4">{filteredEnrolled}</td>
                      <td colSpan={2} />
                      {isAdmin && <td className="py-2 pr-4 text-right">{money(filteredRevenue)}</td>}
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div id="tutoring" className="bg-white rounded-lg shadow-md p-5">
                <h2 className="text-lg font-bold text-hgl-slate mb-3">1-on-1 tutoring</h2>
                <p className="text-xs text-gray-500 mb-2">
                  {report.activeEngagements} active engagement{report.activeEngagements === 1 ? '' : 's'} · paid invoices by month
                </p>
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs font-bold text-gray-500 uppercase tracking-wide border-b border-gray-200">
                      <th className="py-2 pr-4">Month</th>
                      <th className="py-2 pr-4">Invoices paid</th>
                      {isAdmin && <th className="py-2 pr-4 text-right">Revenue</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {(report.tutoringByMonth ?? []).map((t: any) => (
                      <tr key={t.month}>
                        <td className="py-2 pr-4">
                          <a href="/admin/tutoring" className="text-hgl-blue underline">{t.month}</a>
                        </td>
                        <td className="py-2 pr-4">{t.invoicesPaid}</td>
                        {isAdmin && <td className="py-2 pr-4 text-right font-semibold">{money(t.revenue)}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div id="packages" className="bg-white rounded-lg shadow-md p-5">
                <h2 className="text-lg font-bold text-hgl-slate mb-3">Hours packages</h2>
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs font-bold text-gray-500 uppercase tracking-wide border-b border-gray-200">
                      <th className="py-2 pr-4">Month</th>
                      <th className="py-2 pr-4">Sold</th>
                      <th className="py-2 pr-4">Hours</th>
                      <th className="py-2 pr-4">Used up</th>
                      {isAdmin && <th className="py-2 pr-4 text-right">Revenue</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {(report.packages ?? []).map((p: any) => (
                      <tr key={p.month}>
                        <td className="py-2 pr-4">{p.month}</td>
                        <td className="py-2 pr-4">{p.sold}</td>
                        <td className="py-2 pr-4">{p.hours}</td>
                        <td className="py-2 pr-4">{p.exhausted}</td>
                        {isAdmin && <td className="py-2 pr-4 text-right font-semibold">{money(p.revenue)}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {isAdmin && report.totals && (
              <div id="totals" className="bg-white rounded-lg shadow-md border-t-4 border-hgl-slate p-5 text-sm">
                <h2 className="text-lg font-bold text-hgl-slate mb-2">All-time totals</h2>
                <div className="flex flex-wrap gap-x-8 gap-y-1">
                  <span>Classes: <strong>{money(report.totals.classRevenue)}</strong></span>
                  <span>Tutoring invoices: <strong>{money(report.totals.tutoringRevenue)}</strong></span>
                  <span>Packages: <strong>{money(report.totals.packageRevenue)}</strong></span>
                  <span className="text-hgl-slate">Everything: <strong>{money(report.totals.grand)}</strong></span>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
