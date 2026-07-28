'use client'

import { useCallback, useEffect, useState } from 'react'

// PL-203: shared materials, both sides of the glass. ShareMaterialsPanel is
// the tutor/instructor side (attach files or links + a note, per student);
// FamilyMaterialsSection is the family portal's read side ("Materials from
// {tutor first name}", newest first). All reads/writes go through
// /api/portal/materials — role checks live there, files are private-bucket
// with signed URLs, and a family only ever sees their own student's items.

/* eslint-disable @typescript-eslint/no-explicit-any */

type Material = {
  id: string
  student_id: string
  instructor_email: string
  instructor_name: string | null
  kind: 'file' | 'link'
  title: string
  url: string | null
  note: string | null
  created_at: string
}

const fmtDay = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

export function ShareMaterialsPanel({ students }: { students: { id: string; name: string }[] }) {
  const [studentId, setStudentId] = useState(students.length === 1 ? students[0].id : '')
  const [materials, setMaterials] = useState<Material[] | null>(null)
  const [title, setTitle] = useState('')
  const [note, setNote] = useState('')
  const [link, setLink] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const load = useCallback(async () => {
    if (!studentId) return setMaterials(null)
    const res = await fetch(`/api/portal/materials?studentId=${studentId}`)
    const json = await res.json().catch(() => ({}))
    setMaterials(res.ok ? json.materials : [])
  }, [studentId])

  useEffect(() => {
    load()
  }, [load])

  async function share() {
    if (!studentId || (!file && !link.trim())) return
    setBusy(true)
    setMessage('')
    const form = new FormData()
    form.set('studentId', studentId)
    form.set('title', title)
    form.set('note', note)
    if (file) form.set('file', file)
    else form.set('link', link.trim())
    const res = await fetch('/api/portal/materials', { method: 'POST', body: form })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) setMessage('Error: ' + (json.error ?? 'could not share'))
    else {
      setMessage('Shared — the family sees it in their portal right away.')
      setTitle('')
      setNote('')
      setLink('')
      setFile(null)
      load()
    }
    setBusy(false)
  }

  async function remove(id: string) {
    if (!confirm('Remove this from the family portal?')) return
    await fetch(`/api/portal/materials?id=${id}`, { method: 'DELETE' })
    load()
  }

  if (students.length === 0) return null

  return (
    <div className="bg-white rounded-lg shadow-md p-5">
      <h2 className="text-lg font-bold text-hgl-slate mb-1">Share materials</h2>
      <p className="text-xs text-gray-500 mb-3">
        Practice packets, links, &quot;do this before Thursday&quot; — the family sees them in their portal.
      </p>
      <div className="space-y-2 text-sm">
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
        {studentId && (
          <>
            {materials && materials.length > 0 && (
              <ul className="space-y-1 text-xs border border-gray-100 rounded p-2 bg-gray-50">
                {materials.map((m) => (
                  <li key={m.id} className="flex flex-wrap items-center gap-x-2">
                    {m.url ? (
                      <a href={m.url} target="_blank" rel="noopener" className="text-hgl-blue underline font-semibold">
                        {m.title}
                      </a>
                    ) : (
                      <span className="font-semibold">{m.title}</span>
                    )}
                    {m.note && <span className="text-gray-500">— {m.note}</span>}
                    <span className="text-gray-400">{fmtDay(m.created_at)}</span>
                    <button onClick={() => remove(m.id)} className="text-red-600 underline ml-auto">
                      remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <input
                type="text"
                placeholder="Title (optional — file name used otherwise)"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="border border-gray-300 rounded p-1.5 flex-1 min-w-44"
              />
              <input
                type="text"
                placeholder="Note, e.g. before Thursday's session (optional)"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="border border-gray-300 rounded p-1.5 flex-1 min-w-44"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <input
                type="file"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="text-xs"
              />
              <span className="text-gray-400">or</span>
              <input
                type="url"
                placeholder="https:// link"
                value={link}
                onChange={(e) => setLink(e.target.value)}
                disabled={!!file}
                className="border border-gray-300 rounded p-1.5 flex-1 min-w-44 disabled:bg-gray-100"
              />
              <button
                onClick={share}
                disabled={busy || (!file && !link.trim())}
                className="bg-hgl-slate text-white font-bold rounded px-3 py-1.5 disabled:opacity-40"
              >
                {busy ? 'Sharing…' : 'Share'}
              </button>
            </div>
            <p className="text-[11px] text-gray-400">PDFs, Word docs, images, .txt — up to 10MB. Bigger? Share a link.</p>
            {message && (
              <p className={`text-xs ${message.startsWith('Error') ? 'text-red-600' : 'text-green-700'}`}>{message}</p>
            )}
          </>
        )}
      </div>
    </div>
  )
}

export function FamilyMaterialsSection({ studentNames }: { studentNames: Record<string, string> }) {
  const [materials, setMaterials] = useState<Material[] | null>(null)

  useEffect(() => {
    fetch('/api/portal/materials')
      .then(async (r) => {
        const j = await r.json().catch(() => ({}))
        setMaterials(r.ok ? j.materials : [])
      })
      .catch(() => setMaterials([]))
  }, [])

  if (!materials || materials.length === 0) return null // nothing shared → no empty section

  const byStudent = new Map<string, Material[]>()
  for (const m of materials) {
    ;(byStudent.get(m.student_id) ?? byStudent.set(m.student_id, []).get(m.student_id))!.push(m)
  }

  return (
    <div className="bg-white rounded-lg shadow-md p-6">
      {[...byStudent.entries()].map(([sid, items]) => {
        const tutorFirsts = [...new Set(items.map((m) => (m.instructor_name ?? m.instructor_email).split(' ')[0]))]
        return (
          <div key={sid} className="mb-4 last:mb-0">
            <h2 className="text-lg font-bold text-hgl-slate mb-1">
              Materials from {tutorFirsts.join(' & ')}
              {byStudent.size > 1 && studentNames[sid] && (
                <span className="text-sm font-normal text-gray-500 ml-2">for {studentNames[sid]}</span>
              )}
            </h2>
            <ul className="space-y-1.5 text-sm">
              {items.map((m) => (
                <li key={m.id}>
                  {m.url ? (
                    <a href={m.url} target="_blank" rel="noopener" className="text-hgl-blue underline font-semibold">
                      {m.title}
                    </a>
                  ) : (
                    <span className="font-semibold">{m.title}</span>
                  )}
                  {m.note && <span className="text-gray-600"> — {m.note}</span>}
                  <span className="text-xs text-gray-400 ml-2">{fmtDay(m.created_at)}</span>
                </li>
              ))}
            </ul>
          </div>
        )
      })}
    </div>
  )
}
