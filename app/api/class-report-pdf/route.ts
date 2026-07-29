import { sessionRole } from '../../utils/staff-gate'
import { anonymizeClassReport, loadClassReport } from '../../utils/class-report'
import { renderHtml } from '../../utils/collateral-render'
import { escapeHtml } from '../../utils/collateral'

// PL-219 v1: the shareable one-pager, riding the Phase 4.5 render machinery.
// Two flavors, ADMIN-generated only:
//   anonymized — averages, gains, distribution; no student names (prospecting)
//   named      — same layout with real rows, for schools that prefer it;
//                clearly labeled not-for-marketing.
// Always rendered fresh from live data, like all collateral.

export const maxDuration = 60

const BLUE = '#00AEEE'
const SLATE = '#334155'

export async function GET(request: Request) {
  const caller = await sessionRole('admin')
  if (!caller) return new Response('Not available for this account', { status: 403 })

  const url = new URL(request.url)
  const classId = url.searchParams.get('class') ?? ''
  const flavor = url.searchParams.get('flavor') === 'named' ? 'named' : 'anonymized'
  const raw = await loadClassReport(classId)
  if (!raw) return new Response('Class not found', { status: 404 })
  const r = flavor === 'anonymized' ? anonymizeClassReport(raw) : raw

  const secHead = r.sections
    .map((s) => `<th style="text-align:right;padding:4px 8px">${escapeHtml(s)} 1st</th><th style="text-align:right;padding:4px 8px">${escapeHtml(s)} final</th>`)
    .join('')
  const rows = r.students
    .filter((s) => s.initial || s.final)
    .map(
      (s) => `<tr>
        <td style="padding:4px 8px;font-weight:600;color:${SLATE}">${escapeHtml(s.name)}</td>
        ${r.sections
          .map(
            (sec) =>
              `<td style="text-align:right;padding:4px 8px">${s.initial?.sections[sec] ?? ''}</td>
               <td style="text-align:right;padding:4px 8px">${s.final?.sections[sec] ?? ''}</td>`
          )
          .join('')}
        <td style="text-align:right;padding:4px 8px">${s.initial?.total ?? ''}</td>
        <td style="text-align:right;padding:4px 8px">${s.final?.total ?? ''}</td>
        <td style="text-align:right;padding:4px 8px;font-weight:700;color:${s.gained != null && s.gained > 0 ? '#15803d' : SLATE}">${
          s.gained != null ? (s.gained > 0 ? `+${s.gained}` : s.gained) : ''
        }</td>
        <td style="text-align:right;padding:4px 8px">${s.superscore ?? ''}</td>
        <td style="text-align:right;padding:4px 8px">${s.attendancePct != null ? `${s.attendancePct}%` : ''}</td>
      </tr>`
    )
    .join('')

  const stat = (label: string, value: string) => `
    <div style="border:1px solid #e2e8f0;border-radius:8px;padding:10px 16px;text-align:center">
      <div style="font-size:22px;font-weight:800;color:${SLATE}">${value}</div>
      <div style="font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:.05em">${label}</div>
    </div>`

  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
      body{font-family:Helvetica,Arial,sans-serif;color:#1e293b;margin:28px}
      table{border-collapse:collapse;font-size:11px;width:100%}
      thead th{color:#64748b;font-size:9px;text-transform:uppercase;letter-spacing:.04em;border-bottom:1px solid #e2e8f0}
      tbody tr{border-bottom:1px solid #f1f5f9}
    </style></head><body>
    <div style="border-top:6px solid ${BLUE};padding-top:14px">
      <h1 style="font-size:20px;color:${SLATE};margin:0">${escapeHtml(r.label)} — course results</h1>
      <p style="font-size:11px;color:#64748b;margin:4px 0 0">
        ${escapeHtml(r.schoolName)}${r.instructorName ? ` · Instructor: ${escapeHtml(r.instructorName)}` : ''}
        ${r.firstSession ? ` · ${r.firstSession}` : ''}${r.lastSession && r.lastSession !== r.firstSession ? ` – ${r.lastSession}` : ''}
      </p>
      ${
        flavor === 'named'
          ? `<p style="font-size:10px;color:#b45309;font-weight:700;margin:6px 0 0">Named student results — for ${escapeHtml(r.schoolNickname)} only, not for marketing use.</p>`
          : `<p style="font-size:10px;color:#64748b;margin:6px 0 0">Anonymized results — no student names appear in this report.</p>`
      }
      <div style="display:flex;gap:12px;margin:16px 0">
        ${stat('Students with scores', String(r.students.filter((s) => s.initial || s.final).length))}
        ${r.averages.avgGain != null ? stat('Average point gain', `${r.averages.avgGain > 0 ? '+' : ''}${r.averages.avgGain}`) : ''}
        ${r.averages.initialTotal != null ? stat('Avg initial', String(r.averages.initialTotal)) : ''}
        ${r.averages.finalTotal != null ? stat('Avg final', String(r.averages.finalTotal)) : ''}
        ${r.averages.avgAttendancePct != null ? stat('Avg attendance', `${r.averages.avgAttendancePct}%`) : ''}
      </div>
      <table>
        <thead><tr>
          <th style="text-align:left;padding:4px 8px">Student</th>
          ${secHead}
          <th style="text-align:right;padding:4px 8px">Total 1st</th>
          <th style="text-align:right;padding:4px 8px">Total final</th>
          <th style="text-align:right;padding:4px 8px">Gained</th>
          <th style="text-align:right;padding:4px 8px">Superscore</th>
          <th style="text-align:right;padding:4px 8px">Attendance</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
      ${
        r.buckets.length > 0
          ? `<p style="font-size:11px;color:${SLATE};margin-top:14px"><strong>Average gain by starting score:</strong> ${r.buckets
              .map((b) => `${escapeHtml(b.label)} → ${b.avgGain > 0 ? '+' : ''}${b.avgGain} (${b.count} student${b.count === 1 ? '' : 's'})`)
              .join(' · ')}</p>`
          : ''
      }
      <p style="font-size:9px;color:#94a3b8;margin-top:16px">Generated fresh from Higher Ground Learning portal data. Blank cells mean a test wasn't taken — never a zero.</p>
    </div>
    </body></html>`

  let bytes: Buffer
  try {
    bytes = await renderHtml(html, 'pdf')
  } catch (e) {
    console.error(`class-report pdf failed for ${classId}:`, e)
    return new Response('Could not generate the PDF — the error has been logged. Try again in a minute.', { status: 500 })
  }
  const filename = `Course Report_${r.label}${flavor === 'named' ? ' (named)' : ''}`.replace(/[^\w\- ()]+/g, '')
  return new Response(new Uint8Array(bytes), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}.pdf"`,
      'Cache-Control': 'private, no-store',
    },
  })
}
