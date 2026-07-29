'use client'

import { useState } from 'react'

// PL-219 v1.5: the survey form — the Google Form's four real questions and
// nothing else (its school/instructor/which-class questions and section
// branching are deleted, not ported: the token already knows).

function Stars({
  label,
  value,
  onChange,
}: {
  label: string
  value: number | null
  onChange: (n: number) => void
}) {
  return (
    <div>
      <p className="text-sm font-semibold text-gray-700 mb-1">{label}</p>
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            aria-label={`${n} of 5`}
            className={`w-9 h-9 rounded border text-sm font-bold ${
              value != null && n <= value
                ? 'bg-hgl-blue text-white border-hgl-blue'
                : 'bg-white text-gray-400 border-gray-300'
            }`}
          >
            {n}
          </button>
        ))}
      </div>
    </div>
  )
}

export default function SurveyForm({
  token,
  channel,
  instructorFirst,
}: {
  token: string
  channel: 'in_class' | 'email'
  instructorFirst: string
}) {
  const [satisfaction, setSatisfaction] = useState<number | null>(null)
  const [recommend, setRecommend] = useState<number | null>(null)
  const [instructorRating, setInstructorRating] = useState<number | null>(null)
  const [mostUseful, setMostUseful] = useState('')
  const [anonymous, setAnonymous] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [done, setDone] = useState(false)

  async function submit() {
    if (satisfaction == null || recommend == null || instructorRating == null) {
      setMessage('The three ratings are the heart of it — pick a number for each.')
      return
    }
    setBusy(true)
    setMessage('')
    try {
      const res = await fetch('/api/survey', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          satisfaction,
          recommend,
          instructor_rating: instructorRating,
          most_useful: mostUseful.trim() || null,
          anonymous,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (res.ok) setDone(true)
      else setMessage('Error: ' + (json.error ?? 'something went wrong — please try again.'))
    } catch {
      setMessage('Error: something went wrong — please try again.')
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <p className="text-sm text-green-700 font-semibold">
        Thank you — your feedback landed. It goes straight into how we run the next class.
      </p>
    )
  }

  return (
    <div className="space-y-5">
      <Stars label="How satisfied were you with the class overall?" value={satisfaction} onChange={setSatisfaction} />
      <Stars label="How likely are you to recommend it to a friend?" value={recommend} onChange={setRecommend} />
      <Stars label={`How was ${instructorFirst} as an instructor?`} value={instructorRating} onChange={setInstructorRating} />
      <div>
        <p className="text-sm font-semibold text-gray-700 mb-1">
          What was the most useful part — and what would you change?
        </p>
        <textarea
          value={mostUseful}
          onChange={(e) => setMostUseful(e.target.value)}
          rows={3}
          className="w-full border border-gray-300 rounded-md p-2 text-sm"
          placeholder="Totally optional, hugely appreciated."
        />
      </div>
      {channel === 'email' && (
        <label className="flex items-start gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={anonymous}
            onChange={(e) => setAnonymous(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            Submit anonymously — your name is discarded before the answers are saved, and nobody
            can connect them to you.
          </span>
        </label>
      )}
      {message && (
        <p className={`text-sm ${message.startsWith('Error') ? 'text-red-600' : 'text-amber-700'}`}>{message}</p>
      )}
      <button
        type="button"
        onClick={submit}
        disabled={busy}
        className="bg-hgl-slate text-white font-bold rounded-md px-6 py-2.5 hover:opacity-90 disabled:opacity-60"
      >
        Send feedback
      </button>
    </div>
  )
}
