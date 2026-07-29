import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '../../utils/supabase-server'
import {
  canViewClassReport,
  loadClassReport,
  type ClassReport,
} from '../../utils/class-report'
import { formatDate } from '../../portal/shared'

// PL-219 v1: the per-class performance report, computed from live data.
// One page, three audiences — counselors (their school's classes),
// instructors (their own classes), staff (all) — the SAME role trust
// boundary as rosters and scores today. Charts are plain SVG in the portal
// palette, readable on screen and in print. Honest data: a skipped test is
// a blank cell, never a zero.

export const dynamic = 'force-dynamic'

const BLUE = '#00AEEE'
const SLATE = '#334155'
const GRAY = '#cbd5e1'

function BarChart({
  title,
  groups,
  seriesLabels,
  maxHint,
}: {
  title: string
  groups: { label: string; values: (number | null)[] }[]
  seriesLabels: string[]
  maxHint?: number
}) {
  const colors = [GRAY, BLUE, SLATE]
  const values = groups.flatMap((g) => g.values).filter((v): v is number => v != null)
  if (values.length === 0) return null
  const max = Math.max(maxHint ?? 0, ...values) * 1.08
  const groupW = Math.max(56, seriesLabels.length * 26)
  const width = Math.max(320, groups.length * (groupW + 16) + 40)
  const height = 190
  const plotH = 130
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4 overflow-x-auto print:break-inside-avoid">
      <p className="text-sm font-bold text-hgl-slate mb-1">{title}</p>
      <svg width={width} height={height} role="img" aria-label={title}>
        <line x1={8} y1={20 + plotH} x2={width - 8} y2={20 + plotH} stroke={GRAY} strokeWidth={1} />
        {groups.map((g, gi) => {
          const x0 = 24 + gi * (groupW + 16)
          const barW = Math.min(22, (groupW - 4) / seriesLabels.length)
          return (
            <g key={gi}>
              {g.values.map((v, si) =>
                v == null ? null : (
                  <g key={si}>
                    <rect
                      x={x0 + si * (barW + 3)}
                      y={20 + plotH - (v / max) * plotH}
                      width={barW}
                      height={(v / max) * plotH}
                      fill={colors[si % colors.length]}
                      rx={2}
                    />
                    <text
                      x={x0 + si * (barW + 3) + barW / 2}
                      y={20 + plotH - (v / max) * plotH - 4}
                      textAnchor="middle"
                      fontSize={9}
                      fill={SLATE}
                    >
                      {v}
                    </text>
                  </g>
                )
              )}
              <text
                x={x0 + (g.values.length * (barW + 3)) / 2}
                y={20 + plotH + 14}
                textAnchor="middle"
                fontSize={10}
                fill="#64748b"
              >
                {g.label.length > 14 ? g.label.slice(0, 13) + '…' : g.label}
              </text>
            </g>
          )
        })}
        {seriesLabels.map((s, i) => (
          <g key={s}>
            <rect x={24 + i * 110} y={height - 14} width={10} height={10} fill={colors[i % colors.length]} rx={2} />
            <text x={38 + i * 110} y={height - 5} fontSize={10} fill="#64748b">
              {s}
            </text>
          </g>
        ))}
      </svg>
    </div>
  )
}

export default async function ClassReportPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const session = await createSupabaseServerClient()
  const {
    data: { user },
  } = await session.auth.getUser()
  if (!user?.email) redirect(`/login?next=/class-report/${id}`)

  const viewer = await canViewClassReport(user.email, id)
  if (!viewer) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <p className="bg-white rounded-lg border p-6 text-gray-600">
          This report isn&apos;t available for your account.
        </p>
      </div>
    )
  }

  const report = await loadClassReport(id)
  if (!report) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <p className="bg-white rounded-lg border p-6 text-gray-600">Class not found.</p>
      </div>
    )
  }

  const r: ClassReport = report
  const withAnyScore = r.students.filter((s) => s.initial || s.final)
  const isStaff = viewer === 'admin' || viewer === 'manager'

  return (
    <div className="min-h-screen bg-gray-50 p-6 sm:p-10 print:bg-white">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-hgl-slate">{r.label} — performance report</h1>
            <p className="text-sm text-gray-500 mt-1">
              {r.schoolName}
              {r.instructorName ? ` · Instructor: ${r.instructorName}` : ''}
              {r.firstSession ? ` · ${formatDate(r.firstSession)}` : ''}
              {r.lastSession && r.lastSession !== r.firstSession ? ` – ${formatDate(r.lastSession)}` : ''}
            </p>
            <p className="text-xs text-gray-500 mt-1">
              Computed live from the portal&apos;s scores and attendance — never a stale copy. Blank
              cells mean a test wasn&apos;t taken, not a zero.
            </p>
          </div>
          {(isStaff || viewer === 'instructor') && (
            <div className="text-xs space-x-3 print:hidden">
              {/* PL-219 v1.5: the projectable in-class survey QR. */}
              <a className="text-hgl-blue underline" href={`/survey-qr/${r.classId}`}>
                Show survey QR (project it)
              </a>
              {/* Admin-generated shareable flavors (PL-219): the PDF API is
                  admin-only — managers see the live page, not the handouts. */}
              {viewer === 'admin' && (
                <>
                  <a className="text-hgl-blue underline" href={`/api/class-report-pdf?class=${r.classId}&flavor=anonymized`}>
                    One-pager PDF (anonymized, for prospecting)
                  </a>
                  <a className="text-hgl-blue underline" href={`/api/class-report-pdf?class=${r.classId}&flavor=named`}>
                    One-pager PDF (named — not for marketing)
                  </a>
                </>
              )}
            </div>
          )}
        </div>

        {/* Score table */}
        <div className="bg-white rounded-lg border border-gray-200 p-4 overflow-x-auto">
          <p className="text-sm font-bold text-hgl-slate mb-2">Scores & attendance</p>
          {withAnyScore.length === 0 ? (
            <p className="text-sm text-gray-500 italic">No diagnostic scores recorded for this class yet.</p>
          ) : (
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 uppercase tracking-wide">
                  <th className="py-1.5 pr-4">Student</th>
                  {r.sections.map((sec) => (
                    <th key={`i-${sec}`} className="py-1.5 pr-3 text-right">
                      {sec} (1st)
                    </th>
                  ))}
                  <th className="py-1.5 pr-3 text-right">Total (1st)</th>
                  {r.sections.map((sec) => (
                    <th key={`f-${sec}`} className="py-1.5 pr-3 text-right">
                      {sec} (final)
                    </th>
                  ))}
                  <th className="py-1.5 pr-3 text-right">Total (final)</th>
                  <th className="py-1.5 pr-3 text-right">Gained</th>
                  <th className="py-1.5 pr-3 text-right">Superscore</th>
                  <th className="py-1.5 text-right">Attendance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {r.students.map((s) => (
                  <tr key={s.id}>
                    <td className="py-1.5 pr-4 font-semibold text-hgl-slate">{s.name}</td>
                    {r.sections.map((sec) => (
                      <td key={`i-${sec}`} className="py-1.5 pr-3 text-right text-gray-700">
                        {s.initial?.sections[sec] ?? ''}
                      </td>
                    ))}
                    <td className="py-1.5 pr-3 text-right text-gray-700">{s.initial?.total ?? ''}</td>
                    {r.sections.map((sec) => (
                      <td key={`f-${sec}`} className="py-1.5 pr-3 text-right text-gray-700">
                        {s.final?.sections[sec] ?? ''}
                      </td>
                    ))}
                    <td className="py-1.5 pr-3 text-right text-gray-700">{s.final?.total ?? ''}</td>
                    <td className={`py-1.5 pr-3 text-right font-semibold ${s.gained != null && s.gained > 0 ? 'text-green-700' : 'text-gray-700'}`}>
                      {s.gained != null ? (s.gained > 0 ? `+${s.gained}` : s.gained) : ''}
                    </td>
                    <td className="py-1.5 pr-3 text-right text-gray-700">{s.superscore ?? ''}</td>
                    <td className="py-1.5 text-right text-gray-700">
                      {s.attendancePct != null ? `${s.attendancePct}%` : ''}
                    </td>
                  </tr>
                ))}
                <tr className="border-t-2 border-gray-300 font-semibold">
                  <td className="py-1.5 pr-4 text-hgl-slate">Class average</td>
                  {r.sections.map((sec) => (
                    <td key={`ai-${sec}`} className="py-1.5 pr-3 text-right">
                      {r.averages.initialBySection[sec] ?? ''}
                    </td>
                  ))}
                  <td className="py-1.5 pr-3 text-right">{r.averages.initialTotal ?? ''}</td>
                  {r.sections.map((sec) => (
                    <td key={`af-${sec}`} className="py-1.5 pr-3 text-right">
                      {r.averages.finalBySection[sec] ?? ''}
                    </td>
                  ))}
                  <td className="py-1.5 pr-3 text-right">{r.averages.finalTotal ?? ''}</td>
                  <td className="py-1.5 pr-3 text-right text-green-700">
                    {r.averages.avgGain != null ? (r.averages.avgGain > 0 ? `+${r.averages.avgGain}` : r.averages.avgGain) : ''}
                  </td>
                  <td />
                  <td className="py-1.5 text-right">
                    {r.averages.avgAttendancePct != null ? `${r.averages.avgAttendancePct}%` : ''}
                  </td>
                </tr>
              </tbody>
            </table>
          )}
        </div>

        {/* Graphs */}
        <BarChart
          title="Initial vs final vs superscore — composite by student"
          groups={r.students
            .filter((s) => s.initial || s.final)
            .map((s) => ({
              label: s.name.split(' ')[0],
              values: [s.initial?.total ?? null, s.final?.total ?? null, s.superscore ?? null],
            }))}
          seriesLabels={['Initial', 'Final', 'Superscore']}
        />
        <BarChart
          title="Class average section scores — initial vs final"
          groups={r.sections.map((sec) => ({
            label: sec,
            values: [r.averages.initialBySection[sec] ?? null, r.averages.finalBySection[sec] ?? null],
          }))}
          seriesLabels={['Initial', 'Final']}
        />
        {r.buckets.length > 0 && (
          <BarChart
            title="Average point increase by initial score"
            groups={r.buckets.map((b) => ({
              label: `${b.label} (${b.count})`,
              values: [b.avgGain],
            }))}
            seriesLabels={['Avg gain']}
          />
        )}
        {/* PL-219 v1.5: survey aggregates — never identities. */}
        {r.survey && (
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <p className="text-sm font-bold text-hgl-slate mb-2">
              Student survey ({r.survey.responses} response{r.survey.responses === 1 ? '' : 's'})
            </p>
            <div className="flex flex-wrap gap-6 text-sm text-gray-700 mb-2">
              {r.survey.avgSatisfaction != null && (
                <span>Satisfaction: <strong>{r.survey.avgSatisfaction}/5</strong></span>
              )}
              {r.survey.avgRecommend != null && (
                <span>Would recommend: <strong>{r.survey.avgRecommend}/5</strong></span>
              )}
              {r.survey.avgInstructorRating != null && (
                <span>Instructor: <strong>{r.survey.avgInstructorRating}/5</strong></span>
              )}
            </div>
            {r.survey.comments.length > 0 && (
              <ul className="text-xs text-gray-600 space-y-1 list-disc pl-4">
                {r.survey.comments.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            )}
          </div>
        )}
        {r.averages.avgAttendancePct != null && (
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <p className="text-sm font-bold text-hgl-slate mb-1">Attendance</p>
            <p className="text-3xl font-bold text-hgl-slate">
              {r.averages.avgAttendancePct}%
              <span className="text-sm font-normal text-gray-500 ml-2">class average attendance</span>
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
