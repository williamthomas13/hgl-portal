// PL-283: seed per-tutor calendar colors from Kelsie's existing Google
// Calendar scheme (batch-29 doc, screenshot on file — hexes verified against
// the official Google Calendar palette; note the doc's "Tangerine ~#F09300"
// is the palette's Mango swatch, hex kept because the hex is what the
// screenshot shows). Idempotent: only fills NULL colors — never overwrites
// an admin's later swatch-picker choice. Unmatched names are logged and kept
// here so a re-run after the instructor record appears picks them up.
//
// Usage: node scripts/seed-pl283-tutor-colors.mjs

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

const env = {}
for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = /^([A-Z_]+)=(.*)$/.exec(line.trim())
  if (m) env[m[1]] = m[2]
}
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

// Kelsie's scheme (batch-29 doc). Google palette names in comments.
const SCHEME = {
  'Kelsie Rank': '#0B8043', // Basil (dark green)
  'Billy Thomas': '#795548', // Cocoa (brown)
  'Eric Brown': '#EF6C00', // Pumpkin (orange)
  'Gwen De Silva': '#8E24AA', // Grape (purple)
  'Jason Topa': '#F09300', // Mango (the doc says "Tangerine" — hex matches Mango)
  'Julia Fusia': '#E67C73', // Flamingo (salmon)
  'Kevin Marren': '#7CB342', // Pistachio (lime)
  'Linden Hughes': '#3F51B5', // Blueberry (blue)
  'Rebecca Baumher': '#009688', // Eucalyptus (teal)
}

const { data: instructors, error } = await supabase
  .from('instructors')
  .select('id, name, calendar_color')
if (error) {
  console.error('read failed:', error.message)
  process.exit(1)
}

const byName = new Map(instructors.map((i) => [i.name, i]))
let set = 0
for (const [name, hex] of Object.entries(SCHEME)) {
  const row = byName.get(name)
  if (!row) {
    console.log(`no instructor record for "${name}" — skipped (re-run after adding them)`)
    continue
  }
  if (row.calendar_color) {
    console.log(`${name} already has ${row.calendar_color} — left alone`)
    continue
  }
  const { error: upErr } = await supabase
    .from('instructors')
    .update({ calendar_color: hex })
    .eq('id', row.id)
    .is('calendar_color', null)
  if (upErr) {
    console.error(`${name}: update failed — ${upErr.message}`)
    process.exit(1)
  }
  console.log(`${name} → ${hex}`)
  set++
}
console.log(`done — ${set} color(s) set`)
