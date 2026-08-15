'use client'

import { useEffect, useState } from 'react'

// PL-321: Settings → Price list — the single editable pricing source.
// Admin-only (the GET 403s managers, so the card hides itself). Tier prices
// are DERIVED: base rate − per-tier discount; editing the base moves every
// tier price with it. Everything future resolves from here at render time
// (register dropdown, checkout validation, engagement-rate prefills, the
// late fees); everything already paid stays frozen as paid.

type Pkg = {
  id: string
  name: string
  hours: number
  hourly_rate: number
  package_price: number
  regular_hourly_rate: number
  discount_per_hour: number
  phase: string
  tier: string
  active: boolean
}

const TIER_LABELS: Record<string, string> = {
  international: 'International (school classes & online)',
  domestic: 'Domestic (at Higher Ground)',
}

function NumberEdit({
  value,
  onSave,
  prefix = '$',
  suffix = '',
  busy,
}: {
  value: number
  onSave: (v: number) => void
  prefix?: string
  suffix?: string
  busy: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(String(value))
  if (!editing) {
    return (
      <button
        type="button"
        className="underline decoration-dotted hover:text-hgl-blue"
        onClick={() => {
          setDraft(String(value))
          setEditing(true)
        }}
        title="Click to edit"
      >
        {prefix}
        {value}
        {suffix}
      </button>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      <input
        autoFocus
        type="number"
        step="1"
        min="0"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        className="border border-gray-300 rounded p-0.5 w-20 text-sm"
      />
      <button
        type="button"
        disabled={busy || draft.trim() === '' || Number.isNaN(Number(draft))}
        onClick={() => {
          setEditing(false)
          onSave(Number(draft))
        }}
        className="text-hgl-blue text-xs font-semibold underline disabled:opacity-50"
      >
        save
      </button>
      <button type="button" onClick={() => setEditing(false)} className="text-gray-400 text-xs underline">
        cancel
      </button>
    </span>
  )
}

export default function PricingPanel() {
  const [data, setData] = useState<{
    packages: Pkg[]
    subjectRates: Record<string, number[]>
    lateRescheduleFee: number
    lateFeePercent: number
  } | null>(null)
  const [visible, setVisible] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const load = async () => {
    const res = await fetch('/api/admin/pricing')
    if (!res.ok) return setVisible(false)
    const json = await res.json().catch(() => null)
    if (!json) return setVisible(false)
    setData(json)
    setVisible(true)
  }
  useEffect(() => {
    load()
  }, [])

  if (!visible || !data) return null

  const post = async (body: Record<string, unknown>) => {
    setBusy(true)
    setErr(null)
    const res = await fetch('/api/admin/pricing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    setBusy(false)
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      setErr(j.error ?? 'Save failed.')
      return
    }
    await load()
  }

  const tiers = [...new Set(data.packages.filter((p) => p.phase === 'pre_class').map((p) => p.tier))]

  return (
    <div className="space-y-6 text-sm">
      <p className="text-gray-500">
        The one place prices live. Hour-block tiers are <span className="font-semibold">derived</span>:
        base rate − per-tier discount — raise a base rate and every tier price moves with it.
        Changes are forward-only: receipts and invoices already issued stay exactly as paid.
      </p>
      {err && <p className="text-red-600 font-semibold">{err}</p>}

      {tiers.map((tier) => {
        const rows = data.packages.filter((p) => p.tier === tier && p.phase === 'pre_class')
        const base = rows[0]?.regular_hourly_rate ?? 0
        return (
          <div key={tier} className="border border-gray-200 rounded-lg p-4">
            <p className="font-bold text-hgl-slate mb-1">
              Add-on hour blocks — {TIER_LABELS[tier] ?? tier}
            </p>
            <p className="text-xs text-gray-500 mb-2">
              Base rate:{' '}
              <NumberEdit
                value={base}
                busy={busy}
                suffix="/hr"
                onSave={(v) => post({ action: 'set_tier_base', tier, phase: 'pre_class', base: v })}
              />{' '}
              — the strike-through &quot;regularly $X/hour&quot; figure and what discounts subtract from.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-500 border-b border-gray-200">
                    <th className="py-1 pr-3">Block</th>
                    <th className="py-1 pr-3">Discount off base</th>
                    <th className="py-1 pr-3">Family rate</th>
                    <th className="py-1">Package price</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p) => (
                    <tr key={p.id} className="border-b border-gray-100">
                      <td className="py-1.5 pr-3">{p.hours} hours</td>
                      <td className="py-1.5 pr-3">
                        <NumberEdit
                          value={p.discount_per_hour}
                          busy={busy}
                          suffix="/hr"
                          onSave={(v) => post({ action: 'set_package_discount', id: p.id, discount: v })}
                        />
                      </td>
                      <td className="py-1.5 pr-3 font-semibold">${p.hourly_rate}/hr</td>
                      <td className="py-1.5">${Number(p.package_price).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      })}

      {/* PL-322: post-class hourly is per-tier and derived too — same base
          rates, the intl −$5/−$15 offsets applied to each tier's base. */}
      {[...new Set(data.packages.filter((p) => p.phase === 'post_class').map((p) => p.tier))].map(
        (tier) => {
          const rows = data.packages.filter((p) => p.tier === tier && p.phase === 'post_class')
          const base = rows[0]?.regular_hourly_rate ?? 0
          return (
            <div key={`post-${tier}`} className="border border-gray-200 rounded-lg p-4">
              <p className="font-bold text-hgl-slate mb-1">
                Post-class hourly — {TIER_LABELS[tier] ?? tier}
              </p>
              <p className="text-xs text-gray-500 mb-2">
                Base rate:{' '}
                <NumberEdit
                  value={base}
                  busy={busy}
                  suffix="/hr"
                  onSave={(v) => post({ action: 'set_tier_base', tier, phase: 'post_class', base: v })}
                />
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <tbody>
                    {rows.map((p) => (
                      <tr key={p.id} className="border-b border-gray-100">
                        <td className="py-1.5 pr-3">{p.name}</td>
                        <td className="py-1.5 pr-3">
                          discount{' '}
                          <NumberEdit
                            value={p.discount_per_hour}
                            busy={busy}
                            suffix="/hr"
                            onSave={(v) => post({ action: 'set_package_discount', id: p.id, discount: v })}
                          />
                        </td>
                        <td className="py-1.5 font-semibold">${p.hourly_rate}/hr</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )
        }
      )}

      <div className="border border-gray-200 rounded-lg p-4 space-y-1.5">
        <p className="font-bold text-hgl-slate">Base 1-on-1 hourly rates</p>
        <p className="text-xs text-gray-500 mb-1">
          New engagements prefill from these (per subject category). Existing engagement rates and
          issued invoices never move.
        </p>
        {(['test_prep', 'subject_tutoring'] as const).map((cat) => {
          const rates = data.subjectRates[cat] ?? []
          return (
            <p key={cat}>
              {cat === 'test_prep' ? 'Test prep' : 'Subject tutoring'}:{' '}
              {rates.length === 1 ? (
                <NumberEdit
                  value={rates[0]}
                  busy={busy}
                  suffix="/hr"
                  onSave={(v) => post({ action: 'set_subject_rate', category: cat, rate: v })}
                />
              ) : (
                <span className="text-amber-700">
                  mixed per-subject rates ({rates.map((r) => `$${r}`).join(', ')}) — edit per
                  subject to keep the overrides, or save one number here to unify
                  <NumberEdit
                    value={rates[0] ?? 0}
                    busy={busy}
                    suffix="/hr"
                    onSave={(v) => post({ action: 'set_subject_rate', category: cat, rate: v })}
                  />
                </span>
              )}
            </p>
          )
        })}
      </div>

      <div className="border border-gray-200 rounded-lg p-4 space-y-1.5">
        <p className="font-bold text-hgl-slate">Fees (signed policy)</p>
        <p>
          Late-reschedule fee (under 24h notice):{' '}
          <NumberEdit
            value={data.lateRescheduleFee}
            busy={busy}
            suffix="/hr"
            onSave={(v) => post({ action: 'set_fee', key: 'late_reschedule_fee_per_hour', value: v })}
          />
        </p>
        <p>
          Late-payment fee (30+ days, applied by hand, never automatic):{' '}
          <NumberEdit
            value={data.lateFeePercent}
            busy={busy}
            prefix=""
            suffix="%"
            onSave={(v) => post({ action: 'set_fee', key: 'late_fee_percent', value: v })}
          />
        </p>
        <p className="text-xs text-gray-400">
          Family-facing email copy still states the signed-policy figures — changing these numbers
          changes what gets charged, and the copy is edited on the templates page.
        </p>
      </div>

      <ProductsCard />

      <p className="text-xs text-gray-400">
        Class prices are per-class (set in the wizard, editable on each roster card) and follow-up
        discounts are per-class promo codes — both intentionally not here.
      </p>
    </div>
  )
}

// PL-364: the physical add-on products (notebooks) — sold on the class
// registration flow's second page, fulfilled via Printful. Sale pricing is
// COMPOSED from these two numbers ("$35.00, regularly $48.00") — never
// hand-typed into copy. The Printful variant id is the fulfillment mapping;
// without it, orders fail honestly into Needs Attention until it's set.
function ProductsCard() {
  const [rows, setRows] = useState<
    { id: string; name: string; price: number; regular_price: number | null; active: boolean; printful_variant_id: number | null }[] | null
  >(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const load = async () => {
    const res = await fetch('/api/admin/products')
    if (!res.ok) return
    const j = await res.json().catch(() => null)
    if (j?.products) setRows(j.products)
  }
  useEffect(() => {
    load()
  }, [])
  if (!rows) return null

  const save = async (id: string, fields: Record<string, unknown>) => {
    setBusy(true)
    setErr('')
    const res = await fetch('/api/admin/products', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ...fields }),
    })
    setBusy(false)
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      setErr(j.error ?? 'Save failed.')
      return
    }
    await load()
  }

  return (
    <div className="border border-gray-200 rounded-lg p-4">
      <p className="font-bold text-hgl-slate mb-1">Physical add-ons (registration flow)</p>
      <p className="text-xs text-gray-500 mb-3">
        Sold on the class registration&apos;s add-on step, printed &amp; shipped by Printful.
        &quot;Regularly&quot; blank = no sale line. The Printful variant id maps the product for
        fulfillment — until it&apos;s set (during the sandbox round-trip), paid orders wait on
        Needs Attention with a retry. Forward-only: paid orders keep their price.
      </p>
      {err && <p className="text-red-600 font-semibold mb-2">{err}</p>}
      <div className="space-y-2">
        {rows.map((p) => (
          <div key={p.id} className="flex flex-wrap items-center gap-3 text-sm">
            <span className="font-semibold text-hgl-slate min-w-56">{p.name}</span>
            <span>
              Price:{' '}
              <NumberEdit value={Number(p.price)} busy={busy} onSave={(v) => save(p.id, { price: v })} />
            </span>
            <span>
              Regularly:{' '}
              <NumberEdit
                value={p.regular_price != null ? Number(p.regular_price) : 0}
                busy={busy}
                onSave={(v) => save(p.id, { regular_price: v > 0 ? v : null })}
              />
              <span className="text-xs text-gray-400"> (0 clears)</span>
            </span>
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={p.active}
                onChange={(e) => save(p.id, { active: e.target.checked })}
                disabled={busy}
              />
              offered
            </label>
            <span className="text-xs text-gray-500">
              Printful variant:{' '}
              <input
                defaultValue={p.printful_variant_id ?? ''}
                onBlur={(e) => {
                  const v = e.target.value.trim()
                  if (String(p.printful_variant_id ?? '') !== v) save(p.id, { printful_variant_id: v || null })
                }}
                placeholder="not mapped"
                className="border border-gray-300 rounded px-1.5 py-0.5 w-28 font-mono text-xs"
              />
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
