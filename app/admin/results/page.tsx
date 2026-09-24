'use client'

import { useEffect, useState } from 'react'
import { SidebarNav, CLASSES_SIDEBAR } from '../sidebar'
import type { Bucket, ResultsAggregate } from '../../utils/results-aggregate'

// PL-504 (Scarlett, Sep 24): Results — the all-time score aggregate that did
// not exist (there were only per-class reports). Marketing block on top:
// the three numbers for the website, each with its n and date range so it
// is defensible. Then per-school / per-term / per-class tables, a bar per
// class and a line across terms (inline SVG — no chart dependency), CSV.

const fmt = (n: number | null | undefined, plus = false) => (n == null ? '—' : `${plus && n > 0 ? '+' : ''}${n}`)
const range = (a: string | null, b: string | null) => (a && b ? (a.slice(0, 7) === b.slice(0, 7) ? a.slice(0, 7) : `${a.slice(0, 7)} – ${b.slice(0, 7)}`) : a ?? b ?? '—')

function BucketTable({ title, rows, testId }: { title: string; rows: Bucket[]; testId: string }) {
  return (
    <div className="bg-white rounded-lg shadow-sm p-4" data-testid={testId}>
      <h2 className="font-bold text-hgl-slate mb-2">{title}</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-gray-500 italic">No scores yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-100 text-[11px] uppercase tracking-wider text-hgl-slate">
              <tr>{['', 'Dates', 'Scored', 'With final', 'Improved', 'Avg diagnostic', 'Avg final', 'Avg Δ total', 'Δ R&W', 'Δ Math'].map((h) => <th key={h} className="px-2 py-1 text-left font-bold">{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((b) => (
                <tr key={b.key} data-testid={`${testId}-row`} data-key={b.key}>
                  <td className="px-2 py-1 font-semibold">{b.label}</td>
                  <td className="px-2 py-1 text-gray-600">{range(b.from, b.to)}</td>
                  <td className="px-2 py-1">{b.scored}</td>
                  <td className="px-2 py-1">{b.withFinal}</td>
                  <td className="px-2 py-1">{b.pctImproved == null ? '—' : `${b.pctImproved}% (${b.improved}/${b.withFinal})`}</td>
                  <td className="px-2 py-1">{fmt(b.avgInitial)}</td>
                  <td className="px-2 py-1">{fmt(b.avgFinal)}</td>
                  <td className="px-2 py-1 font-semibold">{fmt(b.avgImprovement, true)}</td>
                  <td className="px-2 py-1">{fmt(b.bySection['Reading & Writing']?.avgImprovement, true)}</td>
                  <td className="px-2 py-1">{fmt(b.bySection['Math']?.avgImprovement, true)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function BarChart({ rows }: { rows: ResultsAggregate['byClass'] }) {
  const data = rows.filter((r) => r.avgImprovement != null)
  if (data.length === 0) return null
  const W = Math.max(320, data.length * 64), H = 200, pad = 28
  const max = Math.max(1, ...data.map((d) => Math.abs(d.avgImprovement!)))
  const y0 = H - pad
  const scale = (H - pad * 2) / max
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-full h-auto" role="img" aria-label="Average improvement per class" data-testid="results-bar-chart">
      <line x1={0} x2={W} y1={y0} y2={y0} stroke="#cbd5e1" />
      {data.map((d, i) => {
        const h = Math.max(1, d.avgImprovement! * scale)
        const x = i * 64 + 16
        return (
          <g key={d.key}>
            <rect x={x} y={d.avgImprovement! >= 0 ? y0 - h : y0} width={32} height={h} fill={d.avgImprovement! >= 0 ? '#00AEEE' : '#ef4444'} rx={3} />
            <text x={x + 16} y={(d.avgImprovement! >= 0 ? y0 - h : y0 + h) + (d.avgImprovement! >= 0 ? -4 : 12)} textAnchor="middle" fontSize="10" fill="#334155">{fmt(d.avgImprovement, true)}</text>
            <text x={x + 16} y={H - 8} textAnchor="middle" fontSize="9" fill="#64748b">{(d.school ?? 'HGL').slice(0, 8)} {d.term ?? ''}</text>
          </g>
        )
      })}
    </svg>
  )
}

function LineChart({ rows }: { rows: Bucket[] }) {
  const data = rows.filter((r) => r.avgImprovement != null)
  if (data.length < 2) return null
  const W = 480, H = 160, pad = 28
  const vals = data.map((d) => d.avgImprovement!)
  const lo = Math.min(0, ...vals), hi = Math.max(1, ...vals)
  const x = (i: number) => pad + (i * (W - pad * 2)) / (data.length - 1)
  const y = (v: number) => H - pad - ((v - lo) * (H - pad * 2)) / (hi - lo || 1)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-xl h-auto" role="img" aria-label="Average improvement by term" data-testid="results-line-chart">
      <polyline fill="none" stroke="#506171" strokeWidth={2} points={data.map((d, i) => `${x(i)},${y(d.avgImprovement!)}`).join(' ')} />
      {data.map((d, i) => (
        <g key={d.key}>
          <circle cx={x(i)} cy={y(d.avgImprovement!)} r={3.5} fill="#00AEEE" />
          <text x={x(i)} y={y(d.avgImprovement!) - 8} textAnchor="middle" fontSize="10" fill="#334155">{fmt(d.avgImprovement, true)}</text>
          <text x={x(i)} y={H - 8} textAnchor="middle" fontSize="9" fill="#64748b">{d.label}</text>
        </g>
      ))}
    </svg>
  )
}

export default function ResultsPage() {
  const [agg, setAgg] = useState<ResultsAggregate | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    fetch('/api/admin/results')
      .then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) setError(j.error ?? `HTTP ${r.status}`); else setAgg(j.results) })
      .catch((e) => setError(String(e)))
  }, [])
  const m = agg?.marketing
  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto md:flex md:gap-6 md:items-start">
        <SidebarNav entries={CLASSES_SIDEBAR} active="results" />
        <div className="flex-1 min-w-0 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <h1 className="text-2xl font-bold text-hgl-slate">Results</h1>
              <p className="text-sm text-gray-500">All-time score outcomes across every class — diagnostic → final. Same numbers as the per-class reports, folded together.</p>
            </div>
            {/* a real download, not a client navigation — the API route streams text/csv */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a href="/api/admin/results?csv=1" className="text-sm font-semibold text-white bg-hgl-blue rounded px-3 py-1.5 hover:opacity-90" data-testid="results-csv">Export CSV</a>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          {!agg && !error && <p className="text-sm text-gray-500 animate-pulse">Loading…</p>}
          {agg && m && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4" data-testid="results-marketing">
                {[
                  { label: 'Average improvement', value: fmt(m.avgImprovement, true), n: `${m.n} students with a diagnostic and a final`, id: 'avg' },
                  { label: 'Students who improved', value: m.pctImproved == null ? '—' : `${m.pctImproved}%`, n: `of ${m.n} with both tests`, id: 'pct' },
                  { label: 'Students served', value: String(m.studentsServed), n: 'with at least one recorded score', id: 'served' },
                ].map((t) => (
                  <div key={t.id} className="bg-white rounded-lg shadow-sm p-4" data-testid={`marketing-${t.id}`}>
                    <p className="text-xs uppercase tracking-wider text-gray-500">{t.label}</p>
                    <p className="text-3xl font-bold text-hgl-slate mt-1" data-value>{t.value}</p>
                    <p className="text-xs text-gray-500 mt-1">{t.n} · {range(m.from, m.to)}</p>
                  </div>
                ))}
              </div>
              <div className="bg-white rounded-lg shadow-sm p-4">
                <h2 className="font-bold text-hgl-slate mb-2">Average improvement per class</h2>
                <BarChart rows={agg.byClass} />
                <h2 className="font-bold text-hgl-slate mt-4 mb-2">Trend by term</h2>
                <LineChart rows={agg.byTerm} />
              </div>
              <BucketTable title="By school" rows={agg.bySchool} testId="results-by-school" />
              <BucketTable title="By term" rows={agg.byTerm} testId="results-by-term" />
              <BucketTable title="By class" rows={agg.byClass} testId="results-by-class" />
            </>
          )}
        </div>
      </div>
    </div>
  )
}
