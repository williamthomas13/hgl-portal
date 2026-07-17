'use client'

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../utils/supabase'
import { ConfirmAction } from './confirm'

// Staff billing panel (Phase 7c §6): invoices by month, plain-English
// statuses, and the human-path actions — confirm on a family's behalf, send
// now, retry a charge, adjustment/credit lines, the staff-applied 10% late
// fee (flagged at 30 days, never automatic), void, and the monthly-cycle
// trigger for off-schedule runs.

type LineRow = { id: string; description: string; amount: number; kind: string }

type InvoiceRow = {
  id: string
  family_id: string
  period: string
  status: 'draft' | 'proposed' | 'confirmed' | 'invoiced' | 'paid' | 'past_due' | 'void'
  total: number
  due_at: string | null
  paid_at: string | null
  proposal_sent_at: string | null
  auto_confirmed: boolean
  change_request_note: string | null
  change_requested_at: string | null
  stripe_hosted_invoice_url: string | null
  charge_attempts: number
  late_fee_flagged_at: string | null
  families: { parent_first_name: string; parent_last_name: string | null; parent_email: string; autopay: boolean } | null
  tutoring_invoice_lines: LineRow[]
}

const STATUS_LABELS: Record<InvoiceRow['status'], string> = {
  draft: 'Draft',
  proposed: 'Awaiting family confirmation',
  confirmed: 'Confirmed — not yet billed',
  invoiced: 'Invoice sent',
  paid: 'Paid',
  past_due: 'Past due',
  void: 'Void',
}

const STATUS_STYLES: Record<InvoiceRow['status'], string> = {
  draft: 'bg-gray-100 text-gray-600',
  proposed: 'bg-blue-100 text-blue-700',
  confirmed: 'bg-indigo-100 text-indigo-700',
  invoiced: 'bg-amber-100 text-amber-800',
  paid: 'bg-green-100 text-green-700',
  past_due: 'bg-red-100 text-red-700',
  void: 'bg-gray-200 text-gray-500',
}

 
function one<T>(v: T | T[] | null | undefined): T | null {
  if (v == null) return null
  return Array.isArray(v) ? ((v[0] as T) ?? null) : v
}
 

/** PL-5: timestamps like due_at (23:59 America/Denver) must be rendered in
 *  Denver — slicing the UTC ISO string shows the next calendar day. */
function denverDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Denver' })
}

function monthLabel(period: string): string {
  return new Date(period.slice(0, 10) + 'T12:00:00Z').toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

export default function InvoicesPanel() {
  const [rows, setRows] = useState<InvoiceRow[]>([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [expanded, setExpanded] = useState('')
  const [lineForm, setLineForm] = useState<{ id: string; kind: 'adjustment' | 'credit'; description: string; amount: string } | null>(null)
  const [genMonth, setGenMonth] = useState('')

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('tutoring_invoices')
      .select(
        `id, family_id, period, status, total, due_at, paid_at, proposal_sent_at, auto_confirmed,
         change_request_note, change_requested_at, stripe_hosted_invoice_url, charge_attempts,
         late_fee_flagged_at,
         families ( parent_first_name, parent_last_name, parent_email, autopay ),
         tutoring_invoice_lines ( id, description, amount, kind )`
      )
      .order('period', { ascending: false })
      .limit(120)
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
    setRows(((data as any[]) ?? []).map((r) => ({ ...r, families: one(r.families) })))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function call(path: string, body: Record<string, unknown>, done: string) {
    setBusy(true)
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const json = await res.json()
    setBusy(false)
    setMessage(res.ok ? done : 'Error: ' + json.error)
    setLineForm(null)
    load()
    return res.ok
  }

  const invoiceCall = (body: Record<string, unknown>, done: string) =>
    call('/api/admin/tutoring/invoice', body, done)

  const periods = [...new Set(rows.map((r) => String(r.period)))]

  return (
    <div className="space-y-5 text-sm">
      <div className="flex flex-wrap items-center gap-2 bg-gray-50 border border-gray-200 rounded p-3">
        <span className="text-xs font-semibold text-gray-600">Run the monthly cycle now:</span>
        <input
          type="month"
          value={genMonth}
          onChange={(e) => setGenMonth(e.target.value)}
          className="border border-gray-300 rounded p-1 text-xs bg-white"
        />
        <button
          disabled={busy}
          onClick={() =>
            call(
              '/api/admin/tutoring/cycle',
              { action: 'generate', ...(genMonth ? { month: genMonth } : {}) },
              'Cycle generated — proposals sent where due.'
            )
          }
          className="text-xs font-semibold text-hgl-blue underline disabled:opacity-50"
        >
          generate {genMonth || 'next month'}
        </button>
        <button
          disabled={busy}
          onClick={() => call('/api/admin/tutoring/cycle', { action: 'sweep' }, 'Sweeps run.')}
          className="text-xs font-semibold text-gray-500 underline disabled:opacity-50"
        >
          run sweeps (nudges · auto-confirm · collections)
        </button>
        <span className="text-[11px] text-gray-400 w-full">
          The daily cron does all of this on schedule (generation on the settings day, default the
          20th) — these buttons are for off-cycle runs.
        </span>
      </div>

      {rows.length === 0 && (
        <p className="text-gray-500 italic">
          No invoices yet — the first generation run creates a draft per family with sessions next month.
        </p>
      )}

      {periods.map((p) => (
        <div key={p} className="border border-gray-200 rounded-lg p-4">
          <div className="font-bold text-hgl-slate mb-2">{monthLabel(p)}</div>
          <div className="space-y-2">
            {rows
              .filter((r) => String(r.period) === p)
              .map((r) => (
                <div key={r.id} className={`rounded p-3 ${r.status === 'void' ? 'bg-gray-100 opacity-60' : 'bg-gray-50'}`}>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="font-semibold text-hgl-slate">
                      {r.families?.parent_first_name} {r.families?.parent_last_name ?? ''}
                    </span>
                    <span className="text-xs text-gray-400">{r.families?.parent_email}</span>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${STATUS_STYLES[r.status]}`}>
                      {STATUS_LABELS[r.status]}
                    </span>
                    {r.auto_confirmed && <span className="text-[10px] text-gray-400 uppercase">auto-confirmed</span>}
                    {r.families?.autopay && <span className="text-[10px] text-purple-600 uppercase font-bold">autopay</span>}
                    {r.charge_attempts > 0 && r.status !== 'paid' && (
                      <span className="text-[10px] text-amber-700">charge attempts: {r.charge_attempts}</span>
                    )}
                    {r.late_fee_flagged_at && r.status !== 'paid' && (
                      <span className="text-[10px] text-red-700 font-bold uppercase">30d+ — late-fee decision</span>
                    )}
                    <span className="font-bold text-hgl-slate ml-auto">${Number(r.total).toFixed(2)}</span>
                    <button onClick={() => setExpanded(expanded === r.id ? '' : r.id)} className="text-xs text-hgl-blue underline">
                      {expanded === r.id ? 'hide' : 'details'}
                    </button>
                  </div>

                  {r.change_requested_at && (
                    <div className="mt-2 text-xs bg-amber-50 border border-amber-200 rounded p-2 text-amber-900">
                      <strong>Change requested</strong> — auto-confirm is paused:
                      <pre className="whitespace-pre-wrap font-sans mt-1">{r.change_request_note}</pre>
                      <button
                        disabled={busy}
                        onClick={() => invoiceCall({ action: 'mark_change_handled', id: r.id }, 'Marked handled — the auto-confirm clock resumes.')}
                        className="underline text-hgl-blue mt-1"
                      >
                        mark handled
                      </button>
                    </div>
                  )}

                  {expanded === r.id && (
                    <div className="mt-3 space-y-2">
                      <div className="text-xs">
                        {(r.tutoring_invoice_lines ?? []).map((l) => (
                          <div key={l.id} className="flex justify-between py-0.5 text-gray-600">
                            <span>
                              {l.description}
                              {l.kind !== 'session' && <span className="text-gray-400"> · {l.kind.replace(/_/g, ' ')}</span>}
                            </span>
                            <span>${Number(l.amount).toFixed(2)}</span>
                          </div>
                        ))}
                      </div>
                      <div className="flex flex-wrap gap-3 text-xs items-center">
                        {(r.status === 'draft' || r.status === 'proposed') && (
                          <ConfirmAction
                            label="confirm for family"
                            message="Confirm on the family's behalf (phone/email request)? Sessions lock in and billing follows."
                            confirmLabel="Yes, confirm"
                            className="text-indigo-700 underline"
                            disabled={busy}
                            onConfirm={() => invoiceCall({ action: 'confirm', id: r.id }, 'Confirmed — sessions locked, billing follows.')}
                          />
                        )}
                        {r.status === 'confirmed' && (
                          <button
                            disabled={busy}
                            onClick={() => invoiceCall({ action: 'send_now', id: r.id }, 'Sent to collection (invoice or autopay charge).')}
                            className="text-hgl-blue underline"
                          >
                            send now
                          </button>
                        )}
                        {(r.status === 'invoiced' || r.status === 'past_due') && r.families?.autopay && (
                          <button
                            disabled={busy}
                            onClick={() => invoiceCall({ action: 'retry_charge', id: r.id }, 'Charge retried.')}
                            className="text-hgl-blue underline"
                          >
                            retry charge
                          </button>
                        )}
                        {r.stripe_hosted_invoice_url && (
                          <a href={r.stripe_hosted_invoice_url} target="_blank" rel="noopener" className="text-gray-500 underline">
                            hosted invoice ↗
                          </a>
                        )}
                        {!['paid', 'void'].includes(r.status) && (
                          <>
                            <button
                              disabled={busy}
                              onClick={() => setLineForm({ id: r.id, kind: 'adjustment', description: '', amount: '' })}
                              className="text-gray-600 underline"
                            >
                              add adjustment/credit…
                            </button>
                            {r.late_fee_flagged_at && (
                              <ConfirmAction
                                label="apply 10% late fee"
                                message={`Add $${(Number(r.total) * 0.1).toFixed(2)} (10%) per the signed policy? Your call — never automatic.`}
                                confirmLabel="Yes, apply"
                                className="text-red-700 underline"
                                disabled={busy}
                                onConfirm={() => invoiceCall({ action: 'apply_late_fee', id: r.id }, 'Late fee applied and the invoice re-issued.')}
                              />
                            )}
                            <ConfirmAction
                              label="void"
                              message="Void this month's invoice? Sessions are untouched; use for do-overs."
                              confirmLabel="Yes, void"
                              className="text-red-600 underline"
                              disabled={busy}
                              onConfirm={() => invoiceCall({ action: 'void', id: r.id }, 'Invoice voided.')}
                            />
                          </>
                        )}
                        {/* PL-5: due_at is 23:59 Denver — a UTC date slice reads one day late */}
                        {r.due_at && <span className="text-gray-400">due {denverDate(r.due_at)}</span>}
                        {r.paid_at && <span className="text-green-700">paid {denverDate(r.paid_at)}</span>}
                      </div>

                      {lineForm?.id === r.id && (
                        <div className="flex flex-wrap items-center gap-2 text-xs bg-white border border-gray-200 rounded p-2">
                          <select
                            value={lineForm.kind}
                            onChange={(e) => setLineForm({ ...lineForm, kind: e.target.value as 'adjustment' | 'credit' })}
                            className="border border-gray-300 rounded p-1 bg-white"
                          >
                            <option value="adjustment">Adjustment (charge)</option>
                            <option value="credit">Credit (reduce)</option>
                          </select>
                          <input
                            type="text"
                            placeholder="Description (families see this)"
                            value={lineForm.description}
                            onChange={(e) => setLineForm({ ...lineForm, description: e.target.value })}
                            className="border border-gray-300 rounded p-1 flex-1 min-w-40"
                          />
                          <input
                            type="number"
                            placeholder="$"
                            min="0"
                            step="0.01"
                            value={lineForm.amount}
                            onChange={(e) => setLineForm({ ...lineForm, amount: e.target.value })}
                            className="border border-gray-300 rounded p-1 w-24"
                          />
                          <button
                            disabled={busy || !lineForm.description.trim() || !(Number(lineForm.amount) > 0)}
                            onClick={() =>
                              invoiceCall(
                                {
                                  action: 'add_line',
                                  id: r.id,
                                  kind: lineForm.kind,
                                  description: lineForm.description,
                                  amount: Number(lineForm.amount),
                                },
                                'Line added.'
                              )
                            }
                            className="bg-hgl-slate text-white rounded px-3 py-1 disabled:opacity-50"
                          >
                            Add
                          </button>
                          <button onClick={() => setLineForm(null)} className="text-gray-500 underline">
                            cancel
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
          </div>
        </div>
      ))}

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
