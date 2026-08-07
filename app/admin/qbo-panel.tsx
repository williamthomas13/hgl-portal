'use client'

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../utils/supabase'
import { formatTimestampAdmin } from '../utils/dates'

// QuickBooks panel (Phase 6, docs/PHASE6_SPEC.md §8): connection card + item
// mapping (admin-only — spec §6) and the filterable sync log with retry
// (staff). Tokens never reach this component; everything config-shaped goes
// through /api/qbo/* routes, and the sync log reads under the is_staff RLS
// policy like the rest of the admin page.

export type QboStatus = {
  configured: boolean
  environment: 'sandbox' | 'production'
  appHost: string
  status: 'connected' | 'expired' | 'disconnected'
  realmName: string | null
  connectedBy: string | null
  connectedAt: string | null
  itemMap: Partial<
    Record<
      'group_class' | 'tutoring_addon' | 'deposit_account' | 'tutoring_test_prep' | 'tutoring_subject',
      { value: string; name?: string }
    >
  >
  pendingCount: number
  failedCount: number
  callerRole: 'admin' | 'manager'
}

export function qboDocLink(status: QboStatus | null, kind: string, docId: string | null) {
  if (!status || !docId) return null
  // PL-281: TimeActivity has no per-transaction page — the id renders as
  // plain text and the bookkeeper finds it on QBO's time screens.
  if (kind === 'timecard_time') return null
  return `${status.appHost}/app/${kind === 'sale' ? 'salesreceipt' : 'refundreceipt'}?txnId=${docId}`
}

type SyncLogRow = {
  id: string
  kind: 'sale' | 'refund' | 'tutoring_sale' | 'timecard_time'
  status: 'pending' | 'synced' | 'failed' | 'dismissed'
  amount: number | null
  attempts: number
  last_error: string | null
  qbo_doc_id: string | null
  qbo_doc_number: string | null
  stripe_payment_intent_id: string | null
  created_at: string
  synced_at: string | null
  // PL-298: the record links + dismissal trail.
  enrollment_id: string | null
  tutoring_invoice_id: string | null
  dismissed_reason: string | null
  dismissed_by: string | null
  enrollments: {
    students: {
      first_name: string
      last_name: string
    } | null
    classes: { class_type: string; schools: { nickname: string } | null } | null
  } | null
  // PL-281: timecard pushes carry the tutor + period instead of a student.
  timecards: {
    period_start: string
    period_end: string
    instructors: { name: string | null; email: string } | null
  } | null
}

/** PL-298: known machine errors, translated (unknown text passes through). */
const ERROR_PLAIN: Record<string, string> = {
  'tutoring invoice has no positive lines':
    'the invoice has no charges on it (a $0 or credit-only invoice) — QuickBooks refuses an empty receipt',
}

/** PL-281: plain-English kind labels (no internal shorthand on screens). */
const KIND_LABELS: Record<string, string> = {
  sale: 'sale',
  refund: 'refund',
  tutoring_sale: 'tutoring sale',
  timecard_time: 'timecard hours',
}

// PL-281: the tutor rows for Employee matching.
type TutorRow = {
  id: string
  name: string | null
  email: string
  pay_type: 'hourly' | 'salaried'
  tutoring_active: boolean
  active: boolean
  qbo_employee_id: string | null
}

type CatalogEntry = { id: string; name: string; account?: string | null }

const MAPPING_ROWS: {
  key: 'group_class' | 'tutoring_addon' | 'deposit_account' | 'tutoring_test_prep' | 'tutoring_subject'
  label: string
  hint: string
  source: 'items' | 'accounts'
}[] = [
  {
    key: 'group_class',
    label: 'Group class → QBO Item',
    hint: 'the Item should post to 408-3 International Test Prep',
    source: 'items',
  },
  {
    key: 'tutoring_addon',
    label: 'Tutoring add-on → QBO Item',
    hint: 'the Item should post to 408-5 International Online Prep',
    source: 'items',
  },
  {
    key: 'tutoring_test_prep',
    label: 'Tutoring — test prep → QBO Item',
    hint: 'the Item should post to 408-1 (1-on-1 SAT/ACT/GRE/GMAT test prep)',
    source: 'items',
  },
  {
    key: 'tutoring_subject',
    label: 'Tutoring — subject → QBO Item',
    hint: 'the Item should post to 401 (ongoing subject help)',
    source: 'items',
  },
  {
    key: 'deposit_account',
    label: 'Deposit-to account',
    hint: 'the Stripe Clearing bank-type account — receipts deposit at gross',
    source: 'accounts',
  },
]

const SYNC_BADGES: Record<string, { text: string; cls: string }> = {
  synced: { text: '✓ synced', cls: 'bg-green-100 text-green-700' },
  pending: { text: '⏳ pending', cls: 'bg-yellow-100 text-yellow-800' },
  failed: { text: '✗ failed', cls: 'bg-red-100 text-red-600' },
  // PL-298: dismissed-with-reason — history kept, nagging stopped.
  dismissed: { text: 'dismissed', cls: 'bg-gray-200 text-gray-600' },
}

// PL-298: dismiss-with-reason — inline armed control (no native dialogs).
// The reason is required and shows in the log so nobody re-investigates.
function DismissControl({ id, busy, onDone }: { id: string; busy: boolean; onDone: () => void }) {
  const [armed, setArmed] = useState(false)
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  if (!armed) {
    return (
      <button
        onClick={() => setArmed(true)}
        disabled={busy}
        className="text-xs text-gray-500 underline hover:text-hgl-slate disabled:opacity-50"
        title="Stop this row from nagging — with a reason kept in the log"
      >
        Dismiss…
      </button>
    )
  }
  return (
    <span className="flex flex-wrap items-center gap-1.5 bg-blue-50 border border-blue-200 rounded px-2 py-1">
      <input
        type="text"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Why is this fine to ignore?"
        className="border border-gray-300 rounded p-1 text-xs w-56"
      />
      <button
        disabled={saving || !reason.trim()}
        onClick={async () => {
          setSaving(true)
          setErr('')
          const res = await fetch('/api/qbo/dismiss', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id, reason }),
          })
          const json = await res.json().catch(() => ({}))
          setSaving(false)
          if (!res.ok) setErr(json.error ?? 'Could not dismiss.')
          else {
            setArmed(false)
            onDone()
          }
        }}
        className="text-xs font-bold text-hgl-blue underline disabled:opacity-40"
      >
        Dismiss
      </button>
      <button onClick={() => setArmed(false)} className="text-xs text-gray-500 underline">
        cancel
      </button>
      {err && <span className="text-xs text-red-600">{err}</span>}
    </span>
  )
}

export default function QboPanel({ status, onStatusChange }: { status: QboStatus | null; onStatusChange: () => void }) {
  const [log, setLog] = useState<SyncLogRow[]>([])
  const [logFilter, setLogFilter] = useState('')
  const [busy, setBusy] = useState(false)
  const [banner, setBanner] = useState('')
  const [catalog, setCatalog] = useState<{
    items: CatalogEntry[]
    accounts: CatalogEntry[]
    employees?: CatalogEntry[]
  } | null>(null)
  const [catalogError, setCatalogError] = useState('')
  const [pendingMap, setPendingMap] = useState<Record<string, string>>({})
  // PL-281: Employee matching state.
  const [tutors, setTutors] = useState<TutorRow[]>([])
  const [pendingEmp, setPendingEmp] = useState<Record<string, string>>({})

  const fetchLog = useCallback(async () => {
    const since = new Date(Date.now() - 90 * 24 * 3_600_000).toISOString()
    const { data } = await supabase
      .from('qbo_sync_log')
      .select(
        `
        id, kind, status, amount, attempts, last_error, qbo_doc_id, qbo_doc_number,
        stripe_payment_intent_id, created_at, synced_at,
        enrollment_id, tutoring_invoice_id, dismissed_reason, dismissed_by,
        enrollments ( students ( first_name, last_name ),
          classes ( class_type, schools ( nickname ) ) ),
        timecards ( period_start, period_end, instructors ( name, email ) )
      `
      )
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(200)
    if (data) setLog(data as unknown as SyncLogRow[])
    // PL-281: tutors for the Employee-matching card (staff RLS read).
    const { data: tutorRows } = await supabase
      .from('instructors')
      .select('id, name, email, pay_type, tutoring_active, active, qbo_employee_id')
      .order('name')
    if (tutorRows) setTutors(tutorRows as unknown as TutorRow[])
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchLog()
    // OAuth round-trip lands on /admin?qbo=<status> — surface it once.
    // PL-298: ?qbo= is ALSO the failed-row deep link (?qbo=<row uuid>) — this
    // effect runs BEFORE the parent page's param-reading effect (children's
    // effects fire first), and deleting the param here ate the deep link:
    // the dashboard's "QuickBooks sync failed" to-do looked like a page
    // reload. Only consume the param when it's a real OAuth outcome.
    const params = new URLSearchParams(window.location.search)
    const outcome = params.get('qbo')
    const messages: Record<string, string> = {
      connected: '✓ QuickBooks connected.',
      cancelled: 'QuickBooks connection was cancelled at Intuit.',
      invalid: 'The QuickBooks sign-in link expired — try Connect again.',
      denied: 'Only an admin can connect QuickBooks.',
      error: 'QuickBooks connection failed — check the server logs and try again.',
    }
    if (outcome && messages[outcome]) {
      setBanner(messages[outcome])
      params.delete('qbo')
      const rest = params.toString()
      window.history.replaceState(null, '', window.location.pathname + (rest ? `?${rest}` : ''))
    }
  }, [fetchLog])

  async function handleDisconnect() {
    if (
      !confirm(
        'Disconnect QuickBooks?\n\nNew payments queue up and sync again after the next connect — nothing is lost.'
      )
    )
      return
    setBusy(true)
    await fetch('/api/qbo/disconnect', { method: 'POST' })
    setBusy(false)
    onStatusChange()
  }

  async function loadCatalog() {
    setCatalogError('')
    setBusy(true)
    const res = await fetch('/api/qbo/catalog')
    setBusy(false)
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setCatalogError(body.error ?? 'Could not load QuickBooks items.')
      return
    }
    setCatalog(await res.json().catch(() => ({})))
  }

  async function saveMapping(key: string, source: 'items' | 'accounts') {
    const chosen = pendingMap[key]
    if (!chosen || !catalog) return
    const entry = catalog[source].find((e) => e.id === chosen)
    if (!entry) return
    setBusy(true)
    const res = await fetch('/api/qbo/mapping', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, qboId: entry.id, qboName: entry.name }),
    })
    setBusy(false)
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      alert('Error saving mapping: ' + (body.error ?? res.status))
      return
    }
    onStatusChange()
  }

  // PL-281: write (or clear) a tutor's QBO employee match.
  async function saveEmployeeMatch(instructorId: string, qboEmployeeId: string | null) {
    setBusy(true)
    const res = await fetch('/api/qbo/employee-map', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instructorId, qboEmployeeId }),
    })
    setBusy(false)
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setBanner('Error saving the employee match: ' + (body.error ?? res.status))
      return
    }
    setPendingEmp((m) => ({ ...m, [instructorId]: '' }))
    fetchLog()
  }

  async function retry(ids: string[] | null) {
    setBusy(true)
    const res = await fetch('/api/qbo/retry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ids ? { ids } : { allFailed: true }),
    })
    setBusy(false)
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      alert('Retry failed: ' + (body.error ?? res.status))
      return
    }
    fetchLog()
    onStatusChange()
  }

  const isAdmin = status?.callerRole === 'admin'
  const filteredLog = logFilter ? log.filter((r) => r.status === logFilter) : log
  const failedCount = log.filter((r) => r.status === 'failed').length

  const statusPill =
    status?.status === 'connected'
      ? { text: 'Connected', cls: 'bg-green-100 text-green-700' }
      : status?.status === 'expired'
        ? { text: 'Expired — reconnect needed', cls: 'bg-amber-100 text-amber-800' }
        : { text: 'Not connected', cls: 'bg-gray-200 text-gray-600' }

  return (
    <div className="space-y-6">
      {banner && (
        <p className="p-3 rounded bg-blue-50 border border-blue-200 text-sm text-hgl-slate">{banner}</p>
      )}

      {/* Connection card — admin-only actions (spec §6) */}
      <div className="border border-gray-200 rounded-lg p-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <p className="text-sm">
              <span className={`inline-block px-2 py-0.5 rounded font-semibold text-xs ${statusPill.cls}`}>
                {statusPill.text}
              </span>
              {status?.environment === 'sandbox' && (
                <span className="ml-2 inline-block px-2 py-0.5 rounded font-semibold text-xs bg-purple-100 text-purple-700">
                  SANDBOX
                </span>
              )}
            </p>
            {status?.realmName && (
              <p className="text-sm text-gray-600 mt-1">
                Company: <strong>{status.realmName}</strong>
                {status.connectedBy && (
                  <span className="text-gray-400">
                    {' '}
                    · connected by {status.connectedBy}
                    {status.connectedAt ? ` on ${formatTimestampAdmin(status.connectedAt)}` : ''}
                  </span>
                )}
              </p>
            )}
            {!status?.configured && (
              <p className="text-sm text-amber-700 mt-1">
                QBO_CLIENT_ID / QBO_CLIENT_SECRET are not set — add the Intuit app credentials to the
                environment first.
              </p>
            )}
          </div>
          {isAdmin ? (
            <div className="flex gap-2">
              <a
                href="/api/qbo/connect"
                className={`bg-hgl-blue text-white text-sm font-bold px-4 py-2 rounded hover:bg-hgl-blue-hover transition ${
                  status?.configured ? '' : 'pointer-events-none opacity-50'
                }`}
              >
                {status?.status === 'connected' ? 'Reconnect' : 'Connect QuickBooks'}
              </a>
              {status?.status === 'connected' && (
                <button
                  onClick={handleDisconnect}
                  disabled={busy}
                  className="text-sm text-red-600 underline hover:text-red-800 disabled:opacity-50"
                >
                  Disconnect
                </button>
              )}
            </div>
          ) : (
            <p className="text-xs text-gray-500 italic">Connection settings are admin-only.</p>
          )}
        </div>
        {(status?.pendingCount ?? 0) > 0 && (
          <p className="text-xs text-gray-500 mt-2">
            {status?.pendingCount} payment record{status?.pendingCount === 1 ? '' : 's'} waiting to sync
            {status?.status !== 'connected' ? ' (drains automatically on reconnect)' : ''}.
          </p>
        )}
      </div>

      {/* Item mapping — admin-only (spec §3, decisions §11.1) */}
      {isAdmin && (
        <div className="border border-gray-200 rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <h4 className="font-semibold text-hgl-slate">Item mapping</h4>
            <button
              onClick={loadCatalog}
              disabled={busy || status?.status !== 'connected'}
              className="text-xs text-hgl-blue underline hover:text-hgl-slate disabled:opacity-50"
              title={status?.status !== 'connected' ? 'Connect QuickBooks first' : ''}
            >
              Load options from QuickBooks
            </button>
          </div>
          {catalogError && <p className="text-sm text-red-600 mb-2">{catalogError}</p>}
          <div className="space-y-3">
            {MAPPING_ROWS.map((row) => {
              const current = status?.itemMap[row.key]
              const options = catalog ? catalog[row.source] : null
              return (
                <div key={row.key} className="grid grid-cols-3 gap-3 items-center text-sm">
                  <div>
                    <p className="font-medium text-gray-700">{row.label}</p>
                    <p className="text-xs text-gray-400">{row.hint}</p>
                  </div>
                  <p className="text-gray-600">
                    {current ? (
                      <>
                        {current.name ?? current.value}{' '}
                        <span className="text-xs text-gray-400">(id {current.value})</span>
                      </>
                    ) : (
                      <span className="italic text-amber-700">not mapped — syncs wait on this</span>
                    )}
                  </p>
                  {options ? (
                    <div className="flex gap-2">
                      <select
                        value={pendingMap[row.key] ?? ''}
                        onChange={(e) => setPendingMap((m) => ({ ...m, [row.key]: e.target.value }))}
                        className="border border-gray-300 rounded p-1 text-sm flex-1"
                      >
                        <option value="">choose…</option>
                        {options.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.name}
                            {o.account ? ` → ${o.account}` : ''}
                          </option>
                        ))}
                      </select>
                      <button
                        onClick={() => saveMapping(row.key, row.source)}
                        disabled={busy || !pendingMap[row.key]}
                        className="bg-hgl-slate text-white text-xs font-bold px-3 py-1 rounded hover:opacity-90 disabled:opacity-50"
                      >
                        Save
                      </button>
                    </div>
                  ) : (
                    <span className="text-xs text-gray-400 italic">load options to change</span>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* PL-281: Employee matching — admin-only, match-ONLY (the portal
          never creates QBO employees). Hourly + active tutors matter for
          timecard pushes; salaried are listed as excluded so nobody wonders. */}
      {isAdmin && (
        <div className="border border-gray-200 rounded-lg p-4">
          <div className="flex items-center justify-between mb-1">
            <h4 className="font-semibold text-hgl-slate">Employee matching (payroll time)</h4>
            <button
              onClick={loadCatalog}
              disabled={busy || status?.status !== 'connected'}
              className="text-xs text-hgl-blue underline hover:text-hgl-slate disabled:opacity-50"
              title={status?.status !== 'connected' ? 'Connect QuickBooks first' : ''}
            >
              Load options from QuickBooks
            </button>
          </div>
          <p className="text-xs text-gray-500 mb-3">
            Approved hourly timecards push to QuickBooks as time entries against the matched
            employee. Matching only — the portal never creates QuickBooks employees; add new
            employees in QBO Payroll first, then match here. Unmatched tutors can&apos;t be pushed
            (the push button says so by name).
          </p>
          <div className="space-y-2">
            {tutors
              .filter((t) => t.active)
              .map((t) => {
                const employees = catalog?.employees ?? null
                const matched = t.qbo_employee_id
                  ? (catalog?.employees?.find((e) => e.id === t.qbo_employee_id)?.name ??
                    `id ${t.qbo_employee_id}`)
                  : null
                return (
                  <div key={t.id} className="grid grid-cols-3 gap-3 items-center text-sm">
                    <p className="font-medium text-gray-700">
                      {t.name ?? t.email}
                      {t.pay_type === 'salaried' && (
                        <span className="ml-2 text-xs text-gray-400">
                          salaried — never pushed as hourly time
                        </span>
                      )}
                    </p>
                    <p className="text-gray-600">
                      {matched ? (
                        <>QBO employee: {matched}</>
                      ) : t.pay_type === 'salaried' ? (
                        <span className="text-xs text-gray-400 italic">no match needed</span>
                      ) : (
                        <span className="italic text-amber-700">not matched — pushes refuse</span>
                      )}
                    </p>
                    {employees ? (
                      <div className="flex gap-2">
                        <select
                          value={pendingEmp[t.id] ?? ''}
                          onChange={(e) => setPendingEmp((m) => ({ ...m, [t.id]: e.target.value }))}
                          className="border border-gray-300 rounded p-1 text-sm flex-1"
                        >
                          <option value="">choose…</option>
                          {employees.map((e) => (
                            <option key={e.id} value={e.id}>
                              {e.name}
                            </option>
                          ))}
                        </select>
                        <button
                          onClick={() => saveEmployeeMatch(t.id, pendingEmp[t.id] ?? '')}
                          disabled={busy || !pendingEmp[t.id]}
                          className="bg-hgl-slate text-white text-xs font-bold px-3 py-1 rounded hover:opacity-90 disabled:opacity-50"
                        >
                          Save
                        </button>
                        {t.qbo_employee_id && (
                          <button
                            onClick={() => saveEmployeeMatch(t.id, null)}
                            disabled={busy}
                            className="text-xs text-gray-500 underline disabled:opacity-50"
                          >
                            clear
                          </button>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-gray-400 italic">load options to change</span>
                    )}
                  </div>
                )
              })}
          </div>
        </div>
      )}

      {/* Sync log — staff (spec §8) */}
      <div className="border border-gray-200 rounded-lg p-4">
        <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
          <h4 className="font-semibold text-hgl-slate">Sync log (last 90 days)</h4>
          <div className="flex items-center gap-3">
            <select
              value={logFilter}
              onChange={(e) => setLogFilter(e.target.value)}
              className="border border-gray-300 rounded p-1 text-sm"
            >
              <option value="">all statuses</option>
              <option value="pending">pending</option>
              <option value="synced">synced</option>
              <option value="failed">failed</option>
              <option value="dismissed">dismissed</option>
            </select>
            {failedCount > 0 && (
              <button
                onClick={() => retry(null)}
                disabled={busy}
                className="bg-red-600 text-white text-xs font-bold px-3 py-1.5 rounded hover:bg-red-700 disabled:opacity-50"
              >
                Retry all failed ({failedCount})
              </button>
            )}
          </div>
        </div>
        {filteredLog.length === 0 ? (
          <p className="text-sm text-gray-500 italic">
            Nothing here yet — rows appear when payments sync to QuickBooks.
          </p>
        ) : (
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-100">
              <tr>
                {['When', 'Student / class', 'Kind', 'Amount', 'Status', 'QBO doc'].map((h) => (
                  <th
                    key={h}
                    className="px-3 py-2 text-left text-xs font-bold text-hgl-slate uppercase tracking-wider"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {filteredLog.map((r) => {
                const badge = SYNC_BADGES[r.status]
                const student = r.enrollments?.students
                const cls = r.enrollments?.classes
                const tc = r.timecards
                const docLink = qboDocLink(status, r.kind, r.qbo_doc_id)
                return (
                  <tr key={r.id} id={`qbo-${r.id}`} className="hover:bg-gray-50">
                    <td className="px-3 py-2 whitespace-nowrap text-gray-500">
                      {formatTimestampAdmin(r.created_at)}
                    </td>
                    <td className="px-3 py-2">
                      {/* PL-281: timecard rows name the tutor + pay period. */}
                      {tc ? (
                        <>
                          {tc.instructors?.name ?? tc.instructors?.email ?? '—'}
                          <span className="text-gray-400">
                            {' '}
                            · timecard {tc.period_start} → {tc.period_end}
                          </span>
                        </>
                      ) : (
                        <>
                          {student ? `${student.first_name} ${student.last_name}` : '—'}
                          <span className="text-gray-400">
                            {' '}
                            · {cls?.schools?.nickname ?? ''} {cls?.class_type ?? ''}
                          </span>
                        </>
                      )}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">{KIND_LABELS[r.kind] ?? r.kind}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {r.amount != null ? `$${Number(r.amount).toFixed(2)}` : '—'}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${badge.cls}`}>
                        {badge.text}
                      </span>
                      {r.status === 'failed' && (
                        <>
                          {/* PL-298: known machine errors read as sentences. */}
                          {r.last_error && (
                            <span
                              className="block text-xs text-red-500 mt-1 max-w-xs"
                              title={r.last_error}
                            >
                              {ERROR_PLAIN[r.last_error] ?? r.last_error}
                            </span>
                          )}
                          <span className="flex flex-wrap gap-2 items-center mt-1">
                            <button
                              onClick={() => retry([r.id])}
                              disabled={busy}
                              className="text-xs text-hgl-blue underline hover:text-hgl-slate disabled:opacity-50"
                            >
                              Retry
                            </button>
                            {/* PL-298: the record behind the row, one click. */}
                            {r.tutoring_invoice_id && (
                              <a
                                href={`/admin/tutoring?invoice=${r.tutoring_invoice_id}`}
                                className="text-xs text-hgl-blue underline hover:text-hgl-slate"
                              >
                                View the invoice
                              </a>
                            )}
                            {r.enrollment_id && (
                              <a
                                href={`/admin/communications?enrollment=${r.enrollment_id}`}
                                className="text-xs text-hgl-blue underline hover:text-hgl-slate"
                              >
                                View the enrollment
                              </a>
                            )}
                            <DismissControl id={r.id} busy={busy} onDone={fetchLog} />
                          </span>
                        </>
                      )}
                      {r.status === 'dismissed' && (
                        <>
                          {r.dismissed_reason && (
                            <span className="block text-xs text-gray-500 mt-1 max-w-xs">
                              {r.dismissed_reason}
                              {r.dismissed_by ? ` — ${r.dismissed_by}` : ''}
                            </span>
                          )}
                          <button
                            onClick={async () => {
                              setBusy(true)
                              await fetch('/api/qbo/dismiss', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ id: r.id, action: 'reinstate' }),
                              })
                              setBusy(false)
                              fetchLog()
                            }}
                            disabled={busy}
                            className="text-xs text-gray-500 underline hover:text-hgl-slate disabled:opacity-50"
                          >
                            reinstate
                          </button>
                        </>
                      )}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {docLink ? (
                        <a
                          href={docLink}
                          target="_blank"
                          rel="noopener"
                          className="text-hgl-blue underline hover:text-hgl-slate"
                        >
                          {r.qbo_doc_number ?? r.qbo_doc_id}
                        </a>
                      ) : r.qbo_doc_id ? (
                        // PL-281: TimeActivity has no per-txn page — plain id.
                        <span className="text-gray-500" title="QuickBooks time entry id">
                          {r.qbo_doc_id}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
