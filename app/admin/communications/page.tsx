'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../utils/supabase'
import { templateLabel } from '../../utils/comms'

// Feature A3 — communications dashboard (docs/COMMS_ATTENDANCE_PARENT_SPEC.md).
// Upcoming = scheduled/held rows (materialized by the sweep's projector);
// History = everything that left (or was stopped). Reads run on the browser
// client under the staff RLS policy, like the rest of /admin; mutations go
// through /api/admin/comms/action.

type SendRow = {
  id: string
  dedupe_key: string
  template_key: string
  enrollment_id: string | null
  class_id: string | null
  recipient_email: string
  recipient_role: string
  scheduled_for: string
  status: string
  manually_rescheduled: boolean
  is_test: boolean
  sent_at: string | null
  delivered_at: string | null
  first_opened_at: string | null
  first_clicked_at: string | null
  bounced_at: string | null
  open_count: number
  click_count: number
  subject_rendered: string | null
  hold_reason: string | null
  cancel_reason: string | null
  cancelled_by: string | null
  created_at: string
  enrollments: {
    students: { first_name: string; last_name: string } | null
  } | null
  classes: {
    class_type: string
    schools: { nickname: string; timezone: string } | null
  } | null
}

const STATUS_STYLES: Record<string, string> = {
  scheduled: 'bg-blue-100 text-blue-700',
  held: 'bg-amber-100 text-amber-800',
  cancelled: 'bg-gray-200 text-gray-500',
  sending: 'bg-yellow-100 text-yellow-800',
  sent: 'bg-green-100 text-green-700',
  delivered: 'bg-green-100 text-green-700',
  bounced: 'bg-red-100 text-red-600',
  complained: 'bg-red-100 text-red-600',
  failed: 'bg-red-100 text-red-600',
}

const SELECT = `
  id, dedupe_key, template_key, enrollment_id, class_id, recipient_email,
  recipient_role, scheduled_for, status, manually_rescheduled, is_test,
  sent_at, delivered_at, first_opened_at, first_clicked_at, bounced_at,
  open_count, click_count, subject_rendered, hold_reason, cancel_reason,
  cancelled_by, created_at,
  enrollments ( students ( first_name, last_name ) ),
  classes ( class_type, schools ( nickname, timezone ) )
`

function fmtInZone(iso: string | null, tz: string | undefined) {
  if (!iso) return '—'
  const d = new Date(iso)
  const zone = tz ?? 'UTC'
  const text = d.toLocaleString('en-GB', {
    timeZone: zone,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
  return `${text} (${zone.split('/').pop()?.replace('_', ' ')})`
}

function studentName(r: SendRow) {
  const s = r.enrollments?.students
  return s ? `${s.first_name} ${s.last_name}` : null
}

function classLabel(r: SendRow) {
  return r.classes ? `${r.classes.schools?.nickname ?? '—'} ${r.classes.class_type}` : '—'
}

export default function CommunicationsDashboard() {
  const [tab, setTab] = useState<'upcoming' | 'history'>('upcoming')
  const [rows, setRows] = useState<SendRow[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // Filters
  const [classFilter, setClassFilter] = useState('')
  const [templateFilter, setTemplateFilter] = useState('')
  const [roleFilter, setRoleFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [search, setSearch] = useState('')
  const [enrollmentFilter, setEnrollmentFilter] = useState('')

  // Modals
  const [preview, setPreview] = useState<{ subject: string; html: string; note?: string } | null>(null)
  const [detail, setDetail] = useState<SendRow | null>(null)
  const [rescheduling, setRescheduling] = useState<SendRow | null>(null)
  const [rescheduleValue, setRescheduleValue] = useState('')

  const fetchRows = useCallback(async () => {
    setLoading(true)
    let query = supabase.from('email_sends').select(SELECT)
    if (tab === 'upcoming') {
      query = query.in('status', ['scheduled', 'held']).order('scheduled_for', { ascending: true })
    } else {
      query = query
        .in('status', ['sending', 'sent', 'delivered', 'bounced', 'complained', 'cancelled', 'failed'])
        .order('updated_at', { ascending: false })
    }
    const { data, error } = await query.limit(500)
    setError(error ? `Query failed: ${error.message} — has migration 20260712000001 been applied?` : '')
    setRows((data as unknown as SendRow[]) ?? [])
    setLoading(false)
  }, [tab])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchRows()
  }, [fetchRows])

  useEffect(() => {
    // Per-enrollment thread deep link: /admin/communications?enrollment=<id>
    const param = new URLSearchParams(window.location.search).get('enrollment')
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (param) setEnrollmentFilter(param)
  }, [])

  async function act(body: Record<string, unknown>, confirmText?: string) {
    if (confirmText && !confirm(confirmText)) return
    setBusy(true)
    const res = await fetch('/api/admin/comms/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    setBusy(false)
    const out = await res.json().catch(() => ({}))
    if (!res.ok || out.failures?.length) {
      alert('Problem: ' + (out.error ?? out.failures?.join('\n') ?? res.status))
    }
    fetchRows()
  }

  async function openPreview(row: SendRow) {
    setBusy(true)
    const res = await fetch(`/api/admin/comms/preview?id=${row.id}`)
    setBusy(false)
    if (!res.ok) {
      const out = await res.json().catch(() => ({}))
      alert(out.error ?? 'Preview unavailable.')
      return
    }
    const data = await res.json()
    setPreview({
      ...data,
      note:
        tab === 'history'
          ? 'Re-rendered with current data — the copy-version snapshot arrives with the template editor (A4).'
          : undefined,
    })
  }

  const classOptions = useMemo(() => {
    const seen = new Map<string, string>()
    for (const r of rows) if (r.class_id) seen.set(r.class_id, classLabel(r))
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  }, [rows])

  const templateOptions = useMemo(
    () => [...new Set(rows.map((r) => r.template_key))].sort(),
    [rows]
  )

  const filtered = rows.filter((r) => {
    if (enrollmentFilter && r.enrollment_id !== enrollmentFilter) return false
    if (classFilter && r.class_id !== classFilter) return false
    if (templateFilter && r.template_key !== templateFilter) return false
    if (roleFilter && r.recipient_role !== roleFilter) return false
    if (statusFilter && r.status !== statusFilter) return false
    if (search) {
      const q = search.toLowerCase()
      const hay = `${r.recipient_email} ${studentName(r) ?? ''} ${r.subject_rendered ?? ''}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })

  function statusChip(r: SendRow) {
    return (
      <span
        className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${STATUS_STYLES[r.status] ?? 'bg-gray-100 text-gray-600'}`}
        title={r.hold_reason ?? r.cancel_reason ?? undefined}
      >
        {r.status}
        {r.manually_rescheduled && r.status === 'scheduled' ? ' (manual)' : ''}
        {r.is_test ? ' · test' : ''}
      </span>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 p-10">
      <div className="max-w-7xl mx-auto space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h1 className="text-2xl font-bold text-hgl-slate">Communications</h1>
          <a href="/admin" className="text-sm text-gray-500 underline hover:text-hgl-slate">
            ← Back to admin
          </a>
        </div>

        {error && (
          <div className="p-3 rounded bg-red-100 text-red-700 font-semibold text-sm">{error}</div>
        )}
        {enrollmentFilter && (
          <div className="p-3 rounded bg-blue-50 border border-blue-200 text-sm text-hgl-slate flex items-center justify-between">
            <span>
              Showing the communication thread for one enrollment
              {filtered[0] && studentName(filtered[0]) ? (
                <>
                  {' '}
                  — <strong>{studentName(filtered[0])}</strong> · {classLabel(filtered[0])}
                </>
              ) : null}
              . Both tabs are filtered.
            </span>
            <button onClick={() => setEnrollmentFilter('')} className="underline text-hgl-blue">
              clear
            </button>
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 border-b border-gray-200">
          {(['upcoming', 'history'] as const).map((t) => (
            <button
              key={t}
              onClick={() => {
                setTab(t)
                setStatusFilter('')
              }}
              className={`px-4 py-2 text-sm font-semibold rounded-t-md border border-b-0 transition ${
                tab === t
                  ? 'bg-white border-gray-200 text-hgl-blue -mb-px'
                  : 'bg-gray-50 border-transparent text-gray-500 hover:text-hgl-slate'
              }`}
            >
              {t === 'upcoming' ? 'Upcoming' : 'History'}
            </button>
          ))}
        </div>

        {/* Filters */}
        <div className="bg-white border border-gray-200 rounded-lg p-3 flex flex-wrap gap-2 items-center text-sm">
          <select value={classFilter} onChange={(e) => setClassFilter(e.target.value)} className="border rounded p-1.5">
            <option value="">all classes</option>
            {classOptions.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
          <select
            value={templateFilter}
            onChange={(e) => setTemplateFilter(e.target.value)}
            className="border rounded p-1.5 max-w-64"
          >
            <option value="">all templates</option>
            {templateOptions.map((k) => (
              <option key={k} value={k}>
                {templateLabel(k)}
              </option>
            ))}
          </select>
          <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} className="border rounded p-1.5">
            <option value="">all audiences</option>
            {['parent', 'student', 'counselor', 'admin', 'instructor'].map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          {tab === 'history' && (
            <>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="border rounded p-1.5"
              >
                <option value="">all statuses</option>
                {['sent', 'delivered', 'bounced', 'complained', 'cancelled', 'failed'].map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search recipient / student / subject"
                className="border rounded p-1.5 flex-1 min-w-56"
              />
            </>
          )}
          {tab === 'upcoming' && classFilter && (
            <span className="ml-auto flex gap-2">
              <button
                onClick={() =>
                  act(
                    { action: 'bulk_hold', classId: classFilter, reason: 'bulk hold from dashboard' },
                    'Hold ALL scheduled sends for this class? They stay listed and can be released.'
                  )
                }
                disabled={busy}
                className="text-xs font-bold px-3 py-1.5 rounded bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50"
              >
                Hold all for class
              </button>
              <button
                onClick={() => {
                  const reason = prompt('Cancel ALL scheduled sends for this class — reason:')
                  if (reason == null) return
                  act({ action: 'bulk_cancel', classId: classFilter, reason })
                }}
                disabled={busy}
                className="text-xs font-bold px-3 py-1.5 rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
              >
                Cancel all for class
              </button>
            </span>
          )}
        </div>

        {/* Table */}
        <div className="bg-white border border-gray-200 rounded-lg overflow-x-auto">
          {loading ? (
            <p className="p-6 text-gray-500 animate-pulse">Loading…</p>
          ) : filtered.length === 0 ? (
            <p className="p-6 text-sm text-gray-500 italic">
              {tab === 'upcoming'
                ? 'Nothing scheduled — rows appear after the next hourly sweep projects upcoming sends.'
                : 'No sends match.'}
            </p>
          ) : (
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-100">
                <tr>
                  {['Email', 'Recipient', 'Class', tab === 'upcoming' ? 'Scheduled (school-local)' : 'Sent', 'Status', tab === 'history' ? 'Engagement' : 'Actions', tab === 'history' ? '' : null]
                    .filter((h) => h !== null)
                    .map((h, i) => (
                      <th key={i} className="px-3 py-2 text-left text-xs font-bold text-hgl-slate uppercase tracking-wider">
                        {h}
                      </th>
                    ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {filtered.map((r) => {
                  const tz = r.classes?.schools?.timezone
                  return (
                    <tr key={r.id} className="hover:bg-gray-50 align-top">
                      <td className="px-3 py-2">
                        <span className="font-medium text-gray-800">{templateLabel(r.template_key)}</span>
                        {r.subject_rendered && (
                          <span className="block text-xs text-gray-400 max-w-72 truncate" title={r.subject_rendered}>
                            {r.subject_rendered}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {studentName(r) && <span className="block text-gray-800">{studentName(r)}</span>}
                        <span className="text-xs text-gray-500">
                          {r.recipient_email} · {r.recipient_role}
                        </span>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-gray-600">
                        {classLabel(r)}
                        {r.enrollment_id && (
                          <button
                            onClick={() => setEnrollmentFilter(r.enrollment_id!)}
                            className="block text-xs text-hgl-blue underline"
                            title="All communications for this enrollment"
                          >
                            thread
                          </button>
                        )}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-gray-600">
                        {tab === 'upcoming' ? fmtInZone(r.scheduled_for, tz) : fmtInZone(r.sent_at, tz)}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">{statusChip(r)}</td>
                      {tab === 'history' ? (
                        <>
                          <td className="px-3 py-2 whitespace-nowrap text-xs text-gray-600">
                            {r.delivered_at && <span className="block">✓ delivered</span>}
                            {r.first_opened_at && (
                              <span className="block" title="Open tracking is approximate (Apple Mail privacy inflates opens)">
                                opened ×{r.open_count}
                              </span>
                            )}
                            {r.first_clicked_at && <span className="block">clicked ×{r.click_count}</span>}
                            {!r.delivered_at && !r.first_opened_at && !r.first_clicked_at && '—'}
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap">
                            <button onClick={() => setDetail(r)} className="text-xs text-hgl-blue underline">
                              details
                            </button>
                          </td>
                        </>
                      ) : (
                        <td className="px-3 py-2 whitespace-nowrap space-x-2 text-xs">
                          <button onClick={() => openPreview(r)} disabled={busy} className="text-hgl-blue underline">
                            Preview
                          </button>
                          <button
                            onClick={() =>
                              act(
                                { action: 'send_now', ids: [r.id] },
                                `Send "${templateLabel(r.template_key)}" to ${r.recipient_email} right now?`
                              )
                            }
                            disabled={busy}
                            className="text-green-700 underline"
                          >
                            Send now
                          </button>
                          {r.status === 'held' ? (
                            <button
                              onClick={() => act({ action: 'release', ids: [r.id] })}
                              disabled={busy}
                              className="text-amber-700 underline"
                            >
                              Release
                            </button>
                          ) : (
                            <button
                              onClick={() => act({ action: 'hold', ids: [r.id] })}
                              disabled={busy}
                              className="text-amber-700 underline"
                            >
                              Hold
                            </button>
                          )}
                          <button
                            onClick={() => {
                              setRescheduling(r)
                              setRescheduleValue('')
                            }}
                            disabled={busy}
                            className="text-gray-600 underline"
                          >
                            Reschedule
                          </button>
                          <button
                            onClick={() => {
                              const reason = prompt(`Cancel "${templateLabel(r.template_key)}" to ${r.recipient_email}? Reason:`)
                              if (reason == null) return
                              act({ action: 'cancel', ids: [r.id], reason })
                            }}
                            disabled={busy}
                            className="text-red-600 underline"
                          >
                            Cancel
                          </button>
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
        <p className="text-xs text-gray-400">
          Times shown in each class&apos;s school timezone. Open tracking is approximate — absence of an
          open never proves non-delivery; &ldquo;delivered&rdquo; is the strong claim.
        </p>
      </div>

      {/* Preview modal */}
      {preview && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-6 z-50" onClick={() => setPreview(null)}>
          <div className="bg-white rounded-lg shadow-xl max-w-3xl w-full max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="px-4 py-3 border-b flex items-center justify-between">
              <div>
                <p className="font-semibold text-hgl-slate">{preview.subject}</p>
                {preview.note && <p className="text-xs text-amber-700">{preview.note}</p>}
              </div>
              <button onClick={() => setPreview(null)} className="text-gray-400 hover:text-gray-700 text-xl leading-none">
                ×
              </button>
            </div>
            <iframe title="Email preview" srcDoc={preview.html} className="flex-1 min-h-[60vh] w-full" sandbox="" />
          </div>
        </div>
      )}

      {/* Detail drawer */}
      {detail && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-6 z-50" onClick={() => setDetail(null)}>
          <div className="bg-white rounded-lg shadow-xl max-w-lg w-full p-5 space-y-2 text-sm" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-hgl-slate">{templateLabel(detail.template_key)}</h3>
              <button onClick={() => setDetail(null)} className="text-gray-400 hover:text-gray-700 text-xl leading-none">
                ×
              </button>
            </div>
            <p className="text-gray-600">
              To <strong>{detail.recipient_email}</strong> ({detail.recipient_role})
              {studentName(detail) ? ` · ${studentName(detail)} · ${classLabel(detail)}` : ''}
            </p>
            {detail.subject_rendered && <p className="text-gray-800">“{detail.subject_rendered}”</p>}
            <ul className="border-l-2 border-gray-200 pl-4 space-y-1 text-gray-600">
              <li>created {fmtInZone(detail.created_at, detail.classes?.schools?.timezone)}</li>
              <li>scheduled for {fmtInZone(detail.scheduled_for, detail.classes?.schools?.timezone)}</li>
              {detail.sent_at && <li>sent {fmtInZone(detail.sent_at, detail.classes?.schools?.timezone)}</li>}
              {detail.delivered_at && <li>✓ delivered {fmtInZone(detail.delivered_at, detail.classes?.schools?.timezone)}</li>}
              {detail.first_opened_at && (
                <li>
                  first opened {fmtInZone(detail.first_opened_at, detail.classes?.schools?.timezone)} ({detail.open_count} total)
                </li>
              )}
              {detail.first_clicked_at && (
                <li>
                  first clicked {fmtInZone(detail.first_clicked_at, detail.classes?.schools?.timezone)} ({detail.click_count} total)
                </li>
              )}
              {detail.bounced_at && <li className="text-red-600">bounced {fmtInZone(detail.bounced_at, detail.classes?.schools?.timezone)}</li>}
              {detail.cancel_reason && (
                <li className="text-gray-500">
                  cancelled{detail.cancelled_by ? ` by ${detail.cancelled_by}` : ''}: {detail.cancel_reason}
                </li>
              )}
              {detail.hold_reason && <li className="text-amber-700">held: {detail.hold_reason}</li>}
            </ul>
            {detail.enrollment_id && (
              <button
                onClick={() => {
                  openPreview(detail)
                }}
                disabled={busy}
                className="text-hgl-blue underline text-xs"
              >
                Show body (re-rendered with current data)
              </button>
            )}
          </div>
        </div>
      )}

      {/* Reschedule modal */}
      {rescheduling && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-6 z-50" onClick={() => setRescheduling(null)}>
          <div className="bg-white rounded-lg shadow-xl max-w-sm w-full p-5 space-y-3 text-sm" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold text-hgl-slate">Reschedule</h3>
            <p className="text-gray-600">
              {templateLabel(rescheduling.template_key)} → {rescheduling.recipient_email}
              <span className="block text-xs text-gray-400">
                Pick the time in YOUR local time — it converts automatically. The weekly recompute will
                not move a manually set time.
              </span>
            </p>
            <input
              type="datetime-local"
              value={rescheduleValue}
              onChange={(e) => setRescheduleValue(e.target.value)}
              className="border rounded p-2 w-full"
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => setRescheduling(null)} className="px-3 py-1.5 rounded border text-gray-600">
                Cancel
              </button>
              <button
                onClick={() => {
                  if (!rescheduleValue) return
                  act({
                    action: 'reschedule',
                    ids: [rescheduling.id],
                    scheduledFor: new Date(rescheduleValue).toISOString(),
                  })
                  setRescheduling(null)
                }}
                disabled={!rescheduleValue || busy}
                className="px-3 py-1.5 rounded bg-hgl-blue text-white font-bold disabled:opacity-50"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
