#!/usr/bin/env node
// PL-454 regression: the family billing-contact routing has ONE rule and it
// lives in billing-recipient.ts, driven by the registry's `billing:` flags.
//
//   1. The flagged key set + verdicts are exactly the ship-note table.
//   2. A family with NO billing contact is routed identically to the legacy
//      per-callsite expression (`to: [parent]`, `cc: supplied || undefined`)
//      for EVERY registry key — byte-identical to before PL-454.
//   3. A billing contact reroutes ONLY flagged keys: 'replaces' drops the
//      parent, 'copies-parent' cc's the parent; a billing email equal to the
//      parent's counts as unset; cc lists dedupe against both addresses.
//
//   node scripts/regress-billing-recipient.mjs
import { execSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
let failures = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
}
const buildDir = mkdtempSync(path.join(path.dirname(new URL(import.meta.url).pathname), '.tmp-billing-'))
try {
  execSync(
    `npx tsc app/utils/billing-recipient.ts --outDir ${JSON.stringify(buildDir)} --module commonjs --target es2022 --skipLibCheck --esModuleInterop --moduleResolution node`,
    { stdio: 'inherit' }
  )
  const req = createRequire(import.meta.url)
  const { familyRecipients, billingAddress, billingVerdict } = req(path.join(buildDir, 'billing-recipient.js'))
  const { TEMPLATE_SEEDS, BILLING_TEMPLATE_KEYS } = req(path.join(buildDir, 'comms-template-seed.js'))

  // 1. the table
  const expected = {
    T1_MONTHLY_PROPOSAL: 'copies-parent',
    T1B_PROPOSAL_NUDGE: 'copies-parent',
    T2_INVOICE: 'replaces',
    T2B_PAYMENT_REMINDER: 'replaces',
    T4_PAYMENT_FAILED: 'replaces',
    PR1: 'copies-parent',
    PR2: 'copies-parent',
    PR3: 'copies-parent',
    PR4: 'copies-parent',
  }
  const sorted = (o) => JSON.stringify(Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b))))
  const actual = Object.fromEntries([...BILLING_TEMPLATE_KEYS.entries()])
  check('registry billing flags = the ship-note table', sorted(actual) === sorted(expected), sorted(actual))
  for (const k of Object.keys(expected)) check(`${k} exists in the registry`, TEMPLATE_SEEDS.some((t) => t.template_key === k))

  // 2. no billing contact → legacy-identical for EVERY key
  const legacy = (fam) => ({ to: [fam.parent_email], ...(fam.billing_cc_emails?.length ? { cc: fam.billing_cc_emails } : {}) })
  const parentOnly = { parent_email: 'Parent@example.com', billing_email: null, billing_cc_emails: [] }
  const parentCc = { parent_email: 'parent@example.com', billing_email: null, billing_cc_emails: ['aunt@example.com'] }
  const parentSame = { parent_email: 'parent@example.com', billing_email: 'PARENT@example.com', billing_cc_emails: ['aunt@example.com'] }
  let same = 0
  for (const t of TEMPLATE_SEEDS) {
    for (const fam of [parentOnly, parentCc, parentSame]) {
      const got = familyRecipients(fam, t.template_key)
      const want = fam === parentSame ? legacy({ ...fam, billing_email: null }) : legacy(fam)
      if (JSON.stringify(got) === JSON.stringify(want)) same++
      else check(`${t.template_key} no-billing routing`, false, `${JSON.stringify(got)} != ${JSON.stringify(want)}`)
    }
  }
  check(`no billing contact → legacy-identical (${same} key×family cases, incl. billing==parent)`, same === TEMPLATE_SEEDS.length * 3)
  // PR call sites never supplied cc — the helper must not invent one.
  check('PR1 without a cc list → no cc key at all', !('cc' in familyRecipients({ parent_email: 'p@example.com', billing_email: null }, 'PR1')))

  // 3. billing contact set
  const billed = { parent_email: 'parent@example.com', billing_email: 'Office@example.com', billing_cc_emails: ['aunt@example.com', 'office@example.com', 'parent@example.com'] }
  check('T2_INVOICE replaces: to billing, cc = supplied minus both addresses', JSON.stringify(familyRecipients(billed, 'T2_INVOICE')) === JSON.stringify({ to: ['Office@example.com'], cc: ['aunt@example.com'] }), JSON.stringify(familyRecipients(billed, 'T2_INVOICE')))
  check('T4_PAYMENT_FAILED replaces (no cc list) → billing only', JSON.stringify(familyRecipients({ parent_email: 'p@example.com', billing_email: 'b@example.com' }, 'T4_PAYMENT_FAILED')) === JSON.stringify({ to: ['b@example.com'] }))
  check('T1_MONTHLY_PROPOSAL copies-parent: to billing, cc parent first', JSON.stringify(familyRecipients(billed, 'T1_MONTHLY_PROPOSAL')) === JSON.stringify({ to: ['Office@example.com'], cc: ['parent@example.com', 'aunt@example.com'] }), JSON.stringify(familyRecipients(billed, 'T1_MONTHLY_PROPOSAL')))
  check('PR3 copies-parent (no cc list) → to billing, cc parent', JSON.stringify(familyRecipients({ parent_email: 'p@example.com', billing_email: 'b@example.com' }, 'PR3')) === JSON.stringify({ to: ['b@example.com'], cc: ['p@example.com'] }))
  for (const k of ['E0_CONFIRM_PARENT', 'SR_PAYMENT_LINK', 'E1_THANKS', 'T3_SCHEDULE_CHANGE', 'T8_WELCOME_HANDOFF', 'CX_FAMILY']) {
    check(`${k} is NOT billing-flagged (stays with the parent even when a contact is set)`, billingVerdict(k) === null && familyRecipients(billed, k).to[0] === 'parent@example.com')
  }
  check('billingAddress: billing when set', billingAddress(billed) === 'Office@example.com')
  check('billingAddress: parent when unset / same', billingAddress(parentOnly) === 'Parent@example.com' && billingAddress(parentSame) === 'parent@example.com')
  check('a whitespace-only billing email counts as unset', familyRecipients({ parent_email: 'p@example.com', billing_email: '   ' }, 'T2_INVOICE').to[0] === 'p@example.com')
} finally {
  rmSync(buildDir, { recursive: true, force: true })
}
console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
