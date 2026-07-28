'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../utils/supabase'
import { formatDateShort } from '../utils/dates'

// PL-37: manual milestone score entry on the roster — the deliberate
// replacement for the abandoned Synap CSV importer. Writes run under the
// caller's RLS: staff everywhere, instructors on their own roster.
//
// PL-105 rework (Scarlett's review):
//   · sections are FIXED per exam type — SAT/PSAT: EBRW + Math · ACT:
//     English, Math, Reading, Science. No freeform add-a-section.
//   · the total is CALCULATED, never typed — SAT total = EBRW + Math;
//     ACT composite = rounded average of the four sections (ACT rules).
//   · two named diagnostic slots per student — First diagnostic and Second
//     diagnostic (the #2 and #6 sequence moments) — entering one that
//     already exists replaces it after a confirm, so each slot stays single.

type StudentRef = { id: string; name: string }

type ScoreRow = {
  id: string
  student_id: string
  test_label: string
  section_scores: Record<string, number> | null
  total: number | null
  taken_at: string | null
  class_id: string | null
  classes?: { class_type: string | null } | { class_type: string | null }[] | null
}

export const EXAM_SECTIONS: Record<string, string[]> = {
  SAT: ['EBRW', 'Math'],
  PSAT: ['EBRW', 'Math'],
  ACT: ['English', 'Math', 'Reading', 'Science'],
}

/** PL-153b: the real per-exam score range. A typo (a 780 entered as 7800, or
 *  an ACT section given an SAT-sized number) used to save silently and then
 *  show a nonsense total on the family portal — and the score history is
 *  what counseling conversations are built on. */
export const EXAM_SECTION_RANGE: Record<string, { min: number; max: number }> = {
  SAT: { min: 200, max: 800 },
  PSAT: { min: 160, max: 760 },
  ACT: { min: 1, max: 36 },
}

/** The section values that fall outside their exam's range, by section. */
export function outOfRangeSections(exam: string, scores: Record<string, number>): string[] {
  const range = EXAM_SECTION_RANGE[exam]
  if (!range) return []
  return Object.entries(scores)
    .filter(([, v]) => Number.isFinite(v) && (v < range.min || v > range.max))
    .map(([section]) => section)
}

/** SAT/PSAT: sum. ACT: rounded average of the four sections (composite). */
export function computedTotal(exam: string, scores: Record<string, number>): number | null {
  const sections = EXAM_SECTIONS[exam]
  if (!sections || !sections.every((s) => Number.isFinite(scores[s]))) return null
  const values = sections.map((s) => scores[s])
  if (exam === 'ACT') return Math.round(values.reduce((a, b) => a + b, 0) / values.length)
  return values.reduce((a, b) => a + b, 0)
}

const MILESTONES = ['First diagnostic', 'Second diagnostic', 'Practice test', 'Official test'] as const

/** The stored test_label for a milestone (official tests store the exam name). */
function labelFor(milestone: string, exam: string, practiceNumber: string): string {
  if (milestone === 'Official test') return exam
  if (milestone === 'Practice test') return `Practice Test${practiceNumber.trim() ? ` ${practiceNumber.trim()}` : ''}`
  return milestone
}

export default function ScoresEntry({
  students,
  classId,
  defaultExam,
}: {
  students: StudentRef[]
  /** null = tutoring/standalone scores (no class attached). */
  classId: string | null
  /** PL-105: the class's exam type preselects the fixed section set. */
  defaultExam?: 'SAT' | 'ACT' | 'PSAT'
}) {
  const [rows, setRows] = useState<ScoreRow[]>([])
  const [open, setOpen] = useState(false)
  const [studentId, setStudentId] = useState(students.length === 1 ? students[0].id : '')
  const [exam, setExam] = useState<string>(defaultExam ?? 'SAT')
  const [milestone, setMilestone] = useState<string>('First diagnostic')
  const [practiceNumber, setPracticeNumber] = useState('')
  const [sectionValues, setSectionValues] = useState<Record<string, string>>({})
  const [takenAt, setTakenAt] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const load = useCallback(async () => {
    if (students.length === 0) return
    // PL-181: scores FOLLOW THE STUDENT — the history list shows every score
    // the student has, whichever surface recorded it (a class diagnostic
    // shows on the tutoring page and vice versa). Entry stays scoped to THIS
    // surface: new rows are stamped with this classId, and slot-replacement
    // only considers rows recorded here.
    const { data } = await supabase
      .from('student_scores')
      .select('id, student_id, test_label, section_scores, total, taken_at, class_id, classes ( class_type )')
      .in('student_id', students.map((s) => s.id))
      .order('taken_at', { ascending: true })
    setRows((data as unknown as ScoreRow[]) ?? [])
  }, [students])

  useEffect(() => {
    load()
  }, [load])

  const sections = EXAM_SECTIONS[exam] ?? EXAM_SECTIONS.SAT
  const parsedSections = useMemo(() => {
    const out: Record<string, number> = {}
    for (const s of sections) {
      const v = sectionValues[s]
      if (v != null && v.trim() !== '' && Number.isFinite(Number(v))) out[s] = Number(v)
    }
    return out
  }, [sections, sectionValues])
  const liveTotal = computedTotal(exam, parsedSections)
  const allSectionsFilled = sections.every((s) => s in parsedSections)
  // PL-153b: bounds checked as you type, named in plain English.
  const outOfRange = outOfRangeSections(exam, parsedSections)
  const range = EXAM_SECTION_RANGE[exam]

  async function save() {
    if (!studentId || !allSectionsFilled || liveTotal == null) return
    if (outOfRange.length > 0) {
      setMessage(
        `${outOfRange.join(' and ')} ${outOfRange.length === 1 ? 'is' : 'are'} outside the ${exam} range (${range.min}–${range.max}) — check the number before saving.`
      )
      return
    }
    setBusy(true)
    setMessage('')
    const label = labelFor(milestone, exam, practiceNumber)
    // The two diagnostic slots stay SINGLE *per context*: re-entering one
    // recorded on THIS surface replaces it; a diagnostic from another context
    // (a different class, or 1-on-1) is its own record and stays untouched.
    const existing =
      milestone === 'First diagnostic' || milestone === 'Second diagnostic'
        ? rows.find((r) => r.student_id === studentId && r.test_label === label && inScope(r))
        : undefined
    if (existing && !confirm(`${label} already exists for this student — replace it?`)) {
      setBusy(false)
      return
    }
    const { data: auth } = await supabase.auth.getUser()
    const payload = {
      student_id: studentId,
      class_id: classId,
      test_label: label,
      section_scores: parsedSections,
      total: liveTotal, // PL-105: calculated, never typed
      taken_at: takenAt || null,
      source: 'manual',
      recorded_by: auth.user?.email ?? null,
    }
    const { error } = existing
      ? await supabase.from('student_scores').update(payload).eq('id', existing.id)
      : await supabase.from('student_scores').insert([payload])
    if (error) {
      setMessage('Error: ' + error.message)
    } else {
      setSectionValues({})
      setPracticeNumber('')
      setTakenAt('')
      setMessage('Score recorded — it shows on the family portal right away.')
      load()
    }
    setBusy(false)
  }

  // PL-153b: a diagnostic is the baseline every later score is measured
  // against — deleting one silently rewrites a student's whole progress
  // story, so it asks first.
  async function remove(id: string) {
    const row = rows.find((r) => r.id === id)
    const label = row?.test_label ?? 'this score'
    if (!confirm(`Delete ${label} for ${nameOf(row?.student_id ?? '')}? This can't be undone.`)) return
    const { error } = await supabase.from('student_scores').delete().eq('id', id)
    if (error) setMessage('Error: ' + error.message)
    else load()
  }

  const nameOf = (id: string) => students.find((s) => s.id === id)?.name ?? '—'
  const isDiagnostic = (label: string) => /^(First|Second) diagnostic$/i.test(label)
  // PL-181: which rows were recorded on THIS surface (editable here) vs.
  // elsewhere (shown so the score follows the student, edited at its source).
  const inScope = (r: ScoreRow) => (classId === null ? r.class_id == null : r.class_id === classId)
  const contextLabel = (r: ScoreRow) => {
    if (r.class_id == null) return '1-on-1'
    const cls = Array.isArray(r.classes) ? r.classes[0] : r.classes
    return cls?.class_type ? `${cls.class_type} class` : 'another class'
  }

  return (
    <div className="mt-3 border border-gray-200 rounded-lg p-3 text-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full text-left text-sm font-semibold text-hgl-blue"
      >
        {open ? '▾' : '▸'} Scores ({rows.length}) — record a milestone
      </button>
      {open && (
        <div className="mt-3 space-y-3">
          {rows.length > 0 && (
            <ul className="space-y-1">
              {rows.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs bg-gray-50 rounded px-2 py-1.5">
                  <span className="font-semibold text-hgl-slate">{nameOf(r.student_id)}</span>
                  <span className={isDiagnostic(r.test_label) ? 'font-semibold text-purple-700' : ''}>
                    {r.test_label}
                  </span>
                  {r.section_scores &&
                    Object.entries(r.section_scores).map(([k, v]) => (
                      <span key={k} className="text-gray-500">
                        {k} {v}
                      </span>
                    ))}
                  {r.total != null && <span className="font-semibold">total {r.total}</span>}
                  {r.taken_at && <span className="text-gray-400">{formatDateShort(r.taken_at)}</span>}
                  {!inScope(r) && (
                    <span
                      className="text-gray-400 italic"
                      title="Recorded on another surface — it follows the student everywhere; edit it where it was entered"
                    >
                      from {contextLabel(r)}
                    </span>
                  )}
                  {inScope(r) ? (
                    <button onClick={() => remove(r.id)} className="ml-auto text-red-600 underline">
                      remove
                    </button>
                  ) : (
                    <span className="ml-auto" />
                  )}
                </li>
              ))}
            </ul>
          )}

          <div className="flex flex-wrap items-end gap-2 text-xs">
            {students.length > 1 && (
              <select
                value={studentId}
                onChange={(e) => setStudentId(e.target.value)}
                className="border border-gray-300 rounded p-1.5 bg-white"
              >
                <option value="">Student…</option>
                {students.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            )}
            <select
              value={exam}
              onChange={(e) => {
                setExam(e.target.value)
                setSectionValues({})
              }}
              className="border border-gray-300 rounded p-1.5 bg-white"
              title="The exam decides the sections — they're fixed, not freeform"
            >
              {Object.keys(EXAM_SECTIONS).map((x) => (
                <option key={x} value={x}>{x}</option>
              ))}
            </select>
            <select
              value={milestone}
              onChange={(e) => setMilestone(e.target.value)}
              className="border border-gray-300 rounded p-1.5 bg-white"
            >
              {MILESTONES.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
            {milestone === 'Practice test' && (
              <input
                type="number"
                value={practiceNumber}
                onChange={(e) => setPracticeNumber(e.target.value)}
                placeholder="#"
                className="border border-gray-300 rounded p-1.5 w-14"
              />
            )}
            {sections.map((s) => (
              <span key={s} className="inline-flex items-center gap-1">
                <label className="text-gray-500">{s}</label>
                <input
                  type="number"
                  min={range?.min}
                  max={range?.max}
                  value={sectionValues[s] ?? ''}
                  onChange={(e) => setSectionValues({ ...sectionValues, [s]: e.target.value })}
                  className={`border rounded p-1.5 w-20 ${
                    outOfRange.includes(s) ? 'border-red-500 bg-red-50' : 'border-gray-300'
                  }`}
                />
              </span>
            ))}
            {/* PL-105: calculated, read-only — never typed. */}
            <span
              className="inline-flex items-center gap-1 text-gray-600"
              title={exam === 'ACT' ? 'ACT composite: rounded average of the four sections' : 'Total = sum of the sections'}
            >
              <label className="text-gray-500">{exam === 'ACT' ? 'composite' : 'total'}</label>
              <span className="border border-gray-200 bg-gray-100 rounded p-1.5 w-20 text-center font-semibold">
                {liveTotal ?? '—'}
              </span>
            </span>
            <input
              type="date"
              value={takenAt}
              onChange={(e) => setTakenAt(e.target.value)}
              className="border border-gray-300 rounded p-1.5"
            />
            <button
              type="button"
              onClick={save}
              disabled={busy || !studentId || !allSectionsFilled || outOfRange.length > 0}
              className="bg-hgl-slate text-white rounded px-3 py-1.5 disabled:opacity-40"
            >
              Record score
            </button>
          </div>
          {/* PL-153b: say the range before the save is attempted. */}
          {outOfRange.length > 0 && range && (
            <p className="text-xs text-red-600">
              {outOfRange.join(' and ')} {outOfRange.length === 1 ? 'is' : 'are'} outside the {exam}{' '}
              range ({range.min}–{range.max}).
            </p>
          )}
          {message && (
            <p className={`text-xs ${message.startsWith('Error') ? 'text-red-600' : 'text-green-700'}`}>{message}</p>
          )}
        </div>
      )}
    </div>
  )
}
