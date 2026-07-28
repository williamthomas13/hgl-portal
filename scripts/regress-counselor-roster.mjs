#!/usr/bin/env node
// PL-131 gate: the tokenized roster page is a BEARER link that bypasses RLS
// (it renders server-side as admin), so its school scoping must be enforced
// in the query — and proven. This exercises the exact query shape the page
// uses, against real fixtures in two different schools.
//
// The failure it guards: a valid token for class A being pointed at class B,
// or a counselor at school 1 reading school 2's roster. Either would leak
// one school's student list to another school's staff.
import { readFileSync, rmSync } from 'node:fs'
import { execSync } from 'node:child_process'
import path from 'node:path'
import { createRequire } from 'node:module'
import { createClient } from '@supabase/supabase-js'

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => {
      const k = l.slice(0, l.indexOf('=')).trim(); let v = l.slice(l.indexOf('=') + 1).trim()
      if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1)
      return [k, v]
    })
)
for (const [k, v] of Object.entries(env)) process.env[k] ??= v
delete process.env.RESEND_API_KEY

const out = path.join(process.cwd(), 'scripts', '.tmp-build-regress-roster')
rmSync(out, { recursive: true, force: true })
execSync(
  `npx tsc app/utils/lifecycle.ts --outDir ${JSON.stringify(out)} --module commonjs --target es2022 --skipLibCheck --esModuleInterop --jsx react-jsx --moduleResolution node`,
  { stdio: 'inherit' }
)
const require = createRequire(import.meta.url)
const lc = require(path.join(out, 'lifecycle.js'))
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

let failures = 0
const check = (n, ok, d = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ` — ${d}` : ''}`); if (!ok) failures++ }

const cleanup = { affiliations: [], contacts: [], classes: [], schools: [] }
const rnd = () => Math.random().toString(36).slice(2, 8)

// The page's scoping query, reproduced exactly: this class, only if it
// belongs to a school this counselor has an ACTIVE affiliation with.
async function pageQuery(classId, counselorEmail) {
  // PL-158: exact match on the lowercased email — ilike treated % / _ in
  // the token-carried address as wildcards.
  const { data: affiliations } = await db
    .from('school_affiliations')
    .select('school_id, contacts!inner ( email )')
    .is('ended_at', null)
    .eq('contacts.email', counselorEmail.toLowerCase())
  const schoolIds = (affiliations ?? []).map((a) => a.school_id)
  if (schoolIds.length === 0) return null
  const { data } = await db
    .from('classes')
    .select('id, class_type, school_id')
    .eq('id', classId)
    .in('school_id', schoolIds)
    .limit(1)
  return data?.[0] ?? null
}

try {
  // Two schools, one counselor each, one class each.
  const mkSchool = async (label) => {
    const { data, error } = await db.from('schools')
      .insert([{ name: `QA-PL131 ${label} School`, nickname: `QAPL131${label}`, timezone: 'America/Denver' }])
      .select('id').single()
    if (error) throw new Error('school: ' + error.message)
    cleanup.schools.push(data.id)
    return data.id
  }
  const mkCounselor = async (schoolId, label) => {
    const email = `billy+qa-pl131-${label.toLowerCase()}-${rnd()}@highergroundlearning.com`
    const { data: contact, error } = await db.from('contacts')
      .insert([{ email, first_name: `QA-PL131`, last_name: label }])
      .select('id').single()
    if (error) throw new Error('contact: ' + error.message)
    cleanup.contacts.push(contact.id)
    const { data: aff, error: ae } = await db.from('school_affiliations')
      .insert([{ school_id: schoolId, contact_id: contact.id, role: 'counselor' }])
      .select('id').single()
    if (ae) throw new Error('affiliation: ' + ae.message)
    cleanup.affiliations.push(aff.id)
    return { email, contactId: contact.id, affiliationId: aff.id }
  }
  const mkClass = async (schoolId, label) => {
    const { data, error } = await db.from('classes').insert([{
      school_id: schoolId, class_type: `QA-PL131 ${label}`, price: 500, capacity: 10,
      start_date: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
      status: 'open', delivery_mode: 'in_person',
    }]).select('id').single()
    if (error) throw new Error('class: ' + error.message)
    cleanup.classes.push(data.id)
    return data.id
  }

  const schoolA = await mkSchool('A')
  const schoolB = await mkSchool('B')
  const counselorA = await mkCounselor(schoolA, 'Alpha')
  const counselorB = await mkCounselor(schoolB, 'Bravo')
  const classA = await mkClass(schoolA, 'ClassA')
  const classB = await mkClass(schoolB, 'ClassB')

  // ---- 1. Token verification ---------------------------------------------
  const url = lc.counselorRosterUrlFor(classA, counselorA.email)
  const token = new URL(url).searchParams.get('t')
  check('1. the roster URL carries a token and the counselor email',
    Boolean(token) && url.includes('/class-roster/' + classA) && url.includes('ce='))
  check('2. the right token for the right class + counselor verifies',
    lc.checkCounselorRosterToken(classA, counselorA.email, token) === 'ok')
  check('3. the SAME token pointed at another class is invalid',
    lc.checkCounselorRosterToken(classB, counselorA.email, token) === 'invalid')
  check('4. the same token claimed by another counselor is invalid',
    lc.checkCounselorRosterToken(classA, counselorB.email, token) === 'invalid')
  check('5. a garbage token is invalid',
    lc.checkCounselorRosterToken(classA, counselorA.email, 'deadbeef') === 'invalid')
  check('6. email matching is case/space insensitive (inboxes are messy)',
    lc.checkCounselorRosterToken(classA, `  ${counselorA.email.toUpperCase()} `, token) === 'ok')

  // ---- 2. Query scoping — the RLS-equivalent proof ------------------------
  const own = await pageQuery(classA, counselorA.email)
  check('7. counselor A can load class A (their own school)', own?.id === classA)
  const cross = await pageQuery(classB, counselorA.email)
  check('8. WRONG-SCHOOL: counselor A gets NOTHING for class B', cross === null,
    cross ? `LEAKED ${cross.class_type}` : '')
  const crossBack = await pageQuery(classA, counselorB.email)
  check('9. WRONG-SCHOOL (reverse): counselor B gets nothing for class A', crossBack === null)
  const stranger = await pageQuery(classA, 'billy+qa-pl131-nobody@highergroundlearning.com')
  check('10. an unknown email gets nothing', stranger === null)

  // ---- 3. Ended affiliations lose access (live check, not baked in) -------
  await db.from('school_affiliations')
    .update({ ended_at: new Date().toISOString() }).eq('id', counselorA.affiliationId)
  const afterEnd = await pageQuery(classA, counselorA.email)
  check('11. a counselor who LEFT the school loses access, token still valid',
    afterEnd === null && lc.checkCounselorRosterToken(classA, counselorA.email, token) === 'ok')
  await db.from('school_affiliations')
    .update({ ended_at: null }).eq('id', counselorA.affiliationId)
  check('12. reinstating the affiliation restores access',
    (await pageQuery(classA, counselorA.email))?.id === classA)

  // ---- 4. PL-158: wildcard characters in the address are literals ---------
  const wildcard = counselorA.email.replace(/^billy/, 'billy%')
  check('13. an address containing % matches nothing (not many)',
    (await pageQuery(classA, wildcard)) === null)
  check('14. a capitalized address still resolves to its affiliation',
    (await pageQuery(classA, counselorA.email.toUpperCase()))?.id === classA)
} catch (e) {
  check('flow ran without crashing', false, e.stack?.slice(0, 400) ?? e.message)
} finally {
  for (const id of cleanup.classes) await db.from('classes').delete().eq('id', id)
  for (const id of cleanup.affiliations) await db.from('school_affiliations').delete().eq('id', id)
  for (const id of cleanup.contacts) await db.from('contacts').delete().eq('id', id)
  for (const id of cleanup.schools) await db.from('schools').delete().eq('id', id)
  rmSync(out, { recursive: true, force: true })
  console.log('cleanup done')
}
process.exit(failures === 0 ? 0 : 1)
