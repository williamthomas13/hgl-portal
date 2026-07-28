'use client'

import { useCallback, useEffect, useState } from 'react'

// PL-218: the tutor hours breakdown — Scarlett's hand-built Google-Calendar
// spreadsheet (per-tutor tabs, work-category rows × month columns,
// in-person/online split, revenue) computed from portal data. Hours + list
// revenue only, NEVER wages: pay rates live in QBO, and the CSV's stable
// category keys are the join handle for that QBO-side math. Managers get the
// hours-only payload (the API strips dollars server-side).

/* eslint-disable @typescript-eslint/no-explicit-any */

const money = (n: number | undefined) =>
  n == null ? '' : `$${Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 })}`

const monthLabel = (m: string) =>
  new Date(`${m}-15T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' })

export default function TutorHoursReportPage() {
  const now = new Date()
  const thisMonth = now.toISOString().slice(0, 7)
  const yearAgo = new Date(now.getFullYear() - 1, now.getMonth(), 1)
  const defaultFrom = `${yearAgo.getFullYear()}-${String(yearAgo.getMonth() + 1).padStart(2, '0')}`

  const [tutor, setTutor] = useState('all')
  const [from, setFrom] = useState(defaultFrom)
  const [to, setTo] = useState(thisMonth)
  const [report, setReport] = useState<any>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(
        `/api/admin/tutor-hours?tutor=${encodeURIComponent(tutor)}&from=${from}&to=${to}`
      )
      const json = await res.json().catch(() => ({}))
      if (!res.ok) setError(json.error ?? `The server returned ${res.status}.`)
      else setReport(json)
    } catch {
      setError("Couldn't load the report.")
    } finally {
      setLoading(false)
    }
  }, [tutor, from, to])

  useEffect(() => {
    load()
  }, [load])

  const isAdmin = report?.role === 'admin'
  const months: string[] = report?.months ?? []
  const rows: any[] = report?.rows ?? []
  const split = report?.split

  function exportCsv() {
    if (!report) return
    const head = [
      'category_key',
      'category',
      ...months,
      'total_hours',
      'avg_hours_per_month',
      ...(isAdmin ? ['revenue_paid', 'list_rate'] : []),
    ]
    const lines = rows.map((r) => [
      r.key,
      `"${String(r.label).replace(/"/g, '""')}"`,
      ...months.map((m) => r.hoursByMonth[m] ?? 0),
      r.totalHours,
      r.avgHoursPerMonth,
      ...(isAdmin ? [r.revenue ?? 0, r.listRate ?? ''] : []),
    ])
    lines.push([
      'total',
      'Total',
      ...months.map((m) => report.totalsByMonth[m] ?? 0),
      report.grandTotalHours,
      '',
      ...(isAdmin ? ['', ''] : []),
    ])
    const csv = [head.join(','), ...lines.map((l) => l.join(','))].join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    const a = document.createElement('a')
    a.href = url
    const tutorName =
      tutor === 'all' ? 'all-tutors' : (report.tutors.find((t: any) => t.id === tutor)?.name ?? 'tutor').replace(/\s+/g, '-')
    a.download = `hgl-tutor-hours-${tutorName}-${from}-to-${to}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="min-h-screen bg-gray-50 p-10">
      <div className="max-w-6xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-hgl-slate">Tutor hours breakdown</h1>
          <p className="text-sm text-gray-500 mt-1">
            Hours by work category and month, from the same session records timecards and invoices
            use{isAdmin ? '; revenue is the paid, session-linked invoice dollars (QBO-sync source)' : ''}.
            No wages here — pay rates and wage math live in QuickBooks (export the CSV and join on
            the category key).{' '}
            <a href="/admin/report" className="text-hgl-blue underline">
              Term report →
            </a>
          </p>
          {report?.earliestSession && (
            <p className="text-xs text-gray-500 mt-1">
              Portal history starts {report.earliestSession} — earlier months are empty because the
              data predates the portal, not because nothing happened.
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-end gap-3 text-sm">
          <label className="block">
            <span className="block text-xs font-semibold text-gray-600 mb-1">Tutor</span>
            <select
              value={tutor}
              onChange={(e) => setTutor(e.target.value)}
              className="border border-gray-300 rounded p-2"
            >
              <option value="all">All tutors</option>
              {(report?.tutors ?? []).map((t: any) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="block text-xs font-semibold text-gray-600 mb-1">From</span>
            <input
              type="month"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="border border-gray-300 rounded p-2"
            />
          </label>
          <label className="block">
            <span className="block text-xs font-semibold text-gray-600 mb-1">To</span>
            <input
              type="month"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="border border-gray-300 rounded p-2"
            />
          </label>
          <button
            onClick={exportCsv}
            disabled={!report || rows.length === 0}
            className="bg-hgl-slate text-white font-semibold rounded px-4 py-2 disabled:opacity-50"
          >
            Export CSV
          </button>
        </div>

        {error && <div className="p-3 rounded bg-red-100 text-red-700 font-semibold">{error}</div>}
        {loading && !report && <p className="text-sm text-gray-500 animate-pulse">Loading…</p>}

        {report && rows.length === 0 && !loading && (
          <p className="text-sm text-gray-500 italic">
            No payable hours in this range for this selection.
          </p>
        )}

        {report && rows.length > 0 && (
          <div className="bg-white rounded-lg border border-gray-200 p-4 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 uppercase tracking-wide">
                  <th className="py-1.5 pr-4">Category</th>
                  {months.map((m) => (
                    <th key={m} className="py-1.5 pr-3 text-right">
                      {monthLabel(m)}
                    </th>
                  ))}
                  <th className="py-1.5 pr-3 text-right">Total</th>
                  <th className="py-1.5 pr-3 text-right">Avg/mo</th>
                  {isAdmin && <th className="py-1.5 pr-3 text-right">Paid revenue</th>}
                  {isAdmin && <th className="py-1.5 text-right">List rate</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((r) => (
                  <tr key={r.key}>
                    <td className="py-1.5 pr-4 font-semibold text-hgl-slate">{r.label}</td>
                    {months.map((m) => (
                      <td key={m} className="py-1.5 pr-3 text-right text-gray-700">
                        {r.hoursByMonth[m] ? r.hoursByMonth[m] : ''}
                      </td>
                    ))}
                    <td className="py-1.5 pr-3 text-right font-semibold">{r.totalHours}</td>
                    <td className="py-1.5 pr-3 text-right text-gray-600">{r.avgHoursPerMonth}</td>
                    {isAdmin && (
                      <td className="py-1.5 pr-3 text-right text-gray-700">{money(r.revenue)}</td>
                    )}
                    {isAdmin && (
                      <td className="py-1.5 text-right text-gray-600">
                        {r.listRate != null ? `$${r.listRate}/hr` : ''}
                      </td>
                    )}
                  </tr>
                ))}
                <tr className="border-t-2 border-gray-300">
                  <td className="py-1.5 pr-4 font-bold text-hgl-slate">Total</td>
                  {months.map((m) => (
                    <td key={m} className="py-1.5 pr-3 text-right font-bold">
                      {report.totalsByMonth[m] || ''}
                    </td>
                  ))}
                  <td className="py-1.5 pr-3 text-right font-bold">{report.grandTotalHours}</td>
                  <td />
                  {isAdmin && <td />}
                  {isAdmin && <td />}
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {report && split && (report.grandTotalHours ?? 0) > 0 && (
          <div className="bg-white rounded-lg border border-gray-200 p-4 text-sm">
            <p className="font-semibold text-hgl-slate mb-1">In-person vs online</p>
            <p className="text-gray-700">
              {(['inPersonHours', 'onlineHours', 'unknownHours'] as const)
                .filter((k) => split[k] > 0)
                .map((k) => {
                  const label =
                    k === 'inPersonHours' ? 'In person' : k === 'onlineHours' ? 'Online' : 'No location recorded'
                  const pct = Math.round((split[k] / report.grandTotalHours) * 100)
                  return `${label}: ${split[k]} h (${pct}%)`
                })
                .join(' · ')}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
