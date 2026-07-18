'use client'

import { useState } from 'react'

// PL-53d: handoff notes for students continuing to 1-on-1 tutoring —
// attached to the final-session attendance screen (and shown after the
// class ends until written). The note lands on the student's tutoring
// record: the Ops Director sees it while matching, the assigned tutor sees
// it before the first session — the 1-on-1 continues from where class
// ended instead of re-covering material.

export type HandoffStudent = {
  id: string
  firstName: string
  note: string | null
}

export default function HandoffNotes({ students }: { students: HandoffStudent[] }) {
  const [state, setState] = useState(() =>
    students.map((s) => ({ ...s, draft: s.note ?? '', saving: false, message: '' }))
  )
  if (students.length === 0) return null

  const patch = (id: string, p: Partial<(typeof state)[number]>) =>
    setState((prev) => prev.map((s) => (s.id === id ? { ...s, ...p } : s)))

  async function save(s: (typeof state)[number]) {
    patch(s.id, { saving: true, message: '' })
    try {
      const res = await fetch('/api/instructor/handoff-note', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId: s.id, note: s.draft }),
      })
      const json = await res.json()
      patch(s.id, {
        saving: false,
        note: res.ok ? s.draft : s.note,
        message: res.ok ? 'Saved — the tutoring team sees this during matching.' : 'Error: ' + json.error,
      })
    } catch {
      patch(s.id, { saving: false, message: 'Error: could not save — try again.' })
    }
  }

  return (
    <div className="mt-4 border border-amber-200 bg-amber-50/60 rounded-lg p-4 text-sm">
      <h4 className="font-bold text-hgl-slate mb-1">1-on-1 handoff notes</h4>
      <p className="text-xs text-gray-600 mb-3">
        These students continue with 1-on-1 tutoring after the class — a couple of sentences on
        what you covered, where they&apos;re strong, and what to work on next means their tutor
        picks up right where you left off.
      </p>
      <div className="space-y-4">
        {state.map((s) => (
          <div key={s.id}>
            <label className="block text-xs font-semibold text-gray-700 mb-1">
              {s.firstName} continues with 1-on-1 tutoring
              {s.note ? (
                <span className="ml-2 font-normal text-green-700">✓ note on file — edit any time</span>
              ) : (
                <span className="ml-2 font-normal text-amber-700">no handoff note yet</span>
              )}
            </label>
            <textarea
              value={s.draft}
              onChange={(e) => patch(s.id, { draft: e.target.value, message: '' })}
              rows={3}
              placeholder="What you covered, where they're strong, what to work on next…"
              className="w-full border border-gray-300 rounded-md p-2 bg-white"
            />
            <div className="flex items-center gap-3 mt-1">
              <button
                onClick={() => save(s)}
                disabled={s.saving || s.draft === (s.note ?? '')}
                className="bg-hgl-slate text-white text-xs font-bold py-1.5 px-3 rounded hover:opacity-90 disabled:opacity-40"
              >
                Save note
              </button>
              {s.message && (
                <span className={`text-xs ${s.message.startsWith('Error') ? 'text-red-600' : 'text-green-700'}`}>
                  {s.message}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
