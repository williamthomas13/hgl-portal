import { createHmac, timingSafeEqual } from 'crypto'
import { supabaseAdmin as supabase } from './supabase-admin'

// PL-202: calls v1 — Quo (formerly OpenPhone) webhooks land in the portal.
// This module is the PROVIDER SEAM: the receiver verifies + normalizes here,
// and everything downstream (processCallEvent) works on the internal shape
// only. Quo signup is down the road ("a ways", per Scarlett) — everything is
// built and tested against Standard-Webhooks test deliveries.
//
// Configuration ≠ activation (the intl-calendar lesson): the webhook secret
// and API key are configuration; `quo_calls_enabled` = 'true' in
// app_settings is the separate, explicit switch. The receiver acknowledges
// but drops events while disabled.

/* eslint-disable @typescript-eslint/no-explicit-any */

// ---------------------------------------------------------------------------
// Phone normalization — the portal's stored numbers arrive in every format
// ("(303) 555-0101", "303-555-0101", "+1 303 555 0101"); both sides
// normalize to E164 before comparing.
// ---------------------------------------------------------------------------

export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null
  const digits = raw.replace(/[^\d+]/g, '')
  if (!digits) return null
  if (digits.startsWith('+')) return `+${digits.slice(1).replace(/\D/g, '')}`
  const bare = digits.replace(/\D/g, '')
  if (bare.length === 10) return `+1${bare}` // NANP default
  if (bare.length === 11 && bare.startsWith('1')) return `+${bare}`
  return `+${bare}` // international without the plus — best effort
}

// ---------------------------------------------------------------------------
// Standard Webhooks verification (Svix-compatible): signature =
// base64(hmac_sha256(secret, `${id}.${timestamp}.${payload}`)), sent as
// `webhook-signature: v1,<sig>` (possibly several, space-separated).
// ---------------------------------------------------------------------------

export function verifyStandardWebhook(opts: {
  id: string | null
  timestamp: string | null
  signatureHeader: string | null
  payload: string
  secret: string
  nowMs?: number
}): boolean {
  if (!opts.id || !opts.timestamp || !opts.signatureHeader || !opts.secret) return false
  // Reject stale/future timestamps (replay window ±5 minutes).
  const ts = Number(opts.timestamp)
  const now = (opts.nowMs ?? Date.now()) / 1000
  if (!Number.isFinite(ts) || Math.abs(now - ts) > 300) return false

  const secretBytes = opts.secret.startsWith('whsec_')
    ? Buffer.from(opts.secret.slice(6), 'base64')
    : Buffer.from(opts.secret, 'utf8')
  const expected = createHmac('sha256', secretBytes)
    .update(`${opts.id}.${opts.timestamp}.${opts.payload}`)
    .digest('base64')
  const expectedBuf = Buffer.from(expected)
  return opts.signatureHeader.split(' ').some((part) => {
    const sig = part.includes(',') ? part.slice(part.indexOf(',') + 1) : part
    const got = Buffer.from(sig)
    return got.length === expectedBuf.length && timingSafeEqual(got, expectedBuf)
  })
}

// ---------------------------------------------------------------------------
// Normalization: Quo payload → the internal call-event shape.
// ---------------------------------------------------------------------------

export type CallEvent = {
  providerEventId: string
  eventType: 'completed' | 'missed' | 'voicemail'
  direction: 'incoming' | 'outgoing' | null
  phone: string // E164 — the EXTERNAL party's number
  durationSeconds: number | null
  voicemailUrl: string | null
  occurredAt: string
  raw: any
}

/** Quo event types → ours; null = an event v1 doesn't handle (ack + drop). */
export function normalizeQuoEvent(body: any): CallEvent | null {
  const type = String(body?.type ?? '')
  const data = body?.data?.object ?? body?.data ?? {}
  const map: Record<string, CallEvent['eventType']> = {
    'call.completed': 'completed',
    'call.missed': 'missed',
    'call.voicemail.completed': 'voicemail',
  }
  const eventType = map[type]
  if (!eventType) return null
  const direction =
    data.direction === 'incoming' || data.direction === 'inbound'
      ? 'incoming'
      : data.direction === 'outgoing' || data.direction === 'outbound'
        ? 'outgoing'
        : null
  // The external party: `from` on incoming, `to` on outgoing.
  const rawPhone = direction === 'outgoing' ? (data.to ?? data.from) : (data.from ?? data.to)
  const phone = normalizePhone(typeof rawPhone === 'string' ? rawPhone : rawPhone?.phoneNumber)
  if (!phone) return null
  return {
    providerEventId: String(body?.id ?? `${type}:${data.id ?? ''}`),
    eventType,
    direction,
    phone,
    durationSeconds: data.duration != null ? Number(data.duration) : null,
    voicemailUrl: data.voicemail?.url ?? data.recordingUrl ?? null,
    occurredAt: data.completedAt ?? data.createdAt ?? body?.createdAt ?? new Date().toISOString(),
    raw: body,
  }
}

// ---------------------------------------------------------------------------
// Processing: match the caller, log the event, grow the pipeline.
// ---------------------------------------------------------------------------

export async function quoEnabled(): Promise<boolean> {
  const { data } = await supabase.from('app_settings').select('value').eq('key', 'quo_calls_enabled').maybeSingle()
  return data?.value === 'true'
}

const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString('en-US', {
    timeZone: 'America/Denver',
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  })

export async function processCallEvent(
  ev: CallEvent
): Promise<{ ok: boolean; matched: 'family' | 'lead' | 'new_lead' | 'duplicate'; id?: string }> {
  // Webhook redeliveries dedupe on the provider's event id.
  const { data: existing } = await supabase
    .from('call_events')
    .select('id')
    .eq('provider_event_id', ev.providerEventId)
    .maybeSingle()
  if (existing) return { ok: true, matched: 'duplicate', id: existing.id }

  // Match against parent + guardian + student numbers (E164 both sides).
  const [{ data: fams }, { data: studs }] = await Promise.all([
    supabase.from('families').select('id, parent_phone, guardian2_phone'),
    supabase.from('students').select('id, family_id, student_phone').not('student_phone', 'is', null),
  ])
  let familyId: string | null = null
  let studentId: string | null = null
  for (const f of fams ?? []) {
    if (normalizePhone(f.parent_phone) === ev.phone || normalizePhone(f.guardian2_phone) === ev.phone) {
      familyId = f.id
      break
    }
  }
  if (!familyId) {
    for (const s of studs ?? []) {
      if (normalizePhone(s.student_phone) === ev.phone) {
        familyId = s.family_id
        studentId = s.id
        break
      }
    }
  }

  let leadId: string | null = null
  let matched: 'family' | 'lead' | 'new_lead' = 'family'
  if (!familyId) {
    // Unknown caller → the pipeline (PL-182 machinery), ONE lead per number:
    // repeat calls fold into the existing open lead instead of stacking.
    const { data: leads } = await supabase
      .from('leads')
      .select('id, contact_phone, status, notes')
      .not('contact_phone', 'is', null)
      .not('status', 'in', '("scheduled","lost")')
    const open = (leads ?? []).find((l) => normalizePhone(l.contact_phone) === ev.phone)
    const line = `${ev.eventType === 'missed' ? 'Missed call' : ev.eventType === 'voicemail' ? 'Voicemail' : 'Call'} ${fmtWhen(ev.occurredAt)}${
      ev.durationSeconds ? ` — ${Math.max(1, Math.round(ev.durationSeconds / 60))} min` : ''
    }.`
    if (open) {
      leadId = open.id
      matched = 'lead'
      await supabase
        .from('leads')
        .update({
          notes: [open.notes, line].filter(Boolean).join('\n'),
          updated_at: new Date().toISOString(),
        })
        .eq('id', open.id)
    } else {
      matched = 'new_lead'
      const { data: lead } = await supabase
        .from('leads')
        .insert({
          source: 'call',
          status: 'new',
          contact_phone: ev.phone,
          contact_name: null,
          notes: `Unknown caller ${fmtWhen(ev.occurredAt)}${
            ev.durationSeconds ? ` — ${Math.max(1, Math.round(ev.durationSeconds / 60))} min call` : ''
          }. Who was this?`,
        })
        .select('id')
        .single()
      leadId = lead?.id ?? null
    }
  }

  const { data: row, error } = await supabase
    .from('call_events')
    .insert({
      provider: 'quo',
      provider_event_id: ev.providerEventId,
      event_type: ev.eventType,
      direction: ev.direction,
      phone_e164: ev.phone,
      family_id: familyId,
      student_id: studentId,
      lead_id: leadId,
      duration_seconds: ev.durationSeconds,
      voicemail_url: ev.voicemailUrl,
      occurred_at: ev.occurredAt,
      raw: ev.raw,
    })
    .select('id')
    .single()
  if (error) {
    // A redelivery race on the unique key is success, not failure.
    if (error.code === '23505') return { ok: true, matched: 'duplicate' }
    throw new Error(`call event insert failed: ${error.message}`)
  }
  return { ok: true, matched: familyId ? 'family' : matched, id: row.id }
}

// ---------------------------------------------------------------------------
// Contact sync OUT — the externalId trick: Kelsie's caller ID reads
// "Willie Tomás (HGL)" and future payloads carry the match for free.
// One-way portal → Quo; the portal stays the system of record.
// ---------------------------------------------------------------------------

export function buildQuoContactPayload(family: {
  id: string
  parent_first_name: string | null
  parent_last_name: string | null
  parent_phone: string | null
  parent_email: string | null
}): any | null {
  const phone = normalizePhone(family.parent_phone)
  if (!phone) return null
  return {
    defaultFields: {
      firstName: family.parent_first_name ?? '',
      lastName: `${family.parent_last_name ?? ''} (HGL)`.trim(),
      phoneNumbers: [{ name: 'primary', value: phone }],
      emails: family.parent_email ? [{ name: 'primary', value: family.parent_email }] : [],
    },
    source: 'portal',
    externalId: family.id,
  }
}

export async function pushContactsToQuo(): Promise<{ pushed: number; skipped: number; error?: string }> {
  const key = process.env.QUO_API_KEY
  if (!key) return { pushed: 0, skipped: 0, error: 'QUO_API_KEY is not configured yet.' }
  if (!(await quoEnabled())) return { pushed: 0, skipped: 0, error: 'Quo calls are not enabled yet (Settings).' }
  const { data: fams } = await supabase
    .from('families')
    .select('id, parent_first_name, parent_last_name, parent_phone, parent_email')
    .not('parent_phone', 'is', null)
  let pushed = 0
  let skipped = 0
  for (const f of fams ?? []) {
    const payload = buildQuoContactPayload(f)
    if (!payload) {
      skipped++
      continue
    }
    const res = await fetch('https://api.openphone.com/v1/contacts', {
      method: 'POST',
      headers: { Authorization: key, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (res.ok) pushed++
    else skipped++
  }
  return { pushed, skipped }
}
