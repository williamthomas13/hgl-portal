import { supabaseAdmin as supabase } from './supabase-admin'
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto'

// QuickBooks Online client (Phase 6, docs/PHASE6_SPEC.md §6): OAuth2 connect
// flow, proactive token refresh with atomic refresh-token rotation, and a thin
// REST wrapper over the v3 Accounting API. Server-only — imports supabase-admin
// and holds decrypted tokens in memory only.

const QBO_MINOR_VERSION = '75'

export function qboEnvironment(): 'sandbox' | 'production' {
  return process.env.QBO_ENVIRONMENT === 'production' ? 'production' : 'sandbox'
}

function apiBase() {
  return qboEnvironment() === 'production'
    ? 'https://quickbooks.api.intuit.com'
    : 'https://sandbox-quickbooks.api.intuit.com'
}

/** Deep link to a synced document in the QBO web app (admin badges). */
export function qboDocUrl(kind: 'sale' | 'refund', docId: string) {
  const host =
    qboEnvironment() === 'production' ? 'https://app.qbo.intuit.com' : 'https://app.sandbox.qbo.intuit.com'
  return `${host}/app/${kind === 'sale' ? 'salesreceipt' : 'refundreceipt'}?txnId=${docId}`
}

// ---------------------------------------------------------------------------
// Token encryption at rest (spec §3). AES-256-GCM with a key derived from
// CRON_SECRET — no extra env var to provision; rotating CRON_SECRET makes the
// stored tokens undecryptable, which surfaces as connection 'expired' and is
// fixed by reconnecting in the admin panel.
// ---------------------------------------------------------------------------

function tokenKey(): Buffer {
  return createHash('sha256')
    .update(`qbo-token-key:${process.env.CRON_SECRET ?? 'dev-secret'}`)
    .digest()
}

export function encryptToken(plain: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', tokenKey(), iv)
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return `${iv.toString('base64')}.${cipher.getAuthTag().toString('base64')}.${enc.toString('base64')}`
}

export function decryptToken(stored: string): string | null {
  try {
    const [iv, tag, enc] = stored.split('.')
    const decipher = createDecipheriv('aes-256-gcm', tokenKey(), Buffer.from(iv, 'base64'))
    decipher.setAuthTag(Buffer.from(tag, 'base64'))
    return Buffer.concat([decipher.update(Buffer.from(enc, 'base64')), decipher.final()]).toString('utf8')
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// OAuth2 (spec §6). State tokens follow the portal's signed-link pattern:
// HMAC over a distinct prefix, here with an embedded timestamp for expiry.
// ---------------------------------------------------------------------------

const OAUTH_SCOPE = 'com.intuit.quickbooks.accounting'
const STATE_MAX_AGE_MS = 10 * 60 * 1000

// ---------------------------------------------------------------------------
// OAuth endpoints come from Intuit's OpenID discovery document (per their
// production checklist), cached for a day, with the current well-known values
// as fallback so a discovery outage can never break token refresh.
// ---------------------------------------------------------------------------

const FALLBACK_ENDPOINTS = {
  authorization_endpoint: 'https://appcenter.intuit.com/connect/oauth2',
  token_endpoint: 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer',
  revocation_endpoint: 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke',
}

type OauthEndpoints = typeof FALLBACK_ENDPOINTS

let discoveryCache: { at: number; endpoints: OauthEndpoints } | null = null
const DISCOVERY_TTL_MS = 24 * 60 * 60 * 1000

async function oauthEndpoints(): Promise<OauthEndpoints> {
  if (discoveryCache && Date.now() - discoveryCache.at < DISCOVERY_TTL_MS) {
    return discoveryCache.endpoints
  }
  const url =
    qboEnvironment() === 'production'
      ? 'https://developer.api.intuit.com/.well-known/openid_configuration'
      : 'https://developer.api.intuit.com/.well-known/openid_sandbox_configuration'
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' } })
    if (!res.ok) throw new Error(`discovery ${res.status}`)
    const doc = (await res.json()) as Partial<OauthEndpoints>
    const endpoints: OauthEndpoints = {
      authorization_endpoint: doc.authorization_endpoint ?? FALLBACK_ENDPOINTS.authorization_endpoint,
      token_endpoint: doc.token_endpoint ?? FALLBACK_ENDPOINTS.token_endpoint,
      revocation_endpoint: doc.revocation_endpoint ?? FALLBACK_ENDPOINTS.revocation_endpoint,
    }
    discoveryCache = { at: Date.now(), endpoints }
    return endpoints
  } catch (e) {
    console.error('Intuit discovery document fetch failed — using fallback endpoints:', e)
    return FALLBACK_ENDPOINTS
  }
}

function redirectUri() {
  return (
    process.env.QBO_REDIRECT_URI ??
    `${process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'}/api/qbo/callback`
  )
}

function stateSignature(ts: string) {
  return createHmac('sha256', process.env.CRON_SECRET ?? 'dev-secret')
    .update(`qbo-oauth:${ts}`)
    .digest('hex')
    .slice(0, 32)
}

export function oauthState(): string {
  const ts = Date.now().toString()
  return `${ts}.${stateSignature(ts)}`
}

export function verifyOauthState(state: string): boolean {
  const [ts, sig] = state.split('.')
  if (!ts || !sig) return false
  if (Date.now() - Number(ts) > STATE_MAX_AGE_MS) return false
  const expected = Buffer.from(stateSignature(ts))
  const given = Buffer.from(sig)
  return expected.length === given.length && timingSafeEqual(expected, given)
}

export async function authorizeUrl(): Promise<string> {
  const params = new URLSearchParams({
    client_id: process.env.QBO_CLIENT_ID ?? '',
    response_type: 'code',
    scope: OAUTH_SCOPE,
    redirect_uri: redirectUri(),
    state: oauthState(),
  })
  return `${(await oauthEndpoints()).authorization_endpoint}?${params}`
}

function basicAuth() {
  return Buffer.from(`${process.env.QBO_CLIENT_ID}:${process.env.QBO_CLIENT_SECRET}`).toString('base64')
}

type TokenResponse = {
  access_token: string
  refresh_token: string
  expires_in: number // seconds, ~3600
  x_refresh_token_expires_in: number // seconds, ~100 days
}

async function tokenRequest(body: URLSearchParams): Promise<TokenResponse> {
  const res = await fetch((await oauthEndpoints()).token_endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basicAuth()}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body,
  })
  if (!res.ok) {
    throw new Error(`Intuit token endpoint ${res.status}: ${(await res.text()).slice(0, 300)}`)
  }
  return (await res.json()) as TokenResponse
}

/** Persist a token response — always stores the ROTATED refresh token (§6). */
async function saveTokens(realmId: string, tokens: TokenResponse, extra: Record<string, unknown> = {}) {
  const now = Date.now()
  const { error } = await supabase.from('qbo_connection').upsert([
    {
      id: 1,
      realm_id: realmId,
      access_token_enc: encryptToken(tokens.access_token),
      refresh_token_enc: encryptToken(tokens.refresh_token),
      access_expires_at: new Date(now + tokens.expires_in * 1000).toISOString(),
      refresh_expires_at: new Date(now + tokens.x_refresh_token_expires_in * 1000).toISOString(),
      status: 'connected',
      updated_at: new Date(now).toISOString(),
      ...extra,
    },
  ])
  if (error) throw new Error(`Failed to persist QBO tokens: ${error.message}`)
}

export async function exchangeAuthCode(code: string, realmId: string, connectedBy: string) {
  const tokens = await tokenRequest(
    new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri() })
  )
  await saveTokens(realmId, tokens, {
    connected_by: connectedBy,
    connected_at: new Date().toISOString(),
  })
}

export type QboConnection = {
  realm_id: string
  realm_name: string | null
  access_token_enc: string
  refresh_token_enc: string
  access_expires_at: string
  refresh_expires_at: string
  connected_by: string | null
  connected_at: string
  status: 'connected' | 'expired' | 'disconnected'
}

export async function loadConnection(): Promise<QboConnection | null> {
  const { data } = await supabase.from('qbo_connection').select('*').eq('id', 1).maybeSingle()
  return (data as QboConnection | null) ?? null
}

export async function setConnectionStatus(status: QboConnection['status']) {
  await supabase
    .from('qbo_connection')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', 1)
}

export async function disconnect() {
  const conn = await loadConnection()
  if (!conn) return
  const refresh = decryptToken(conn.refresh_token_enc)
  if (refresh) {
    // Best-effort revoke at Intuit; local status is authoritative either way.
    await fetch((await oauthEndpoints()).revocation_endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basicAuth()}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ token: refresh }),
    }).catch((e) => console.error('QBO token revoke failed:', e))
  }
  await setConnectionStatus('disconnected')
}

/**
 * A usable access token, refreshing proactively when within 10 minutes of
 * expiry (spec §6). Returns null when there is no live connection — callers
 * treat that as "pause, don't fail" (the worker leaves rows pending).
 */
export async function getAccessToken(): Promise<{ token: string; realmId: string } | null> {
  const conn = await loadConnection()
  if (!conn || conn.status !== 'connected') return null

  const tenMinutes = 10 * 60 * 1000
  if (new Date(conn.access_expires_at).getTime() - Date.now() > tenMinutes) {
    const token = decryptToken(conn.access_token_enc)
    if (token) return { token, realmId: conn.realm_id }
    // Undecryptable (CRON_SECRET rotated?) — fall through to a refresh try.
  }

  const refresh = decryptToken(conn.refresh_token_enc)
  if (!refresh) {
    await setConnectionStatus('expired')
    return null
  }
  try {
    const tokens = await tokenRequest(
      new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refresh })
    )
    await saveTokens(conn.realm_id, tokens)
    return { token: tokens.access_token, realmId: conn.realm_id }
  } catch (e) {
    // Revoked, or past the ~100-day refresh window: pending syncs pause until
    // an admin reconnects (spec §6). The sweep alerts daily while expired.
    console.error('QBO token refresh failed:', e)
    await setConnectionStatus('expired')
    return null
  }
}

// ---------------------------------------------------------------------------
// REST wrapper
// ---------------------------------------------------------------------------

export class QboApiError extends Error {
  status: number
  /** Intuit's per-request transaction id (intuit_tid response header) — the
   *  handle Intuit support uses to locate a request in their logs. Captured
   *  on failures so it lands in qbo_sync_log.last_error for support tickets. */
  intuitTid: string | null
  constructor(status: number, message: string, intuitTid: string | null = null) {
    super(message)
    this.status = status
    this.intuitTid = intuitTid
  }
}

async function qboRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const auth = await getAccessToken()
  if (!auth) throw new QboApiError(0, 'QBO not connected')
  const sep = path.includes('?') ? '&' : '?'
  const url = `${apiBase()}/v3/company/${auth.realmId}${path}${sep}minorversion=${QBO_MINOR_VERSION}`
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${auth.token}`,
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  })
  if (!res.ok) {
    const tid = res.headers.get('intuit_tid')
    const detail = (await res.text()).slice(0, 500)
    throw new QboApiError(
      res.status,
      `QBO API ${res.status} on ${path}${tid ? ` [intuit_tid ${tid}]` : ''}: ${detail}`,
      tid
    )
  }
  return (await res.json()) as T
}

/* eslint-disable @typescript-eslint/no-explicit-any */

export async function qboQuery(q: string): Promise<any> {
  const data = await qboRequest<any>(`/query?query=${encodeURIComponent(q)}`)
  return data.QueryResponse ?? {}
}

export async function companyName(): Promise<string | null> {
  try {
    // CompanyInfo rejects property selection ("Property CompanyName not
    // found") — select * is the supported form.
    const qr = await qboQuery('select * from CompanyInfo')
    return qr.CompanyInfo?.[0]?.CompanyName ?? null
  } catch (e) {
    console.error('QBO companyName failed:', e)
    return null
  }
}

/** Escape a value for QBO's SQL-ish query language (single-quote doubling). */
function q(value: string) {
  return value.replace(/'/g, "\\'")
}

export type QboRef = { value: string; name?: string }

/**
 * Find-or-create the QBO Customer for a family (spec §4, decisions §11.2).
 * Match by parent email; DisplayName carries the email so QBO's unique-name
 * rule survives two parents with the same name.
 */
export async function findOrCreateCustomer(family: {
  parentFirstName: string
  parentLastName: string
  parentEmail: string
}): Promise<string> {
  const email = family.parentEmail.trim().toLowerCase()
  const found = await qboQuery(`select Id from Customer where PrimaryEmailAddr = '${q(email)}'`)
  const existing = found.Customer?.[0]?.Id
  if (existing) return String(existing)

  const displayName = `${family.parentFirstName} ${family.parentLastName} (${email})`.slice(0, 500)
  const created = await qboRequest<any>('/customer', {
    method: 'POST',
    body: JSON.stringify({
      DisplayName: displayName,
      GivenName: family.parentFirstName.slice(0, 100),
      FamilyName: family.parentLastName.slice(0, 100),
      PrimaryEmailAddr: { Address: email },
    }),
  })
  return String(created.Customer.Id)
}

export type ReceiptLine = {
  amount: number
  itemRef: QboRef
  description: string
}

/** SalesReceiptLine/RefundReceiptLine shapes are identical. */
function receiptLines(lines: ReceiptLine[], discount?: number) {
  const out: any[] = lines.map((l) => ({
    DetailType: 'SalesItemLineDetail',
    Amount: l.amount,
    Description: l.description.slice(0, 4000),
    SalesItemLineDetail: { ItemRef: l.itemRef, Qty: 1, UnitPrice: l.amount },
  }))
  if (discount && discount > 0) {
    // Promo-code checkouts charge less than the line prices sum to; a discount
    // line keeps the receipt total equal to the money that actually moved.
    out.push({
      DetailType: 'DiscountLineDetail',
      Amount: discount,
      DiscountLineDetail: { PercentBased: false },
    })
  }
  return out
}

export async function createSalesReceipt(opts: {
  customerId: string
  lines: ReceiptLine[]
  discount?: number
  txnDate: string // YYYY-MM-DD, school-local date of paid_at
  depositAccount: QboRef
  privateNote: string
}): Promise<{ id: string; docNumber: string | null }> {
  const created = await qboRequest<any>('/salesreceipt', {
    method: 'POST',
    body: JSON.stringify({
      CustomerRef: { value: opts.customerId },
      TxnDate: opts.txnDate,
      Line: receiptLines(opts.lines, opts.discount),
      DepositToAccountRef: opts.depositAccount,
      PrivateNote: opts.privateNote.slice(0, 4000),
    }),
  })
  return { id: String(created.SalesReceipt.Id), docNumber: created.SalesReceipt.DocNumber ?? null }
}

export async function createRefundReceipt(opts: {
  customerId: string
  lines: ReceiptLine[]
  txnDate: string
  depositAccount: QboRef // "Refund From" — the same Stripe Clearing account
  privateNote: string
}): Promise<{ id: string; docNumber: string | null }> {
  const created = await qboRequest<any>('/refundreceipt', {
    method: 'POST',
    body: JSON.stringify({
      CustomerRef: { value: opts.customerId },
      TxnDate: opts.txnDate,
      Line: receiptLines(opts.lines),
      DepositToAccountRef: opts.depositAccount,
      PrivateNote: opts.privateNote.slice(0, 4000),
    }),
  })
  return { id: String(created.RefundReceipt.Id), docNumber: created.RefundReceipt.DocNumber ?? null }
}

/** Service/NonInventory items for the mapping dropdowns (spec §3). */
export async function listItems(): Promise<{ id: string; name: string; account: string | null }[]> {
  const qr = await qboQuery(
    "select Id, Name, IncomeAccountRef from Item where Type in ('Service', 'NonInventory') and Active = true maxresults 200"
  )
  return (qr.Item ?? []).map((i: any) => ({
    id: String(i.Id),
    name: i.Name,
    account: i.IncomeAccountRef?.name ?? null,
  }))
}

/** Bank-type accounts for the Stripe Clearing dropdown (spec §7). */
export async function listBankAccounts(): Promise<{ id: string; name: string }[]> {
  const qr = await qboQuery(
    "select Id, Name from Account where AccountType = 'Bank' and Active = true maxresults 200"
  )
  return (qr.Account ?? []).map((a: any) => ({ id: String(a.Id), name: a.Name }))
}

/* eslint-enable @typescript-eslint/no-explicit-any */

// Phase 7c adds the two tutoring revenue items (§6.4): test prep → 408-1,
// subject tutoring → 401.
export type ItemMap = Partial<
  Record<'group_class' | 'tutoring_addon' | 'deposit_account' | 'tutoring_test_prep' | 'tutoring_subject', QboRef>
>

export async function loadItemMap(): Promise<ItemMap> {
  const { data } = await supabase.from('qbo_item_map').select('key, qbo_id, qbo_name')
  const map: ItemMap = {}
  for (const row of data ?? []) {
    map[row.key as keyof ItemMap] = { value: row.qbo_id, name: row.qbo_name ?? undefined }
  }
  return map
}
