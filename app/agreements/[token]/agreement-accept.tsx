'use client'

import { useState } from 'react'

// Acceptance block (spec §12): typed full name + checkbox. The POST records
// the acceptance (with IP + user agent server-side) and snapshots a PDF of
// the exact accepted text best-effort.

export default function AgreementAccept({
  token,
  defaultEmail,
}: {
  token: string
  defaultEmail: string
}) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState(defaultEmail)
  const [agreed, setAgreed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSaving(true)
    try {
      const res = await fetch('/api/agreements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, name, email }),
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error ?? 'Something went wrong — please try again.')
        return
      }
      setDone(true)
    } catch {
      setError("Something went wrong — please try again, or get in touch and we'll sort it out.")
    } finally {
      setSaving(false)
    }
  }

  if (done) {
    return (
      <div className="p-4 rounded bg-green-50 border border-green-200 text-green-800 text-sm">
        <strong>Accepted — thank you!</strong> We&apos;ve recorded your acceptance and keep a copy
        of the exact text; you can request it any time.
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <p className="text-sm font-semibold text-hgl-slate">To accept these policies:</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1">
            Your full name <span className="text-red-500">*</span>
          </label>
          <input
            className="block w-full border border-gray-300 rounded-md p-2"
            required
            placeholder="Type your full legal name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1">
            Your email <span className="text-red-500">*</span>
          </label>
          <input
            className="block w-full border border-gray-300 rounded-md p-2"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
      </div>
      <label className="flex items-start gap-2 text-sm text-gray-700 cursor-pointer">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={agreed}
          onChange={(e) => setAgreed(e.target.checked)}
        />
        <span>
          I have read and agree to Higher Ground Learning&apos;s scheduling &amp; billing policies
          shown above, on behalf of my family.
        </span>
      </label>
      {error && (
        <div className="p-3 rounded bg-red-50 border border-red-200 text-red-700 text-sm">{error}</div>
      )}
      <button
        type="submit"
        disabled={saving || !agreed || !name.trim()}
        className="bg-hgl-blue text-white font-bold py-3 px-6 rounded-md hover:bg-hgl-blue-hover transition disabled:opacity-50"
      >
        {saving ? 'Recording…' : 'Accept the policies'}
      </button>
    </form>
  )
}
