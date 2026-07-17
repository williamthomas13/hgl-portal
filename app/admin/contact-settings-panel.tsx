'use client'

import { useEffect, useState } from 'react'
import type { ContactInfo } from '../utils/tutoring-emails'

// PL-50: admin-only tutoring point-of-contact card. The GET 403s for the
// manager role, so managers never see the card at all — the first
// deliberately admin-only element inside /admin (reassigning the contact is
// an ownership decision, not an ops task). Saving updates the §8 contact
// block on every parent surface and the From line of the schedule emails.

export default function ContactSettingsPanel() {
  const [contact, setContact] = useState<ContactInfo | null>(null)
  const [visible, setVisible] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    fetch('/api/admin/contact-settings')
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (json?.contact) {
          setContact(json.contact)
          setVisible(true)
        }
      })
      .catch(() => {})
  }, [])

  if (!visible || !contact) return null

  async function save() {
    setSaving(true)
    setMessage('')
    const res = await fetch('/api/admin/contact-settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(contact),
    })
    const json = await res.json()
    setMessage(res.ok ? 'Saved — every parent surface and email sender now uses this contact.' : 'Error: ' + json.error)
    setSaving(false)
  }

  return (
    <div className="bg-white rounded-lg shadow-md border-t-4 border-hgl-slate px-8 py-6">
      <h2 className="text-2xl font-bold text-hgl-slate">Tutoring point of contact</h2>
      <p className="text-sm text-gray-500 mt-0.5 mb-4">
        Who families reach (and who the schedule emails come from) — shown on every parent surface.
        Admin-only: reassigning the contact is an ownership call.
      </p>
      <div className="grid sm:grid-cols-3 gap-3 text-sm">
        {(
          [
            ['name', 'Name'],
            ['email', 'Email'],
            ['phone', 'Phone'],
          ] as const
        ).map(([k, label]) => (
          <div key={k}>
            <label className="block text-xs text-gray-600 font-semibold mb-1">{label}</label>
            <input
              type={k === 'email' ? 'email' : 'text'}
              value={contact[k]}
              onChange={(e) => setContact({ ...contact, [k]: e.target.value })}
              className="w-full border border-gray-300 rounded-md p-2"
            />
          </div>
        ))}
      </div>
      <div className="flex items-center gap-3 mt-3">
        <button
          onClick={save}
          disabled={saving}
          className="bg-hgl-slate text-white py-1.5 px-4 rounded hover:opacity-90 disabled:opacity-50 text-sm"
        >
          Save contact
        </button>
        {message && (
          <span className={`text-xs ${message.startsWith('Error') ? 'text-red-600' : 'text-green-700'}`}>
            {message}
          </span>
        )}
      </div>
    </div>
  )
}
