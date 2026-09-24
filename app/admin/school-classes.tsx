'use client'

import { useEffect, useState } from 'react'
import { formatDateAdmin } from '../utils/dates'

// PL-503: the Classes section on a school's card — every class ever run at
// the school, newest first; a row expands to roster / scores / attendance
// (the class report's own numbers) + the report and detail links.

type Row = {
  id: string
  slug: string | null
  term: string | null
  classType: string
  status: string
  group: string
  firstSession: string | null
  lastSession: string | null
  instructorName: string | null
  enrolled: number
  paid: number
}
type Detail = {
  classId: string
  status: string
  cancellation: { note: string } | null
  roster: { enrollmentId: string; name: string; parentEmail: string | null; paymentStatus: string; commsState: string }[]
  report: {
    sections: string[]
    students: { id: string; name: string; initial: { total: number } | null; final: { total: number } | null; gained: number | null; attendancePct: number | null }[]
    classAverage: { initial: number | null; final: number | null }
    averageImprovement: number | null
    scored: number
  } | null
  attendance: { averagePct: number; students: number } | null
  links: { detail: string; report: string | null }
}

const GROUP_LABEL: Record<string, string> = { open: 'Open', 'in-progress': 'In progress', upcoming: 'Upcoming', ended: 'Ended', cancelled: 'Cancelled' }

function ClassHistoryDetail({ classId }: { classId: string }) {
  const [detail, setDetail] = useState<Detail | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    fetch(`/api/admin/school-classes?class=${classId}`)
      .then(async (r) => {
        const j = await r.json().catch(() => ({}))
        if (!r.ok) setError(j.error ?? `HTTP ${r.status}`)
        else setDetail(j.detail)
      })
      .catch((e) => setError(String(e)))
  }, [classId])
  if (error) return <p className="text-xs text-red-600">{error}</p>
  if (!detail) return <p className="text-xs text-gray-500 animate-pulse">Loading…</p>
  const scoresById = new Map((detail.report?.students ?? []).map((s) => [s.name, s]))
  return (
    <div className="mt-2 space-y-3 text-xs" data-testid="school-class-detail">
      {detail.cancellation && (
        <p className="rounded bg-amber-50 border border-amber-200 text-amber-800 px-3 py-2" data-testid="cancellation-note">{detail.cancellation.note}</p>
      )}
      <div className="flex gap-3">
        <a href={detail.links.detail} className="text-hgl-blue underline">Class detail →</a>
        {detail.links.report && <a href={detail.links.report} target="_blank" rel="noreferrer" className="text-hgl-blue underline">Class report →</a>}
      </div>
      {detail.report && detail.report.scored > 0 && (
        <p className="text-gray-700" data-testid="class-score-summary">
          Scores: class average {detail.report.classAverage.initial ?? '—'} → {detail.report.classAverage.final ?? '—'}
          {detail.report.averageImprovement != null && <> · average improvement <strong>{detail.report.averageImprovement > 0 ? '+' : ''}{detail.report.averageImprovement}</strong></>}
          {' '}({detail.report.scored} scored)
          {detail.attendance && <> · attendance {detail.attendance.averagePct}% avg ({detail.attendance.students} tracked)</>}
        </p>
      )}
      {detail.roster.length === 0 ? (
        <p className="text-gray-500 italic">No roster.</p>
      ) : (
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-100">
            <tr>
              {['Student', 'Parent email', 'Payment', 'Comms', ...(detail.report ? ['Diag.', 'Final', 'Δ', 'Attend.'] : [])].map((h) => (
                <th key={h} className="px-2 py-1 text-left font-bold text-hgl-slate uppercase tracking-wider text-[10px]">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {detail.roster.map((r) => {
              const sc = scoresById.get(r.name)
              return (
                <tr key={r.enrollmentId} data-testid="school-class-roster-row">
                  <td className="px-2 py-1">{r.name}</td>
                  <td className="px-2 py-1 text-gray-600">{r.parentEmail ?? '—'}</td>
                  <td className="px-2 py-1">{r.paymentStatus}</td>
                  <td className="px-2 py-1 text-gray-600">{r.commsState}</td>
                  {detail.report && (
                    <>
                      <td className="px-2 py-1">{sc?.initial?.total ?? '—'}</td>
                      <td className="px-2 py-1">{sc?.final?.total ?? '—'}</td>
                      <td className="px-2 py-1">{sc?.gained != null ? `${sc.gained > 0 ? '+' : ''}${sc.gained}` : '—'}</td>
                      <td className="px-2 py-1">{sc?.attendancePct != null ? `${sc.attendancePct}%` : '—'}</td>
                    </>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}

export default function SchoolClasses({ schoolId }: { schoolId: string }) {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  useEffect(() => {
    fetch(`/api/admin/school-classes?school=${schoolId}`)
      .then((r) => (r.ok ? r.json() : { rows: [] }))
      .then((j) => setRows(j.rows ?? []))
      .catch(() => setRows([]))
  }, [schoolId])
  return (
    <div className="mt-3" data-testid="school-classes">
      <p className="text-xs font-bold text-hgl-slate uppercase tracking-wider">Classes{rows ? ` (${rows.length})` : ''}</p>
      {rows === null ? (
        <p className="text-xs text-gray-500 animate-pulse">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-gray-500 italic mt-1">No class has run at this school yet.</p>
      ) : (
        <ul className="mt-1 divide-y divide-gray-100 border border-gray-100 rounded">
          {rows.map((r) => (
            <li key={r.id} data-testid="school-class-row" data-status={r.status} data-group={r.group}>
              <button
                type="button"
                onClick={() => setOpenId(openId === r.id ? null : r.id)}
                className="w-full text-left px-3 py-2 text-xs flex flex-wrap items-center gap-x-3 gap-y-1 hover:bg-gray-50"
                aria-expanded={openId === r.id}
              >
                <span className="font-semibold text-hgl-slate">{r.term ?? '—'}</span>
                <span>{r.classType}</span>
                <span className="text-gray-600">
                  {r.firstSession ? formatDateAdmin(r.firstSession) : '—'}{r.lastSession && r.lastSession !== r.firstSession ? ` – ${formatDateAdmin(r.lastSession)}` : ''}
                </span>
                <span className="text-gray-600">{r.instructorName ?? 'no instructor'}</span>
                <span className="text-gray-600">{r.paid} paid / {r.enrolled} enrolled</span>
                <span className={`ml-auto rounded-full px-2 py-0.5 text-[10px] font-bold ${r.status === 'cancelled' ? 'bg-red-100 text-red-700' : r.group === 'ended' ? 'bg-gray-200 text-gray-700' : 'bg-green-100 text-green-800'}`}>
                  {GROUP_LABEL[r.group] ?? r.status}
                </span>
              </button>
              {openId === r.id && (
                <div className="px-3 pb-3">
                  <ClassHistoryDetail classId={r.id} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
