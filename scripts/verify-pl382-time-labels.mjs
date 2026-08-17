#!/usr/bin/env node
// PL-382 verification via the COMPOSER PATH: every email time label resolves
// through publicTimeCityLabel (contextTimeCityLabel over the enrollment
// context). Three shapes per the punch list:
//   1. Room-204 HGL open in-person class → "Salt Lake City time" (the noted
//      decision: a no-school in-person class is at HGL's home), never Denver.
//   2. ISD (school class) → "Düsseldorf time", never Berlin.
//   3. Online open class → its display_cities list.
// Plus REAL bundles from the DB: every live bundle's schedule zone line and
// claim-deadline label must never fall back to a bare IANA zone city when
// class facts name a better one.
import { readFileSync, rmSync } from 'node:fs'
import { execSync } from 'node:child_process'
import path from 'node:path'
import { createRequire } from 'node:module'

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => {
      const k = l.slice(0, l.indexOf('=')).trim(); let v = l.slice(l.indexOf('=') + 1).trim()
      if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1)
      return [k, v]
    })
)
for (const [k, v] of Object.entries(env)) process.env[k] ??= v

const out = path.join(process.cwd(), 'scripts', '.tmp-build-verify-pl382')
rmSync(out, { recursive: true, force: true })
execSync(
  `npx tsc app/utils/comms-db-render.ts app/utils/lifecycle.ts --outDir ${JSON.stringify(out)} --module commonjs --target es2022 --skipLibCheck --esModuleInterop --moduleResolution node --jsx react-jsx`,
  { stdio: 'inherit' }
)
const require = createRequire(import.meta.url)
const { sessionScheduleMarkdown, SAMPLE_CONTEXT } = require(path.join(out, 'comms-variables.js'))
const { zonedDeadline, contextTimeCityLabel } = require(path.join(out, 'dates.js'))
const { loadClassBundles, emailContext } = require(path.join(out, 'lifecycle.js'))

let pass = 0, fail = 0
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`PASS  ${name}`) }
  else { fail++; console.error(`FAIL  ${name}${detail ? ' — ' + detail : ''}`) }
}

// 1. Room-204 HGL open in-person class.
const hgl = {
  ...SAMPLE_CONTEXT,
  isOpenEnrollment: true,
  deliveryMode: 'in_person',
  schoolCity: null,
  displayCities: null,
  defaultLocation: 'Room 204',
  timezone: 'America/Denver',
}
check('HGL Room-204 label = Salt Lake City', contextTimeCityLabel(hgl) === 'Salt Lake City', contextTimeCityLabel(hgl))
const hglSched = sessionScheduleMarkdown(hgl)
check('HGL schedule zone line says Salt Lake City', /times shown in Salt Lake City time/.test(hglSched) && !/Denver/.test(hglSched))
const hglDeadline = zonedDeadline('2026-09-01T21:00:00Z', hgl.timezone, hgl.defaultLocation, contextTimeCityLabel(hgl))
check('HGL deadline says Salt Lake City time', /\(Salt Lake City time\)$/.test(hglDeadline), hglDeadline)

// 2. ISD — school city Düsseldorf, zone Europe/Berlin.
const isd = {
  ...SAMPLE_CONTEXT,
  isOpenEnrollment: false,
  deliveryMode: 'in_person',
  schoolCity: 'Düsseldorf',
  displayCities: null,
  defaultLocation: 'Room 12, ISD',
  timezone: 'Europe/Berlin',
}
check('ISD label = Düsseldorf (never Berlin)', contextTimeCityLabel(isd) === 'Düsseldorf', contextTimeCityLabel(isd))
check('ISD schedule zone line', /times shown in Düsseldorf time/.test(sessionScheduleMarkdown(isd)) && !/Berlin/.test(sessionScheduleMarkdown(isd)))

// 3. Online open class with display cities.
const online = {
  ...SAMPLE_CONTEXT,
  isOpenEnrollment: true,
  deliveryMode: 'online',
  schoolCity: null,
  displayCities: 'Salt Lake City, Düsseldorf',
  defaultLocation: 'https://zoom.us/j/123',
  timezone: 'America/Denver',
}
check('online label = display cities', contextTimeCityLabel(online) === 'Salt Lake City and Düsseldorf', contextTimeCityLabel(online))

// 4. REAL bundles: the label never regresses to a zone city the class facts outrank.
const bundles = await loadClassBundles()
check('bundles loaded', bundles.length > 0, String(bundles.length))
let regressions = []
for (const b of bundles) {
  const e = b.enrollments[0]
  if (!e) continue
  const ctx = emailContext(b, e)
  const label = contextTimeCityLabel(ctx)
  const zoneCity = (ctx.timezone.split('/').pop() ?? '').replace(/_/g, ' ')
  const hasBetterFact = Boolean((ctx.schoolCity ?? '').trim()) || Boolean((ctx.displayCities ?? '').trim()) || (ctx.isOpenEnrollment && ctx.deliveryMode !== 'online')
  if (hasBetterFact && label === zoneCity && (ctx.schoolCity ?? '').trim() !== zoneCity) {
    regressions.push(`${b.schoolLabel} ${b.classType}: ${label}`)
  }
  console.log(`  ${b.schoolLabel} ${b.classType} [${b.deliveryMode}${b.isOpenEnrollment ? ', open' : ''}] → "${label} time"`)
}
check('no real bundle falls back to a bare zone city over class facts', regressions.length === 0, regressions.join('; '))

console.log(`\n${pass} passed, ${fail} failed`)
rmSync(out, { recursive: true, force: true })
process.exit(fail ? 1 : 0)
