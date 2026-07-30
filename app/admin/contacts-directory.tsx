'use client'

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../utils/supabase'

// PL-192: Contacts is a TWO-WAY directory — Students ↔ Parents. Kelsie's
// referential habit comes from QBO (students are the main contacts with
// parents attached), so student-first search must work; but a parent calls
// and you know the parent's name, so parent-first must too. Both directions
// are indexes into the SAME records (students + families) — never two lists
// that can drift. Clicking a student opens the PL-193 profile; a parent
// entry shows the family with its connected students.

/* eslint-disable @typescript-eslint/no-explicit-any */
function one<T>(v: T | T[] | null | undefined): T | null {
  if (v == null) return null
  return Array.isArray(v) ? ((v[0] as T) ?? null) : v
}

type StudentRow = {
  id: string
  first_name: string
  last_name: string
  grade_level: string | null
  school: string | null
  family_id: string | null
  created_at: string
  families: any
}

const inputCls =
  'w-full border border-gray-300 rounded-md p-2 text-sm focus:outline-none focus:ring-1 focus:ring-hgl-blue'

/** Every token of the query must match somewhere in the row's searchable
 *  text — partial words are fine ("rom des" finds Roman Desmond), order
 *  doesn't matter, and a stray typo'd token just narrows to zero rather
 *  than erroring. */
function tokenFilter(q: string): string[] {
  return q.trim().toLowerCase().split(/\s+/).filter(Boolean).slice(0, 5)
}

export default function ContactsDirectory({ mode }: { mode: 'students' | 'parents' }) {
  const [query, setQuery] = useState('')
  const [students, setStudents] = useState<StudentRow[]>([])
  const [siblingsByFamily, setSiblingsByFamily] = useState<Record<string, { id: string; name: string }[]>>({})
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const tokens = tokenFilter(query)
    // A search must reach student AND parent names — PostgREST can't `or`
    // across an embedded table, so with a query we pull the (small) full set
    // and token-match locally; the no-query default stays a cheap recent-30.
    const { data } = await supabase
      .from('students')
      .select(
        `id, first_name, last_name, grade_level, school, family_id, created_at,
         families ( id, parent_first_name, parent_last_name, parent_email, parent_phone,
                    guardian2_name, guardian2_email, guardian2_phone )`
      )
      .order('created_at', { ascending: false })
      .limit(tokens.length > 0 ? 1000 : 30)
    const rows = (data as any[]) ?? []
    const normalized: StudentRow[] = rows.map((r) => ({ ...r, families: one(r.families) }))
    const searchable = (s: StudentRow) =>
      [
        s.first_name,
        s.last_name,
        s.families?.parent_first_name,
        s.families?.parent_last_name,
        s.families?.parent_email,
        s.families?.guardian2_name,
        s.families?.guardian2_email,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
    const filtered =
      tokens.length > 0 ? normalized.filter((s) => tokens.every((t) => searchable(s).includes(t))) : normalized
    setStudents(filtered)

    // Siblings: everyone sharing a family with a visible row (one query).
    const famIds = [...new Set(filtered.map((s) => s.family_id).filter(Boolean))] as string[]
    if (famIds.length > 0) {
      const { data: sibs } = await supabase
        .from('students')
        .select('id, first_name, last_name, family_id')
        .in('family_id', famIds)
      const byFam: Record<string, { id: string; name: string }[]> = {}
      for (const s of (sibs as any[]) ?? []) {
        ;(byFam[s.family_id] ??= []).push({ id: s.id, name: `${s.first_name} ${s.last_name}`.trim() })
      }
      setSiblingsByFamily(byFam)
    } else {
      setSiblingsByFamily({})
    }
    setLoading(false)
  }, [query])

  useEffect(() => {
    const t = setTimeout(load, 250) // debounce as-you-type
    return () => clearTimeout(t)
  }, [load])

  // The parents view: same rows, grouped by family.
  const families = new Map<string, { family: any; students: StudentRow[] }>()
  for (const s of students) {
    if (!s.family_id || !s.families) continue
    const entry = families.get(s.family_id) ?? { family: s.families, students: [] }
    entry.students.push(s)
    families.set(s.family_id, entry)
  }

  return (
    <div className="bg-white rounded-lg shadow-md p-5 space-y-4">
      <div>
        <h2 className="text-lg font-bold text-hgl-slate">{mode === 'students' ? 'Students' : 'Parents'}</h2>
        <p className="text-xs text-gray-500 mt-0.5">
          {mode === 'students'
            ? 'Search by student OR parent name — a student entry shows their parents and siblings.'
            : 'Search by parent OR student name — a parent entry shows their connected students.'}
        </p>
      </div>
      <input
        className={inputCls}
        placeholder={mode === 'students' ? 'Search students… (or a parent name)' : 'Search parents… (or a student name)'}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : mode === 'students' ? (
        <ul className="divide-y divide-gray-100">
          {students.map((s) => {
            const fam = s.families
            const sibs = (s.family_id ? siblingsByFamily[s.family_id] ?? [] : []).filter((x) => x.id !== s.id)
            return (
              <li key={s.id} className="py-2.5 text-sm">
                {/* PL-230: both lenses resolve into the FAMILY profile — a
                    student result lands on that student's section. */}
                <a
                  href={s.family_id ? `/admin/families/${s.family_id}?student=${s.id}` : `/admin/students/${s.id}`}
                  className="font-semibold text-hgl-blue underline"
                >
                  {s.first_name} {s.last_name}
                </a>
                {s.grade_level && <span className="text-xs text-gray-500 ml-2">Grade {s.grade_level}</span>}
                {s.school && <span className="text-xs text-gray-500 ml-2">{s.school}</span>}
                <p className="text-xs text-gray-600 mt-0.5">
                  {fam
                    ? `${`${fam.parent_first_name ?? ''} ${fam.parent_last_name ?? ''}`.trim() || '—'}${
                        fam.parent_email ? ` · ${fam.parent_email}` : ''
                      }${fam.parent_phone ? ` · ${fam.parent_phone}` : ''}`
                    : 'No family record linked yet.'}
                  {fam?.guardian2_name ? ` · ${fam.guardian2_name}` : ''}
                </p>
                {sibs.length > 0 && (
                  <p className="text-xs text-gray-500 mt-0.5">
                    Siblings:{' '}
                    {sibs.map((x, i) => (
                      <span key={x.id}>
                        {i > 0 && ', '}
                        <a
                          href={s.family_id ? `/admin/families/${s.family_id}?student=${x.id}` : `/admin/students/${x.id}`}
                          className="text-hgl-blue underline"
                        >
                          {x.name}
                        </a>
                      </span>
                    ))}
                  </p>
                )}
              </li>
            )
          })}
          {students.length === 0 && (
            <li className="py-3 text-sm text-gray-500 italic">No students match — try fewer letters.</li>
          )}
        </ul>
      ) : (
        <ul className="divide-y divide-gray-100">
          {[...families.values()].map(({ family: fam, students: kids }) => (
            <li key={fam.id} className="py-2.5 text-sm">
              {/* PL-230: a parent result lands on the Household section. */}
              <a href={`/admin/families/${fam.id}`} className="font-semibold text-hgl-blue underline">
                {`${fam.parent_first_name ?? ''} ${fam.parent_last_name ?? ''}`.trim() || '—'}
              </a>
              <p className="text-xs text-gray-600 mt-0.5">
                {[fam.parent_email, fam.parent_phone].filter(Boolean).join(' · ') || 'no contact info'}
                {fam.guardian2_name &&
                  ` · ${fam.guardian2_name}${fam.guardian2_email ? ` (${fam.guardian2_email})` : ''}`}
              </p>
              <p className="text-xs text-gray-500 mt-0.5">
                Students:{' '}
                {(siblingsByFamily[fam.id] ?? kids.map((k) => ({ id: k.id, name: `${k.first_name} ${k.last_name}` }))).map(
                  (x, i) => (
                    <span key={x.id}>
                      {i > 0 && ', '}
                      <a href={`/admin/families/${fam.id}?student=${x.id}`} className="text-hgl-blue underline">
                        {x.name}
                      </a>
                    </span>
                  )
                )}
              </p>
            </li>
          ))}
          {families.size === 0 && (
            <li className="py-3 text-sm text-gray-500 italic">No parents match — try fewer letters.</li>
          )}
        </ul>
      )}
      {!loading && query.trim() === '' && (
        <p className="text-xs text-gray-400">
          Showing the {students.length} most recently added — search reaches everyone.
        </p>
      )}
    </div>
  )
}
