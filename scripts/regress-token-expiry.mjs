#!/usr/bin/env node
// PL-149 gate (pure, no DB/network): signed links carry an issued-at and a
// per-type lifetime; expired ones are distinguishable from forged ones so the
// pages can render the friendly "aged out" copy instead of a bare error; and
// tokens minted BEFORE this shipped keep verifying exactly as they used to
// (nothing already in a family's inbox breaks).
import { readFileSync, rmSync } from 'node:fs'
import { execSync } from 'node:child_process'
import path from 'node:path'
import { createRequire } from 'node:module'
import { createHmac } from 'node:crypto'

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => {
      const k = l.slice(0, l.indexOf('=')).trim(); let v = l.slice(l.indexOf('=') + 1).trim()
      if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1)
      return [k, v]
    })
)
for (const [k, v] of Object.entries(env)) process.env[k] ??= v

const out = path.join(process.cwd(), 'scripts', '.tmp-build-regress-token')
rmSync(out, { recursive: true, force: true })
execSync(
  `npx tsc app/utils/signing.ts --outDir ${JSON.stringify(out)} --module commonjs --target es2022 --skipLibCheck --esModuleInterop --moduleResolution node`,
  { stdio: 'inherit' }
)
const require = createRequire(import.meta.url)
const signing = require(path.join(out, 'signing.js'))

let failures = 0
const check = (n, ok, d = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ` — ${d}` : ''}`); if (!ok) failures++ }

const ID = '11111111-2222-3333-4444-555555555555'
const secret = process.env.TOKEN_SIGNING_SECRET || process.env.CRON_SECRET
const rawSig = (input) => createHmac('sha256', secret).update(input).digest('hex').slice(0, 32)
// Forge a token as if it had been issued N days ago (the signature is real,
// so this tests EXPIRY, not tampering).
const agedToken = (prefix, id, daysAgo) => {
  const issued = Math.floor(Date.now() / 86400000) - daysAgo
  return `${issued}~${rawSig(`${prefix}${id}:${issued}`)}`
}

try {
  // ---- 1. Fresh tokens verify ---------------------------------------------
  const fresh = signing.mintToken('refund:', ID, 'family-action')
  check('1. freshly minted token verifies', signing.checkToken('refund:', ID, fresh, 'family-action') === 'ok')
  check('2. minted token carries an issued-at segment', fresh.includes('~'), fresh)

  // ---- 2. Expiry is per type ----------------------------------------------
  check('3. family-form at 89 days: still ok',
    signing.checkToken('addon:', ID, agedToken('addon:', ID, 89), 'family-form') === 'ok')
  check('4. family-form at 91 days: EXPIRED (not invalid)',
    signing.checkToken('addon:', ID, agedToken('addon:', ID, 91), 'family-form') === 'expired')
  check('5. family-action at 119 days: still ok',
    signing.checkToken('refund:', ID, agedToken('refund:', ID, 119), 'family-action') === 'ok')
  check('6. family-action at 121 days: EXPIRED',
    signing.checkToken('refund:', ID, agedToken('refund:', ID, 121), 'family-action') === 'expired')
  check('7. staff at 15 days: EXPIRED (short by design)',
    signing.checkToken('staff:', ID, agedToken('staff:', ID, 15), 'staff') === 'expired')
  check('8. "never" lifetime at 5 years: still ok (calendar feeds must not die)',
    signing.checkToken('ics:', ID, signing.mintToken('ics:', ID, 'never'), 'never') === 'ok')

  // ---- 3. Expired is distinguishable from forged ---------------------------
  check('9. forged signature reads invalid, never expired',
    signing.checkToken('refund:', ID, `${Math.floor(Date.now() / 86400000)}~${'0'.repeat(32)}`, 'family-action') === 'invalid')
  check('10. wrong prefix (token type swap) reads invalid',
    signing.checkToken('convert:', ID, signing.mintToken('refund:', ID, 'family-action'), 'family-action') === 'invalid')
  check('11. wrong id reads invalid',
    signing.checkToken('refund:', 'some-other-id', fresh, 'family-action') === 'invalid')
  check('12. empty token reads invalid', signing.checkToken('refund:', ID, '', 'family-action') === 'invalid')
  check('13. tampered issued-at (extending the life) reads invalid',
    signing.checkToken('refund:', ID, fresh.replace(/^\d+/, String(Math.floor(Date.now() / 86400000) + 500)), 'family-action') === 'invalid')

  // ---- 4. Legacy tokens keep working ---------------------------------------
  // Everything already in a family's inbox was minted with the bare HMAC and
  // no issued-at. Those must verify forever — shipping expiry must not
  // invalidate a single link already sent.
  check('14. LEGACY token (no issued-at) still verifies',
    signing.checkToken('refund:', ID, rawSig(`refund:${ID}`), 'family-action') === 'ok')
  check('15. legacy token never expires (that is the compatibility promise)',
    signing.checkToken('addon:', ID, rawSig(`addon:${ID}`), 'family-form') === 'ok')
  check('16. legacy claim token (empty prefix) still verifies',
    signing.checkToken('', ID, rawSig(ID), 'family-action') === 'ok')
  check('17. a forged legacy-shaped token is still invalid',
    signing.checkToken('refund:', ID, '0'.repeat(32), 'family-action') === 'invalid')
} catch (e) {
  check('flow ran without crashing', false, e.stack?.slice(0, 400) ?? e.message)
} finally {
  rmSync(out, { recursive: true, force: true })
}
process.exit(failures === 0 ? 0 : 1)
