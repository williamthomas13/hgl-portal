'use client'

import { useState } from 'react'
import { classLocationSentence } from '../../utils/comms-variables'

export default function RequestForm({
  classId,
  token,
  counselorEmail,
}: {
  classId: string
  token: string
  counselorEmail: string
}) {
  const [answer, setAnswer] = useState('')
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/classroom-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ classId, token, counselorEmail, answer }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error ?? 'Something went wrong — please try again.')
      } else {
        setDone(true)
      }
    } catch {
      setError('Something went wrong — please try again.')
    }
    setLoading(false)
  }

  if (done) {
    return (
      <p className="text-sm bg-green-50 text-green-800 rounded p-3">
        Perfect — <strong>{answer}</strong> is now on the class calendar and in every reminder
        email. Thanks for the ten seconds!
      </p>
    )
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <label className="block text-sm text-gray-600">Classroom / location</label>
        <input
          type="text"
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          required
          placeholder='e.g. "Room C19 in the high school"'
          className="mt-1 w-full border border-gray-300 rounded p-2 focus:border-hgl-blue focus:ring-hgl-blue outline-none transition"
        />
        {/* PL-68: live preview of the exact email sentence, so the value can
            be worded to read naturally ("Room 204", "the library"). */}
        {answer.trim() && (
          <p className="text-xs text-gray-500 mt-1">
            Families will see: &ldquo;{classLocationSentence(answer)}&rdquo;
          </p>
        )}
      </div>
      <button
        type="submit"
        disabled={loading || !answer.trim()}
        className="w-full bg-hgl-blue text-white font-bold py-3 px-4 rounded-md hover:bg-hgl-blue-hover transition disabled:opacity-60"
      >
        {loading ? 'Saving...' : 'Save location'}
      </button>
      {error && (
        <div className="p-3 rounded-md text-center text-sm font-bold bg-red-100 text-red-700">
          {error}
        </div>
      )}
    </form>
  )
}
