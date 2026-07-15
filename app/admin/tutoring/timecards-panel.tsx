'use client'

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../utils/supabase'
import { ConfirmAction } from './confirm'

// Staff timecard review (Phase 7b §7.3): per-period list, approve, CSV
// export for manual entry into QBO Payroll. Hours only — no pay rates, no
// dollar amounts, anywhere. Flow: open → tutor confirmed → approved →
// exported; the cross-check ritual disappears because the timecard and the
// family invoice derive from the same session rows.

type Row = {
  id: string
  tutor_id: string
  period_start: string
  period_end: string
  status: 'open' | 'tutor_confirmed' | 'approved' | 'exported'
  total_hours: number
  tutor_confirmed_at: string | null
  approved_by: string | null
  approved_at: string | null
  instructors: { name: string | null; email: string } | null
}

const STATUS_STYLES: Record<Row['status'], string> = {
  open: 'bg-amber-100 text-amber-800',
  tutor_confirmed: 'bg-blue-100 text-blue-700',
  approved: 'bg-green-100 text-green-700',
  exported: 'bg-gray-200 text-gray-600',
}

function one<T>(v: T | T[] | null | undefined): T | null {
  if (v == null) return null
  return Array.isArray(v) ? ((v[0] as T) ?? null) : v
}

export default function TimecardsPanel() {
  const [rows, setRows] = useState<Row[]>([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('timecards')
      .select(
        'id, tutor_id, period_start, period_end, status, total_hours, tutor_confirmed_at, approved_by, approved_at, instructors ( name, email )'
      )
      .order('period_start', { ascending: false })
      .limit(120)
    if (!error) {
      /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
      setRows(((data as any[]) ?? []).map((r) => ({ ...r, instructors: one(r.instructors) })))
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function call(body: Record<string, unknown>, done: string) {
    setBusy(true)
    const res = await fetch('/api/admin/tutoring/timecard', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const json = await res.json()
    setBusy(false)
    setMessage(res.ok ? done : 'Error: ' + json.error)
    load()
  }

  /** CSV per spec §7.3 — tutor, period, total hours — then stamp exported. */
  function exportPeriod(periodStart: string) {
    const periodRows = rows.filter((r) => r.period_start === periodStart && r.status === 'approved')
    if (periodRows.length === 0) return
    const csv = [
      'tutor,period_start,period_end,total_hours',
      ...periodRows.map(
        (r) => `"${(r.instructors?.name ?? r.instructors?.email ?? '').replace(/"/g, '""')}",${r.period_start},${r.period_end},${r.total_hours}`
      ),
    ].join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `hgl-timecards-${periodStart}.csv`
    a.click()
    URL.revokeObjectURL(url)
    call(
      { action: 'mark_exported', ids: periodRows.map((r) => r.id) },
      `Exported ${periodRows.length} timecard${periodRows.length === 1 ? '' : 's'} for ${periodStart} — enter the hours in QBO Payroll.`
    )
  }

  // Group by period for display.
  const periods = [...new Set(rows.map((r) => r.period_start))]

  if (rows.length === 0) {
    return (
      <p className="text-sm text-gray-500 italic">
        No timecards yet — the daily sweep creates them when a pay period with sessions closes
        (1st–15th and 16th–end of month).
      </p>
    )
  }

  return (
    <div className="space-y-5 text-sm">
      {periods.map((p) => {
        const periodRows = rows.filter((r) => r.period_start === p)
        const approvedCount = periodRows.filter((r) => r.status === 'approved').length
        return (
          <div key={p} className="border border-gray-200 rounded-lg p-4">
            <div className="flex items-center gap-3 mb-2">
              <span className="font-bold text-hgl-slate">
                {p} → {periodRows[0].period_end}
              </span>
              <span className="text-xs text-gray-400">
                payday the {Number(p.slice(8, 10)) === 1 ? '20th' : '5th'}
              </span>
              {approvedCount > 0 && (
                <button
                  disabled={busy}
                  onClick={() => exportPeriod(p)}
                  className="ml-auto text-xs font-semibold text-hgl-blue underline"
                >
                  Export CSV + mark exported ({approvedCount})
                </button>
              )}
            </div>
            <table className="min-w-full">
              <thead>
                <tr className="text-left text-xs text-gray-400 uppercase tracking-wide">
                  <th className="py-1 pr-4">Tutor</th>
                  <th className="py-1 pr-4">Hours</th>
                  <th className="py-1 pr-4">Status</th>
                  <th className="py-1"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {periodRows.map((r) => (
                  <tr key={r.id}>
                    <td className="py-1.5 pr-4 font-semibold text-hgl-slate">
                      {r.instructors?.name ?? r.instructors?.email}
                    </td>
                    <td className="py-1.5 pr-4">{Number(r.total_hours)}</td>
                    <td className="py-1.5 pr-4">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${STATUS_STYLES[r.status]}`}>
                        {r.status.replace('_', ' ')}
                      </span>
                      {r.status === 'open' && r.tutor_confirmed_at === null && (
                        <span className="text-xs text-gray-400 ml-2">awaiting tutor</span>
                      )}
                      {r.approved_by && (
                        <span className="text-xs text-gray-400 ml-2">by {r.approved_by}</span>
                      )}
                    </td>
                    <td className="py-1.5 text-right whitespace-nowrap">
                      {(r.status === 'open' || r.status === 'tutor_confirmed') && (
                        <ConfirmAction
                          label="approve"
                          message={
                            r.status === 'open'
                              ? 'Tutor has not confirmed yet — approve anyway?'
                              : `Approve ${Number(r.total_hours)} hours?`
                          }
                          confirmLabel="Yes, approve"
                          className="text-green-700 underline text-xs"
                          disabled={busy}
                          onConfirm={() => call({ action: 'approve', ids: [r.id] }, 'Approved.')}
                        />
                      )}
                      {(r.status === 'approved' || r.status === 'exported') && (
                        <ConfirmAction
                          label="reopen"
                          message="Reopen for corrections? It re-totals from the live sessions."
                          confirmLabel="Yes, reopen"
                          className="text-gray-500 underline text-xs"
                          disabled={busy}
                          onConfirm={() => call({ action: 'reopen', ids: [r.id] }, 'Reopened.')}
                        />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      })}

      {message && (
        <div
          className={`p-3 rounded text-center font-semibold ${
            message.startsWith('Error') ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'
          }`}
        >
          {message}
        </div>
      )}
    </div>
  )
}
