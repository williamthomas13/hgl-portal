'use client'

import { useEffect, useState } from 'react'

// PL-471 D: the every-audience pre-flight on the Scheduled view. The rows
// on the tab are the FAMILY sequence (Feature A). This panel asks the
// projector what the next N hours' sweeps would send to instructors, school
// contacts, staff, tutors (timecards) and calendars — from the same rules the
// sweeps run on — so "what will send?" is answerable before a data change,
// not discovered in the send log afterwards.

type Row = {
  audience: string
  template: string
  to: string
  when: string
  classLabel: string | null
  dedupeKey: string | null
  why: string
  state?: 'held'
}
type Report = { hours: number; rows: Row[]; notes: string[]; quiet: { classLabel: string; reason: string }[] }

const AUDIENCE_STYLES: Record<string, string> = {
  family: 'bg-blue-100 text-blue-700',
  instructor: 'bg-purple-100 text-purple-700',
  school: 'bg-emerald-100 text-emerald-700',
  staff: 'bg-amber-100 text-amber-800',
  timecard: 'bg-pink-100 text-pink-700',
  calendar: 'bg-slate-200 text-slate-700',
}

export default function ProjectionPanel({ classId }: { classId: string | null }) {
  const [hours, setHours] = useState(24)
  const [report, setReport] = useState<Report | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [open, setOpen] = useState(true)

  useEffect(() => {
    let stale = false
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true)
    setError('')
    ;(async () => {
      try {
        const res = await fetch(`/api/admin/comms/projection?hours=${hours}${classId ? `&class=${classId}` : ''}`)
        const json = await res.json().catch(() => ({}))
        if (stale) return
        if (!res.ok) setError(json.error ?? `Projection failed (${res.status})`)
        else setReport(json)
      } catch (e) {
        if (!stale) setError(String(e))
      }
      if (!stale) setLoading(false)
    })()
    return () => {
      stale = true
    }
  }, [hours, classId])

  const nonFamily = (report?.rows ?? []).filter((r) => r.audience !== 'family')
  const familyCount = (report?.rows ?? []).filter((r) => r.audience === 'family').length

  return (
    <div className="bg-white border border-gray-200 rounded-lg" data-testid="send-projection">
      <div className="flex items-center justify-between gap-3 px-4 py-3 flex-wrap">
        <button type="button" onClick={() => setOpen((o) => !o)} className="text-left">
          <span className="font-bold text-hgl-slate">Every audience — what the next</span>{' '}
          <select
            value={hours}
            onChange={(e) => setHours(Number(e.target.value))}
            onClick={(e) => e.stopPropagation()}
            className="border rounded p-1 text-sm"
          >
            {[6, 12, 24, 48, 72, 168].map((h) => (
              <option key={h} value={h}>
                {h < 48 ? `${h} hours` : `${h / 24} days`}
              </option>
            ))}
          </select>{' '}
          <span className="font-bold text-hgl-slate">of sweeps would send</span>
          <span className="ml-2 text-xs text-gray-500">
            {loading ? 'projecting…' : report ? `${nonFamily.length} beyond families · ${familyCount} family rows (the table below)` : ''}
          </span>
        </button>
        <span className="text-xs text-gray-500">
          Instructors · school contacts · staff alerts · timecards · calendar writes. Read-only — projected from the sweep rules, nothing here sends.
        </span>
      </div>
      {open && (
        <div className="border-t border-gray-100 px-4 py-3 text-sm">
          {error && <p className="text-red-700">{error}</p>}
          {!error && report && nonFamily.length === 0 && (
            <p className="text-gray-500 italic">Nothing beyond the family sequence is due in this window.</p>
          )}
          {!error && nonFamily.length > 0 && (
            <table className="min-w-full text-xs">
              <thead className="text-gray-500">
                <tr>
                  <th className="text-left py-1 pr-3">When (UTC)</th>
                  <th className="text-left py-1 pr-3">Audience</th>
                  <th className="text-left py-1 pr-3">What</th>
                  <th className="text-left py-1 pr-3">To</th>
                  <th className="text-left py-1 pr-3">Class</th>
                  <th className="text-left py-1">Why</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {nonFamily.map((r, i) => (
                  <tr key={`${r.dedupeKey ?? r.template}-${i}`} data-testid="projected-send">
                    <td className="py-1 pr-3 whitespace-nowrap">{r.when.slice(0, 16).replace('T', ' ')}</td>
                    <td className="py-1 pr-3">
                      <span className={`inline-block px-1.5 py-0.5 rounded font-semibold ${AUDIENCE_STYLES[r.audience] ?? 'bg-gray-100'}`}>{r.audience}</span>
                      {r.state === 'held' && <span className="ml-1 text-amber-700 font-semibold">held</span>}
                    </td>
                    <td className="py-1 pr-3 font-mono">{r.template}</td>
                    <td className="py-1 pr-3">{r.to}</td>
                    <td className="py-1 pr-3">{r.classLabel ?? '—'}</td>
                    <td className="py-1 text-gray-600">{r.why}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {report && report.quiet.length > 0 && (
            <p className="mt-3 text-xs text-gray-500">
              <strong>Quiet classes</strong> (nothing class-keyed will send):{' '}
              {report.quiet.map((q) => `${q.classLabel} — ${q.reason}`).join(' · ')}
            </p>
          )}
          {report && report.notes.length > 0 && (
            <ul className="mt-2 text-xs text-gray-400 list-disc pl-4 space-y-0.5">
              {report.notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
