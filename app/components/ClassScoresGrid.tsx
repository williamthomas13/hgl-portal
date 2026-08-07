'use client'

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../utils/supabase'
import {
  EXAM_OPTIONAL_SECTIONS,
  EXAM_SECTIONS,
  computedStem,
  computedTotal,
  outOfRangeSections,
  requiredSections,
} from './ScoresEntry'

// PL-181: the GROUP read/entry for a class's two diagnostics — students as
// rows, Diag 1 / Diag 2 as column groups, exactly the "enter a column of
// scores in one sitting, see the group side by side" workflow instructors
// actually do. Same store as everything else (student_scores, the two named
// diagnostic slots) — a score entered here appears on the per-student entry,
// the tutoring page, and the counselor view the moment it saves; no syncing.

type StudentRef = { id: string; name: string }
type SlotLabel = 'First diagnostic' | 'Second diagnostic'
const SLOTS: SlotLabel[] = ['First diagnostic', 'Second diagnostic']

type StoredRow = {
  id: string
  student_id: string
  test_label: string
  section_scores: Record<string, number> | null
  total: number | null
  taken_at: string | null
}

type CellState = Record<string, string> // section -> input text

export default function ClassScoresGrid({
  classId,
  students,
  defaultExam,
}: {
  classId: string
  students: StudentRef[]
  defaultExam: string
}) {
  const exam = EXAM_SECTIONS[defaultExam] ? defaultExam : 'SAT'
  const sections = EXAM_SECTIONS[exam]
  const [stored, setStored] = useState<Record<string, StoredRow>>({}) // `${studentId}|${slot}`
  const [cells, setCells] = useState<Record<string, CellState>>({})
  const [dates, setDates] = useState<Record<SlotLabel, string>>({
    'First diagnostic': '',
    'Second diagnostic': '',
  })
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  const load = useCallback(async () => {
    if (students.length === 0) return
    // Scoped to THIS class, exactly like ScoresEntry — a student's tutoring
    // diagnostics (class_id null) are separate rows, and updating by id must
    // never grab them. Viewing surfaces (counselor/parent/profile) read the
    // student's full history across contexts; this is the entry grid.
    const { data } = await supabase
      .from('student_scores')
      .select('id, student_id, test_label, section_scores, total, taken_at')
      .in('student_id', students.map((s) => s.id))
      .in('test_label', SLOTS)
      .eq('class_id', classId)
    const map: Record<string, StoredRow> = {}
    const cellInit: Record<string, CellState> = {}
    for (const r of (data as StoredRow[]) ?? []) {
      const key = `${r.student_id}|${r.test_label}`
      map[key] = r
      cellInit[key] = Object.fromEntries(
        sections.map((s) => [s, r.section_scores?.[s] != null ? String(r.section_scores[s]) : ''])
      )
    }
    setStored(map)
    setCells(cellInit)
  }, [students, sections, classId])

  useEffect(() => {
    load()
  }, [load])

  const setCell = (key: string, section: string, value: string) =>
    setCells((c) => ({ ...c, [key]: { ...(c[key] ?? {}), [section]: value } }))

  const cellScores = (key: string): Record<string, number> => {
    const out: Record<string, number> = {}
    for (const s of sections) {
      const v = Number((cells[key]?.[s] ?? '').trim())
      if ((cells[key]?.[s] ?? '').trim() !== '' && Number.isFinite(v)) out[s] = v
    }
    return out
  }

  const dirty = useMemo(() => {
    const keys: string[] = []
    for (const stu of students) {
      for (const slot of SLOTS) {
        const key = `${stu.id}|${slot}`
        const entered = cellScores(key)
        const storedRow = stored[key]
        const storedScores = storedRow?.section_scores ?? {}
        const changed =
          Object.keys(entered).length > 0 &&
          (sections.some((s) => (entered[s] ?? null) !== (storedScores[s] ?? null)) ||
            !storedRow)
        if (changed) keys.push(key)
      }
    }
    return keys
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cells, stored, students])

  async function saveAll() {
    setSaving(true)
    setMessage('')
    let saved = 0
    const problems: string[] = []
    for (const key of dirty) {
      const [studentId, slot] = key.split('|')
      const scores = cellScores(key)
      // PL-286: only the required sections gate the save (ACT Science may
      // stay blank — it's optional now).
      if (requiredSections(exam).some((s) => scores[s] == null)) {
        const optional = EXAM_OPTIONAL_SECTIONS[exam] ?? []
        problems.push(
          `${students.find((s) => s.id === studentId)?.name ?? '?'} (${slot}): every section needs a number${optional.length > 0 ? ` (${optional.join(', ')} is optional)` : ''}`
        )
        continue
      }
      const bad = outOfRangeSections(exam, scores)
      if (bad.length > 0) {
        problems.push(`${students.find((s) => s.id === studentId)?.name ?? '?'} (${slot}): ${bad.join(', ')} out of range for the ${exam}`)
        continue
      }
      // Mirror ScoresEntry's payload exactly — one store, one shape.
      const { data: auth } = await supabase.auth.getUser()
      const payload = {
        student_id: studentId,
        class_id: classId,
        test_label: slot,
        section_scores: scores,
        total: computedTotal(exam, scores),
        taken_at: dates[slot as SlotLabel] || stored[key]?.taken_at || null,
        source: 'manual',
        recorded_by: auth.user?.email ?? null,
      }
      const existing = stored[key]
      const { error } = existing
        ? await supabase.from('student_scores').update(payload).eq('id', existing.id)
        : await supabase.from('student_scores').insert([payload])
      if (error) problems.push(`${students.find((s) => s.id === studentId)?.name ?? '?'}: ${error.message}`)
      else saved++
    }
    await load()
    setMessage(
      [saved > 0 ? `Saved ${saved} score${saved === 1 ? '' : 's'}.` : dirty.length === 0 ? 'Nothing to save.' : '', ...problems]
        .filter(Boolean)
        .join(' · ')
    )
    setSaving(false)
  }

  if (students.length === 0) return null

  return (
    <div className="mt-3 text-sm">
      <p className="text-xs font-semibold text-gray-600 mb-1">
        Diagnostics side by side ({exam}) — type down a column, one Save for the sitting
      </p>
      <div className="overflow-x-auto border border-gray-200 rounded-md">
        <table className="min-w-full text-xs">
          <thead className="bg-gray-100">
            <tr>
              <th className="px-2 py-1.5 text-left font-bold text-hgl-slate">Student</th>
              {SLOTS.map((slot) => (
                <th key={slot} colSpan={sections.length + 1} className="px-2 py-1.5 text-left font-bold text-hgl-slate border-l border-gray-200">
                  {slot === 'First diagnostic' ? 'Diag 1' : 'Diag 2'}
                  <input
                    type="date"
                    value={dates[slot]}
                    onChange={(e) => setDates((d) => ({ ...d, [slot]: e.target.value }))}
                    title="Taken on (applies to the whole column when saving)"
                    className="ml-2 border border-gray-300 rounded p-0.5 font-normal"
                  />
                </th>
              ))}
              <th className="px-2 py-1.5 text-left font-bold text-hgl-slate border-l border-gray-200" title="Diag 2 total minus Diag 1 total">
                Δ
              </th>
            </tr>
            <tr className="bg-gray-50 text-gray-500">
              <th />
              {SLOTS.map((slot) => (
                <Fragment key={slot}>
                  {sections.map((s) => (
                    <th key={`${slot}-${s}`} className="px-2 py-1 text-left font-semibold first:border-l first:border-gray-200">
                      {s}
                      {/* PL-286 */}
                      {(EXAM_OPTIONAL_SECTIONS[exam] ?? []).includes(s) && (
                        <span className="font-normal text-gray-400" title="Optional — leave blank if not taken">
                          {' '}
                          (opt)
                        </span>
                      )}
                    </th>
                  ))}
                  <th className="px-2 py-1 text-left font-semibold">Total</th>
                </Fragment>
              ))}
              <th />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {students.map((stu) => {
              const totals = SLOTS.map((slot) => computedTotal(exam, cellScores(`${stu.id}|${slot}`)))
              const delta = totals[0] != null && totals[1] != null ? totals[1] - totals[0] : null
              return (
                <tr key={stu.id}>
                  <td className="px-2 py-1 font-semibold text-hgl-slate whitespace-nowrap">{stu.name}</td>
                  {SLOTS.map((slot) => {
                    const key = `${stu.id}|${slot}`
                    const bad = new Set(outOfRangeSections(exam, cellScores(key)))
                    return (
                      <Fragment key={key}>
                        {sections.map((s) => (
                          <td key={`${key}-${s}`} className="px-1 py-1 first:border-l first:border-gray-200">
                            <input
                              type="number"
                              value={cells[key]?.[s] ?? ''}
                              onChange={(e) => setCell(key, s, e.target.value)}
                              className={`w-16 border rounded p-0.5 ${bad.has(s) ? 'border-red-500 bg-red-50' : 'border-gray-300'}`}
                            />
                          </td>
                        ))}
                        <td className="px-2 py-1 font-bold text-hgl-slate whitespace-nowrap">
                          {computedTotal(exam, cellScores(key)) ?? '—'}
                          {/* PL-286: STEM only when Science was entered. */}
                          {exam === 'ACT' && computedStem(cellScores(key)) != null && (
                            <span
                              className="font-normal text-gray-500"
                              title="ACT STEM: rounded average of Math and Science"
                            >
                              {' '}
                              · STEM {computedStem(cellScores(key))}
                            </span>
                          )}
                        </td>
                      </Fragment>
                    )
                  })}
                  <td className={`px-2 py-1 font-bold border-l border-gray-200 ${delta == null ? 'text-gray-300' : delta >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                    {delta == null ? '—' : delta > 0 ? `+${delta}` : delta}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-3 mt-1.5">
        <button
          onClick={saveAll}
          disabled={saving || dirty.length === 0}
          className="text-xs font-bold bg-hgl-slate text-white rounded px-3 py-1.5 disabled:opacity-40"
        >
          {saving ? 'Saving…' : `Save ${dirty.length || ''} change${dirty.length === 1 ? '' : 's'}`}
        </button>
        {message && (
          <span className={`text-xs ${message.includes('range') || message.includes('needs') ? 'text-red-600' : 'text-green-700'}`}>
            {message}
          </span>
        )}
      </div>
    </div>
  )
}
