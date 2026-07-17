'use client'

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../utils/supabase'
import { formatDateShort } from '../utils/dates'

// PL-37: manual milestone score entry on the roster — the deliberate
// replacement for the abandoned Synap CSV importer. Staff/instructors type
// the handful of headline numbers they already have (diagnostic → practice
// tests → real test) into the existing student_scores table, and the
// parent/counselor/instructor score displays light up. Writes run under the
// caller's RLS: staff everywhere, instructors on their own roster.

type StudentRef = { id: string; name: string }

type ScoreRow = {
  id: string
  student_id: string
  test_label: string
  section_scores: Record<string, number> | null
  total: number | null
  taken_at: string | null
}

const LABEL_SUGGESTIONS = ['Diagnostic', 'Practice Test 1', 'Practice Test 2', 'SAT', 'ACT', 'PSAT']

export default function ScoresEntry({
  students,
  classId,
}: {
  students: StudentRef[]
  /** null = tutoring/standalone scores (no class attached). */
  classId: string | null
}) {
  const [rows, setRows] = useState<ScoreRow[]>([])
  const [open, setOpen] = useState(false)
  const [studentId, setStudentId] = useState(students.length === 1 ? students[0].id : '')
  const [label, setLabel] = useState('')
  const [sections, setSections] = useState<{ name: string; score: string }[]>([])
  const [total, setTotal] = useState('')
  const [takenAt, setTakenAt] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const load = useCallback(async () => {
    if (students.length === 0) return
    let q = supabase
      .from('student_scores')
      .select('id, student_id, test_label, section_scores, total, taken_at')
      .in('student_id', students.map((s) => s.id))
      .order('taken_at', { ascending: true })
    q = classId === null ? q.is('class_id', null) : q.eq('class_id', classId)
    const { data } = await q
    setRows((data as ScoreRow[]) ?? [])
  }, [students, classId])

  useEffect(() => {
    load()
  }, [load])

  async function save() {
    if (!studentId || !label.trim()) return
    setBusy(true)
    setMessage('')
    const sectionScores = Object.fromEntries(
      sections
        .filter((s) => s.name.trim() && s.score.trim() !== '')
        .map((s) => [s.name.trim(), Number(s.score)])
    )
    const { data: auth } = await supabase.auth.getUser()
    const { error } = await supabase.from('student_scores').insert([
      {
        student_id: studentId,
        class_id: classId,
        test_label: label.trim(),
        section_scores: Object.keys(sectionScores).length ? sectionScores : null,
        total: total.trim() === '' ? null : Number(total),
        taken_at: takenAt || null,
        source: 'manual',
        recorded_by: auth.user?.email ?? null,
      },
    ])
    if (error) {
      setMessage('Error: ' + error.message)
    } else {
      setLabel('')
      setSections([])
      setTotal('')
      setTakenAt('')
      setMessage('Score recorded — it shows on the family portal right away.')
      load()
    }
    setBusy(false)
  }

  async function remove(id: string) {
    const { error } = await supabase.from('student_scores').delete().eq('id', id)
    if (error) setMessage('Error: ' + error.message)
    else load()
  }

  const nameOf = (id: string) => students.find((s) => s.id === id)?.name ?? '—'

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
                  <span>{r.test_label}</span>
                  {r.section_scores &&
                    Object.entries(r.section_scores).map(([k, v]) => (
                      <span key={k} className="text-gray-500">
                        {k} {v}
                      </span>
                    ))}
                  {r.total != null && <span className="font-semibold">total {r.total}</span>}
                  {r.taken_at && <span className="text-gray-400">{formatDateShort(r.taken_at)}</span>}
                  <button onClick={() => remove(r.id)} className="ml-auto text-red-600 underline">
                    remove
                  </button>
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
            <input
              type="text"
              list="score-label-suggestions"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Test (e.g. Diagnostic)"
              className="border border-gray-300 rounded p-1.5 w-40"
            />
            <datalist id="score-label-suggestions">
              {LABEL_SUGGESTIONS.map((l) => (
                <option key={l} value={l} />
              ))}
            </datalist>
            {sections.map((s, i) => (
              <span key={i} className="inline-flex items-center gap-1">
                <input
                  type="text"
                  value={s.name}
                  onChange={(e) => setSections(sections.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                  placeholder="Section (e.g. Math)"
                  className="border border-gray-300 rounded p-1.5 w-28"
                />
                <input
                  type="number"
                  value={s.score}
                  onChange={(e) => setSections(sections.map((x, j) => (j === i ? { ...x, score: e.target.value } : x)))}
                  placeholder="Score"
                  className="border border-gray-300 rounded p-1.5 w-20"
                />
                <button
                  type="button"
                  onClick={() => setSections(sections.filter((_, j) => j !== i))}
                  className="text-gray-400 underline"
                >
                  ×
                </button>
              </span>
            ))}
            <button
              type="button"
              onClick={() => setSections([...sections, { name: sections.length === 0 ? 'EBRW' : 'Math', score: '' }])}
              className="text-hgl-blue underline"
            >
              + section
            </button>
            <input
              type="number"
              value={total}
              onChange={(e) => setTotal(e.target.value)}
              placeholder="Total"
              className="border border-gray-300 rounded p-1.5 w-20"
            />
            <input
              type="date"
              value={takenAt}
              onChange={(e) => setTakenAt(e.target.value)}
              className="border border-gray-300 rounded p-1.5"
            />
            <button
              type="button"
              onClick={save}
              disabled={busy || !studentId || !label.trim()}
              className="bg-hgl-slate text-white rounded px-3 py-1.5 disabled:opacity-40"
            >
              Record score
            </button>
          </div>
          {message && (
            <p className={`text-xs ${message.startsWith('Error') ? 'text-red-600' : 'text-green-700'}`}>{message}</p>
          )}
        </div>
      )}
    </div>
  )
}
