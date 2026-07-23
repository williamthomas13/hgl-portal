#!/usr/bin/env node
// PL-96 follow-up: server-only code must never reach a client bundle. The
// batch-14 leaf-module move pulled supabase-admin into the templates page's
// client graph and every static gate stayed green — the guard was runtime-
// only. This walks the STATIC import graph from every 'use client' module
// and fails when a server-only module is reachable, with the offending
// chain printed.
//
//   node scripts/regress-client-imports.mjs   (npm run regress:client-imports)
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), '..')
const APP = path.join(ROOT, 'app')

// Modules that must stay server-side: the service-role client, and the
// utils that carry secrets (CRON_SECRET token minting, Stripe secret key,
// QBO/GCal credentials) or import them.
const SERVER_ONLY = [
  'app/utils/supabase-admin.ts',
  'app/utils/signing.ts',
  'app/utils/lifecycle.ts',
  'app/utils/email.ts',
  'app/utils/checkout-paid.ts',
  'app/utils/tutoring-stripe.ts',
  'app/utils/qbo.ts',
  'app/utils/qbo-sync.ts',
  'app/utils/gcal.ts',
  'app/utils/gcal-sync.ts',
  'app/utils/intake.ts',
  'app/utils/convert-tutoring.ts',
]

let failures = 0
const check = (n, ok, d = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ` — ${d}` : ''}`); if (!ok) failures++ }

function walkFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) walkFiles(p, out)
    else if (/\.(ts|tsx)$/.test(name)) out.push(p)
  }
  return out
}

const files = walkFiles(APP)
const rel = (p) => path.relative(ROOT, p)

// TYPE-ONLY imports are erased at compile time and are safe; only value
// imports pull code into the bundle.
function valueImports(file) {
  const src = readFileSync(file, 'utf8')
  const out = []
  for (const m of src.matchAll(/^import\s+(type\s+)?([^'"]*?)from\s+['"]([^'"]+)['"]/gms)) {
    if (m[1]) continue // import type … — erased
    const spec = m[3]
    if (!spec.startsWith('.')) continue // packages: out of scope
    out.push(spec)
  }
  // bare side-effect imports: import './x'
  for (const m of readFileSync(file, 'utf8').matchAll(/^import\s+['"](\.[^'"]+)['"]/gm)) out.push(m[1])
  return out
}

function resolveImport(fromFile, spec) {
  const base = path.resolve(path.dirname(fromFile), spec)
  for (const cand of [base + '.ts', base + '.tsx', path.join(base, 'index.ts'), path.join(base, 'index.tsx'), base]) {
    if (existsSync(cand) && statSync(cand).isFile()) return cand
  }
  return null
}

const clientRoots = files.filter((f) => {
  const head = readFileSync(f, 'utf8').slice(0, 200)
  return /^['"]use client['"]/.test(head.trim())
})
check(`found 'use client' roots`, clientRoots.length > 0, `${clientRoots.length} files`)

const serverSet = new Set(SERVER_ONLY.map((s) => path.join(ROOT, s)))
let violations = 0
for (const root of clientRoots) {
  // BFS with path tracking so a violation prints its chain.
  const queue = [[root]]
  const seen = new Set([root])
  while (queue.length) {
    const chain = queue.shift()
    const file = chain[chain.length - 1]
    for (const spec of valueImports(file)) {
      const resolved = resolveImport(file, spec)
      if (!resolved || seen.has(resolved)) continue
      const nextChain = [...chain, resolved]
      if (serverSet.has(resolved)) {
        violations++
        console.log(`FAIL  ${rel(root)} reaches server-only ${rel(resolved)}`)
        console.log(`      chain: ${nextChain.map(rel).join(' → ')}`)
        continue
      }
      seen.add(resolved)
      queue.push(nextChain)
    }
  }
}
failures += violations
check('no client module reaches server-only code', violations === 0, `${violations} violation(s)`)
process.exit(failures === 0 ? 0 : 1)
