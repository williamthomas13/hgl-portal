#!/usr/bin/env node
// PL-69 regression: student pronouns resolve correctly in every state, with
// verb agreement — and an UNSET student renders byte-identical to the
// pre-pronoun copy (nothing ever blocks or changes for existing students).
//
//   node scripts/regress-pronouns.mjs   (npm run regress:pronouns)
import { execSync } from 'node:child_process'
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.includes('=')).map((l) => {
      const k = l.slice(0, l.indexOf('=')).trim(); let v = l.slice(l.indexOf('=') + 1).trim()
      if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1)
      return [k, v]
    })
)
Object.assign(process.env, env)

let failures = 0
const check = (n, ok, d = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ` — ${d}` : ''}`); if (!ok) failures++ }

const buildDir = mkdtempSync(path.join(path.dirname(new URL(import.meta.url).pathname), '.tmp-pronouns-'))
try {
  execSync(
    `npx tsc app/utils/comms-db-render.ts --outDir ${JSON.stringify(buildDir)} --module commonjs --target es2022 --skipLibCheck --esModuleInterop --jsx react-jsx --moduleResolution node`,
    { stdio: 'inherit' }
  )
  const req = createRequire(import.meta.url)
  const { supabaseAdmin: db } = req(path.join(buildDir, 'supabase-admin.js'))
  const { renderVersion } = req(path.join(buildDir, 'comms-db-render.js'))
  const { SAMPLE_CONTEXT, SAMPLE_EXTRA, VARIABLES } = req(path.join(buildDir, 'comms-variables.js'))
  const { studentPronounSet } = req(path.join(buildDir, 'email.js'))

  // --- 1. resolver matrix: all four states, verb agreement included --------
  const ctxFor = (p) => ({ ...SAMPLE_CONTEXT, studentPronouns: p, lastSession: '2099-01-01' })
  const r = (name, p, audience = 'parent') => VARIABLES[name].resolve(ctxFor(p), audience, SAMPLE_EXTRA)

  const MATRIX = [
    // [variable, she_her, he_him, they_them, unset]
    ['she_he_they', 'she', 'he', 'they', 'they'],
    ['her_him_them', 'her', 'him', 'them', 'them'],
    ['her_his_their', 'her', 'his', 'their', 'their'],
    ['you_or_they', 'she', 'he', 'they', 'they'],
    ['your_or_their', 'her', 'his', 'their', 'their'],
    ['you_have_or_they_have', 'she has', 'he has', 'they have', 'they have'],
    ['you_need_or_they_need', 'she needs', 'he needs', 'they need', 'they need'],
    ['you_dont_or_they_dont', "she doesn't", "he doesn't", "they don't", "they don't"],
  ]
  for (const [name, she, he, they, unset] of MATRIX) {
    check(`{${name}} she/her`, r(name, 'she_her') === she, r(name, 'she_her'))
    check(`{${name}} he/him`, r(name, 'he_him') === he, r(name, 'he_him'))
    check(`{${name}} they/them`, r(name, 'they_them') === they, r(name, 'they_them'))
    check(`{${name}} unset → neutral`, r(name, null) === unset, r(name, null))
  }
  // student audience always "you"-family, untouched by pronouns
  check('{you_or_they} student audience', r('you_or_they', 'she_her', 'student') === 'you')
  check('{your_or_their} student audience', r('your_or_their', 'she_her', 'student') === 'your')

  // takingAdvantagePhrase wired to the same source (PL-67 coordination)
  check(
    '{takingAdvantagePhrase} she/her',
    r('takingAdvantagePhrase', 'she_her') === 'Ana has been taking advantage of her class time with Jordan',
    r('takingAdvantagePhrase', 'she_her')
  )
  check(
    '{takingAdvantagePhrase} unset = today',
    r('takingAdvantagePhrase', null) === 'Ana has been taking advantage of their class time with Jordan',
    r('takingAdvantagePhrase', null)
  )

  // code-twin source agrees with the registry source
  for (const [p, subj, have] of [['she_her', 'she', 'has'], ['he_him', 'he', 'has'], ['they_them', 'they', 'have'], [null, 'they', 'have']]) {
    const set = studentPronounSet({ studentPronouns: p })
    check(`twin source ${p ?? 'unset'}`, set.subj === subj && set.have === have, JSON.stringify(set))
  }

  // --- 2. golden: unset renders byte-identical to the PRE-pronoun version --
  const unsetCtx = { ...SAMPLE_CONTEXT, studentPronouns: null }
  const CONVERTED = ['PR1', 'PR2', 'PR3', 'E1_THANKS', 'E7_REVIEW', 'E8_ADDON_SCHEDULING', 'E8_POSTCLASS_TUTORING']
  for (const key of CONVERTED) {
    const { data: tpl } = await db.from('email_templates')
      .select('from_identity, category, active_version_id').eq('template_key', key).single()
    const { data: cur } = await db.from('email_template_versions')
      .select('version_number, subject, preheader, body_markdown, footer_note')
      .eq('id', tpl.active_version_id).single()
    const { data: prev } = await db.from('email_template_versions')
      .select('subject, preheader, body_markdown, footer_note')
      .eq('template_key', key).eq('version_number', cur.version_number - 1).maybeSingle()
    if (!prev) { check(`${key}: previous version exists`, false); continue }
    const meta = { from_identity: tpl.from_identity, category: tpl.category }
    const a = renderVersion(prev, meta, unsetCtx, 'parent', SAMPLE_EXTRA)
    const b = renderVersion(cur, meta, unsetCtx, 'parent', SAMPLE_EXTRA)
    check(`${key}: unset renders byte-identical to previous version`, a.subject === b.subject && a.html === b.html)
  }

  // --- 3. personalized spot-checks (Ana is she/her in samples) -------------
  {
    const { data: tpl } = await db.from('email_templates')
      .select('from_identity, category, active_version_id').eq('template_key', 'E7_REVIEW').single()
    const { data: cur } = await db.from('email_template_versions')
      .select('subject, preheader, body_markdown, footer_note').eq('id', tpl.active_version_id).single()
    const she = renderVersion(cur, tpl, ctxFor('she_her'), 'parent', SAMPLE_EXTRA)
    check('#8 she/her: "her hard work"', she.html.includes('Congrats to Ana for her hard work'))
    const he = renderVersion(cur, tpl, ctxFor('he_him'), 'parent', SAMPLE_EXTRA)
    check('#8 he/him: "his hard work"', he.html.includes('Congrats to Ana for his hard work'))
  }
} finally {
  rmSync(buildDir, { recursive: true, force: true })
}
process.exit(failures === 0 ? 0 : 1)
