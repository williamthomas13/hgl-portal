'use client'

import { useState } from 'react'

// PL-54b: minimal "tell me when the next one opens" capture for the closed /
// full / cancelled registration states. Deliberately frictionless — one
// email, optional student name, nothing else.

export default function InterestCapture({
  classId,
  schoolNickname,
  classType,
}: {
  classId: string
  schoolNickname: string
  classType: string
}) {
  const [email, setEmail] = useState('')
  const [studentName, setStudentName] = useState('')
  const [company, setCompany] = useState('') // honeypot
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/class-interest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ classId, email, studentName, company }),
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error ?? 'Something went wrong — please try again.')
        return
      }
      setDone(true)
    } catch {
      setError('Something went wrong — please try again.')
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <div className="mt-4 p-3 rounded bg-green-50 border border-green-200 text-green-800 text-sm text-left">
        <strong>You&apos;re on the list</strong> — we&apos;ll email you when the next{' '}
        {schoolNickname} {classType} course opens.
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="mt-4 text-left">
      <p className="text-sm font-semibold text-hgl-slate mb-2">
        Want to hear when the next {schoolNickname} {classType} course opens?
      </p>
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Your email"
          className="flex-1 border border-gray-300 rounded-md p-2 text-sm"
        />
        <input
          type="text"
          value={studentName}
          onChange={(e) => setStudentName(e.target.value)}
          placeholder="Student's name (optional)"
          className="flex-1 border border-gray-300 rounded-md p-2 text-sm"
        />
        <button
          type="submit"
          disabled={busy}
          className="bg-hgl-blue text-white font-bold px-4 py-2 rounded-md hover:bg-hgl-blue-hover transition disabled:opacity-50 text-sm whitespace-nowrap"
        >
          {busy ? 'Saving…' : 'Tell me first'}
        </button>
      </div>
      {/* honeypot — hidden from humans */}
      <div className="hidden" aria-hidden="true">
        <input tabIndex={-1} autoComplete="off" value={company} onChange={(e) => setCompany(e.target.value)} />
      </div>
      {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
    </form>
  )
}
