// Shared bits for the three portal views (server-rendered).

import { formatDateFull, formatDateShort } from '../utils/dates'

export const formatDate = formatDateFull
export { formatDateShort }

const STATUS_STYLES: Record<string, string> = {
  Pending: 'bg-amber-100 text-amber-800',
  Paid: 'bg-green-100 text-green-800',
  Completed: 'bg-blue-100 text-blue-800',
  Expired: 'bg-gray-100 text-gray-500',
  Waitlisted: 'bg-purple-100 text-purple-800',
  Refunded: 'bg-gray-100 text-gray-500',
}

export function StatusBadge({ status, detail }: { status: string; detail?: string }) {
  return (
    <span
      className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-bold ${
        STATUS_STYLES[status] ?? 'bg-gray-100 text-gray-600'
      }`}
    >
      {status}
      {detail ? ` · ${detail}` : ''}
    </span>
  )
}

export type ScoreRow = {
  id: string
  test_label: string
  section_scores: Record<string, number | string> | null
  total: number | null
  taken_at: string | null
  class_id?: string | null
  student_id?: string
}

/** Diagnostic-score table (§6 display layer). Renders nothing when empty —
 * the feature ships dark until score ingestion exists. */
export function ScoresTable({ scores }: { scores: ScoreRow[] }) {
  if (scores.length === 0) return null
  return (
    <div className="mt-2">
      <h4 className="text-sm font-semibold text-hgl-slate mb-1">Diagnostic scores</h4>
      <table className="w-full text-sm border border-gray-200 rounded">
        <thead>
          <tr className="bg-gray-50 text-left text-xs text-gray-500 uppercase">
            <th className="px-2 py-1.5">Test</th>
            <th className="px-2 py-1.5">Sections</th>
            <th className="px-2 py-1.5">Total</th>
            <th className="px-2 py-1.5">Date</th>
          </tr>
        </thead>
        <tbody>
          {scores.map((s) => (
            <tr key={s.id} className="border-t border-gray-100">
              <td className="px-2 py-1.5 font-semibold text-hgl-slate">{s.test_label}</td>
              <td className="px-2 py-1.5 text-gray-600">
                {s.section_scores
                  ? Object.entries(s.section_scores)
                      .map(([k, v]) => `${k}: ${v}`)
                      .join(' · ')
                  : '—'}
              </td>
              <td className="px-2 py-1.5 font-bold text-hgl-slate">{s.total ?? '—'}</td>
              <td className="px-2 py-1.5 text-gray-600">
                {s.taken_at ? formatDateShort(s.taken_at) : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** One-of PostgREST embeds: `x` may come back as object or single-item array. */
export function one<T>(v: T | T[] | null | undefined): T | null {
  if (v == null) return null
  return Array.isArray(v) ? (v[0] ?? null) : v
}
