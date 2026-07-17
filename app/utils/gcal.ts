import { supabaseAdmin as supabase } from './supabase-admin'
import { createHash, createCipheriv, createDecipheriv, createSign, randomBytes } from 'crypto'
import { zonedToUtc } from './tutoring'

// Google Calendar client (Phase 7a, docs/PHASE7_SPEC.md §4): service account
// with domain-wide delegation. Principle: portal writes, Google displays;
// Google's busy times inform, portal decides. One-way push + read-only
// free/busy — no two-way sync. Server-only: imports supabase-admin and holds
// the decrypted key in memory only.
//
// Impersonation: every API call runs AS the tutor (JWT `sub` = their
// Workspace address), so events land on their primary calendar as if they
// created them and freebusy sees their self-managed availability blocks.
// This only works for addresses in the HGL Workspace domain — personal
// Gmails cannot be impersonated.

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
const SCOPES = 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.freebusy'
const CAL_BASE = 'https://www.googleapis.com/calendar/v3'

export class GcalApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

// ---------------------------------------------------------------------------
// Key encryption at rest — same scheme as QBO tokens (key derived from
// CRON_SECRET; rotating it surfaces as 'disconnected', fixed by re-pasting
// the JSON key in the admin panel).
// ---------------------------------------------------------------------------

function cryptKey(): Buffer {
  return createHash('sha256')
    .update(`gcal-sa-key:${process.env.CRON_SECRET ?? 'dev-secret'}`)
    .digest()
}

export function encryptSaJson(plain: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', cryptKey(), iv)
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return `${iv.toString('base64')}.${cipher.getAuthTag().toString('base64')}.${enc.toString('base64')}`
}

function decryptSaJson(stored: string): string | null {
  try {
    const [iv, tag, enc] = stored.split('.')
    const decipher = createDecipheriv('aes-256-gcm', cryptKey(), Buffer.from(iv, 'base64'))
    decipher.setAuthTag(Buffer.from(tag, 'base64'))
    return Buffer.concat([decipher.update(Buffer.from(enc, 'base64')), decipher.final()]).toString('utf8')
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Connection (gcal_connection singleton)
// ---------------------------------------------------------------------------

export type ServiceAccountKey = { client_email: string; private_key: string }

export type GcalConnection = {
  status: 'connected' | 'disconnected'
  clientEmail: string | null
  connectedBy: string | null
  connectedAt: string | null
  key: ServiceAccountKey | null
}

export async function loadGcalConnection(): Promise<GcalConnection | null> {
  const { data } = await supabase.from('gcal_connection').select('*').eq('id', 1).maybeSingle()
  if (!data) return null
  const json = decryptSaJson(data.sa_json_enc)
  let key: ServiceAccountKey | null = null
  if (json) {
    try {
      const parsed = JSON.parse(json)
      if (parsed.client_email && parsed.private_key) key = parsed
    } catch {
      key = null
    }
  }
  return {
    // An undecryptable/garbled key means the connection is unusable whatever
    // the stored status says (e.g. CRON_SECRET rotated).
    status: key ? data.status : 'disconnected',
    clientEmail: data.client_email,
    connectedBy: data.connected_by,
    connectedAt: data.connected_at,
    key,
  }
}

export async function saveGcalConnection(saJson: string, connectedBy: string): Promise<{ clientEmail: string }> {
  const parsed = JSON.parse(saJson) // caller handles the SyntaxError
  if (parsed.type !== 'service_account' || !parsed.client_email || !parsed.private_key) {
    throw new Error('Not a service-account JSON key (expected type, client_email, private_key fields)')
  }
  const { error } = await supabase.from('gcal_connection').upsert({
    id: 1,
    sa_json_enc: encryptSaJson(saJson),
    client_email: parsed.client_email,
    connected_by: connectedBy,
    connected_at: new Date().toISOString(),
    status: 'connected',
    updated_at: new Date().toISOString(),
  })
  if (error) throw new Error(error.message)
  return { clientEmail: parsed.client_email }
}

export async function disconnectGcal(): Promise<void> {
  await supabase
    .from('gcal_connection')
    .update({ status: 'disconnected', updated_at: new Date().toISOString() })
    .eq('id', 1)
}

// ---------------------------------------------------------------------------
// Domain-wide-delegation access tokens (JWT bearer grant, RS256 via node
// crypto — no SDK). Cached per impersonated user until shortly before expiry.
// ---------------------------------------------------------------------------

const tokenCache = new Map<string, { token: string; expiresAt: number }>()

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url')
}

async function accessTokenFor(userEmail: string, key: ServiceAccountKey): Promise<string> {
  const cached = tokenCache.get(userEmail)
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token

  const now = Math.floor(Date.now() / 1000)
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claims = b64url(
    JSON.stringify({
      iss: key.client_email,
      sub: userEmail,
      scope: SCOPES,
      aud: TOKEN_ENDPOINT,
      iat: now,
      exp: now + 3600,
    })
  )
  const signer = createSign('RSA-SHA256')
  signer.update(`${header}.${claims}`)
  const signature = signer.sign(key.private_key).toString('base64url')
  const assertion = `${header}.${claims}.${signature}`

  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  })
  if (!res.ok) {
    const body = await res.text()
    // unauthorized_client here = DWD not authorized for this client id/scopes,
    // or the impersonated address is outside the Workspace domain.
    throw new GcalApiError(`Google token grant failed for ${userEmail}: ${body.slice(0, 300)}`, res.status)
  }
  const json = (await res.json()) as { access_token: string; expires_in: number }
  tokenCache.set(userEmail, { token: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 })
  return json.access_token
}

async function gcalFetch(
  userEmail: string,
  key: ServiceAccountKey,
  path: string,
  init?: RequestInit
): Promise<Response> {
  const token = await accessTokenFor(userEmail, key)
  return fetch(`${CAL_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })
}

async function expectOk(res: Response, what: string) {
  if (res.ok) return
  const body = await res.text()
  throw new GcalApiError(`${what} failed (${res.status}): ${body.slice(0, 300)}`, res.status)
}

// ---------------------------------------------------------------------------
// Events (always on the tutor's own calendar, impersonated as them)
// ---------------------------------------------------------------------------

export type GcalEventInput = {
  tutorEmail: string
  calendarId?: string | null // null/undefined = primary
  summary: string
  description: string
  location: string | null
  startsAt: string // ISO
  endsAt: string
  timezone: string
  attendees: string[] // empty = no invites
}

function eventBody(input: GcalEventInput) {
  return {
    summary: input.summary,
    description: input.description,
    location: input.location ?? undefined,
    start: { dateTime: input.startsAt, timeZone: input.timezone },
    end: { dateTime: input.endsAt, timeZone: input.timezone },
    attendees: input.attendees.length ? input.attendees.map((email) => ({ email })) : undefined,
  }
}

/** sendUpdates=all so invited families get native Google invites (§10.5). */
function sendUpdates(input: GcalEventInput) {
  return input.attendees.length ? 'all' : 'none'
}

export async function createGcalEvent(key: ServiceAccountKey, input: GcalEventInput): Promise<string> {
  const cal = encodeURIComponent(input.calendarId || 'primary')
  const res = await gcalFetch(
    input.tutorEmail,
    key,
    `/calendars/${cal}/events?sendUpdates=${sendUpdates(input)}`,
    { method: 'POST', body: JSON.stringify(eventBody(input)) }
  )
  await expectOk(res, 'event create')
  const json = (await res.json()) as { id: string }
  return json.id
}

export async function patchGcalEvent(key: ServiceAccountKey, eventId: string, input: GcalEventInput): Promise<void> {
  const cal = encodeURIComponent(input.calendarId || 'primary')
  const res = await gcalFetch(
    input.tutorEmail,
    key,
    `/calendars/${cal}/events/${encodeURIComponent(eventId)}?sendUpdates=${sendUpdates(input)}`,
    { method: 'PATCH', body: JSON.stringify(eventBody(input)) }
  )
  // 404/410 = someone hand-deleted the event in Google; treat as "gone" so
  // the worker can recreate rather than fail forever.
  if (res.status === 404 || res.status === 410) throw new GcalApiError('event gone', res.status)
  await expectOk(res, 'event patch')
}

export async function deleteGcalEvent(
  key: ServiceAccountKey,
  tutorEmail: string,
  calendarId: string | null,
  eventId: string
): Promise<void> {
  const cal = encodeURIComponent(calendarId || 'primary')
  const res = await gcalFetch(
    tutorEmail,
    key,
    `/calendars/${cal}/events/${encodeURIComponent(eventId)}?sendUpdates=all`,
    { method: 'DELETE' }
  )
  if (res.status === 404 || res.status === 410) return // already gone — fine
  await expectOk(res, 'event delete')
}

export async function getGcalEvent(
  key: ServiceAccountKey,
  tutorEmail: string,
  calendarId: string | null,
  eventId: string
): Promise<{ id: string; summary: string | null; status: string } | null> {
  const cal = encodeURIComponent(calendarId || 'primary')
  const res = await gcalFetch(tutorEmail, key, `/calendars/${cal}/events/${encodeURIComponent(eventId)}`)
  if (res.status === 404 || res.status === 410) return null
  await expectOk(res, 'event get')
  const json = (await res.json()) as { id: string; summary?: string; status: string }
  return { id: json.id, summary: json.summary ?? null, status: json.status }
}

// ---------------------------------------------------------------------------
// Free/busy (spec §4: busy blocks shade the Ops Director's slot picker; conflicts warn,
// never block)
// ---------------------------------------------------------------------------

export type BusyBlock = { start: string; end: string }

/** A busy block that knows what it is. `title` is null when the event is
 *  marked private/confidential — render those as "busy (private event)". */
export type TitledBusyBlock = BusyBlock & { title: string | null; private: boolean; allDay: boolean }

/**
 * Busy blocks WITH titles via events.list (same delegation; calendar.events
 * already covers reads). Mirrors freebusy semantics: skips cancelled events
 * and ones marked "free" (transparent). Google's private-event flag is
 * respected even though impersonation could read the details: the title is
 * withheld and `private` set.
 *
 * All-day events (PL-28b): busy only when Google marks them Busy or
 * Out-of-office. Google's own UI defaults all-day events to Free
 * (transparency=transparent), so reminders and default all-day events fall
 * out here while a multi-day "out of town" block marked Busy/OOO still
 * conflicts. Working-location and birthday pseudo-events are never busy.
 * Date-only boundaries become real instants on the tutor's wall clock
 * (`timezone`) — Google's end date is already exclusive (day after).
 */
export async function listBusyEvents(
  key: ServiceAccountKey,
  tutorEmail: string,
  calendarId: string | null,
  timeMinIso: string,
  timeMaxIso: string,
  timezone: string = 'America/Denver'
): Promise<TitledBusyBlock[]> {
  const cal = encodeURIComponent(calendarId || 'primary')
  const params = new URLSearchParams({
    timeMin: timeMinIso,
    timeMax: timeMaxIso,
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '250',
    fields: 'items(status,transparency,visibility,eventType,summary,start,end)',
  })
  const res = await gcalFetch(tutorEmail, key, `/calendars/${cal}/events?${params}`)
  await expectOk(res, 'events list')
  const json = (await res.json()) as {
    items?: {
      status?: string
      transparency?: string
      visibility?: string
      eventType?: string
      summary?: string
      start?: { dateTime?: string; date?: string }
      end?: { dateTime?: string; date?: string }
    }[]
  }
  const blocks: TitledBusyBlock[] = []
  for (const item of json.items ?? []) {
    if (item.status === 'cancelled') continue
    if (item.eventType === 'workingLocation' || item.eventType === 'birthday') continue
    // Marked "free" — except OOO, which is busy by definition.
    if (item.transparency === 'transparent' && item.eventType !== 'outOfOffice') continue
    const allDay = !item.start?.dateTime && !!item.start?.date
    const start =
      item.start?.dateTime ??
      (item.start?.date ? zonedToUtc(item.start.date, '00:00', timezone).toISOString() : null)
    const end =
      item.end?.dateTime ??
      (item.end?.date ? zonedToUtc(item.end.date, '00:00', timezone).toISOString() : null)
    if (!start || !end) continue
    const isPrivate = item.visibility === 'private' || item.visibility === 'confidential'
    blocks.push({ start, end, title: isPrivate ? null : (item.summary ?? null), private: isPrivate, allDay })
  }
  return blocks
}

export async function freeBusy(
  key: ServiceAccountKey,
  tutorEmail: string,
  calendarId: string | null,
  timeMinIso: string,
  timeMaxIso: string
): Promise<BusyBlock[]> {
  const id = calendarId || tutorEmail // primary calendar id = the address
  const res = await gcalFetch(tutorEmail, key, '/freeBusy', {
    method: 'POST',
    body: JSON.stringify({ timeMin: timeMinIso, timeMax: timeMaxIso, items: [{ id }] }),
  })
  await expectOk(res, 'freebusy query')
  const json = (await res.json()) as {
    calendars: Record<string, { busy?: BusyBlock[]; errors?: { reason: string }[] }>
  }
  const cal = json.calendars?.[id]
  if (cal?.errors?.length) {
    throw new GcalApiError(`freebusy error for ${id}: ${cal.errors[0].reason}`, 400)
  }
  return cal?.busy ?? []
}
