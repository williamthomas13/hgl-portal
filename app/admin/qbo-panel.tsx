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
    Record<'group_class' | 'tutoring_addon' | 'deposit_account', { value: string; name?: string }>
  >
  pendingCount: number
  failedCount: number
  callerRole: 'admin' | 'manager'
}

export function qboDocLink(status: QboStatus | null, kind: string, docId: string | null) {
  if (!status || !docId) return null
  return `${status.appHost}/app/${kind === 'sale' ? 'salesreceipt' : 'refundreceipt'}?txnId=${docId}`
}

type SyncLogRow = {
  id: string
  kind: 'sale' | 'refund'
  status: 'pending' | 'synced' | 'failed'
  amount: number | null
  attempts: number
  last_error: string | null
  qbo_doc_id: string | null
  qbo_doc_number: string | null
  stripe_payment_intent_id: string
  created_at: string
  synced_at: string | null
  enrollments: {
    students: {
      first_name: string
      last_name: string
    } | null
    classes: { class_type: string; schools: { nickname: string } | null } | null
  } | null
}

type CatalogEntry = { id: string; name: string; account?: string | null }

const MAPPING_ROWS: { key: 'group_class' | 'tutoring_addon' | 'deposit_account'; label: string; hint: string; source: 'items' | 'accounts' }[] = [
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
}

export default function QboPanel({ status, onStatusChange }: { status: QboStatus | null; onStatusChange: () => void }) {
  const [log, setLog] = useState<SyncLogRow[]>([])
  const [logFilter, setLogFilter] = useState('')
  const [busy, setBusy] = useState(false)
  const [banner, setBanner] = useState('')
  const [catalog, setCatalog] = useState<{ items: CatalogEntry[]; accounts: CatalogEntry[] } | null>(null)
  const [catalogError, setCatalogError] = useState('')
  const [pendingMap, setPendingMap] = useState<Record<string, string>>({})

  const fetchLog = useCallback(async () => {
    const since = new Date(Date.now() - 90 * 24 * 3_600_000).toISOString()
    const { data } = await supabase
      .from('qbo_sync_log')
      .select(
        `
        id, kind, status, amount, attempts, last_error, qbo_doc_id, qbo_doc_number,
        stripe_payment_intent_id, created_at, synced_at,
        enrollments ( students ( first_name, last_name ),
          classes ( class_type, schools ( nickname ) ) )
      `
      )
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(200)
    if (data) setLog(data as unknown as SyncLogRow[])
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchLog()
    // OAuth round-trip lands on /admin?qbo=<status> — surface it once.
    const params = new URLSearchParams(window.location.search)
    const outcome = params.get('qbo')
    if (outcome) {
      const messages: Record<string, string> = {
        connected: '✓ QuickBooks connected.',
        cancelled: 'QuickBooks connection was cancelled at Intuit.',
        invalid: 'The QuickBooks sign-in link expired — try Connect again.',
        denied: 'Only an admin can connect QuickBooks.',
        error: 'QuickBooks connection failed — check the server logs and try again.',
      }
      setBanner(messages[outcome] ?? '')
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
    setCatalog(await res.json())
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
                const docLink = qboDocLink(status, r.kind, r.qbo_doc_id)
                return (
                  <tr key={r.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2 whitespace-nowrap text-gray-500">
                      {formatTimestampAdmin(r.created_at)}
                    </td>
                    <td className="px-3 py-2">
                      {student ? `${student.first_name} ${student.last_name}` : '—'}
                      <span className="text-gray-400">
                        {' '}
                        · {cls?.schools?.nickname ?? ''} {cls?.class_type ?? ''}
                      </span>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">{r.kind}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {r.amount != null ? `$${Number(r.amount).toFixed(2)}` : '—'}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${badge.cls}`}>
                        {badge.text}
                      </span>
                      {r.status === 'failed' && (
                        <>
                          {r.last_error && (
                            <span className="block text-xs text-red-500 mt-1 max-w-xs truncate" title={r.last_error}>
                              {r.last_error}
                            </span>
                          )}
                          <button
                            onClick={() => retry([r.id])}
                            disabled={busy}
                            className="text-xs text-hgl-blue underline hover:text-hgl-slate disabled:opacity-50"
                          >
                            Retry
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
