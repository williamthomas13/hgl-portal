'use client'

import { useEffect, useState } from 'react'
import type { ContactInfo } from '../utils/tutoring-emails'

// PL-50: admin-only tutoring point-of-contact card. The GET 403s for the
// manager role, so managers never see the card at all — the first
// deliberately admin-only element inside /admin (reassigning the contact is
// an ownership decision, not an ops task). Saving updates the §8 contact
// block on every parent surface and the From line of the schedule emails.

// PL-177: every from-identity the system sends as, each with a plain-English
// where-used line and what does NOT change with the setting.
const IDENTITY_META: Record<'info' | 'personal', { label: string; usedFor: string }> = {
  info: {
    label: 'Main identity (info@)',
    usedFor:
      'Parent-facing class and billing emails, counselor updates, tutor coverage emails, and the internal [HGL Admin] alerts.',
  },
  personal: {
    label: 'Personal identity (billy@)',
    usedFor:
      'The personal-voice sends: thank-you after registration, review requests, post-class tutoring offers, pre-class upsell, and class-cancellation notices.',
  },
}

type Identities = Record<'info' | 'personal', { value: string; overridden: boolean }>

export default function ContactSettingsPanel() {
  const [contact, setContact] = useState<ContactInfo | null>(null)
  const [identities, setIdentities] = useState<Identities | null>(null)
  const [identityDrafts, setIdentityDrafts] = useState<Record<string, string>>({})
  const [visible, setVisible] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    fetch('/api/admin/contact-settings')
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (json?.contact) {
          setContact(json.contact)
          if (json.identities) {
            setIdentities(json.identities)
            setIdentityDrafts({
              info: json.identities.info.value,
              personal: json.identities.personal.value,
            })
          }
          setVisible(true)
        }
      })
      .catch(() => {})
  }, [])

  async function saveIdentity(identity: 'info' | 'personal') {
    setSaving(true)
    setMessage('')
    const res = await fetch('/api/admin/contact-settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'set_identity', identity, value: identityDrafts[identity] }),
    })
    const json = await res.json().catch(() => ({}))
    setMessage(
      res.ok
        ? 'Saved — future sends from this identity use the new address immediately.'
        : 'Error: ' + json.error
    )
    if (res.ok && identities) {
      setIdentities({
        ...identities,
        [identity]: { value: identityDrafts[identity], overridden: true },
      })
    }
    setSaving(false)
  }

  if (!visible || !contact) return null

  async function save() {
    setSaving(true)
    setMessage('')
    const res = await fetch('/api/admin/contact-settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(contact),
    })
    const json = await res.json().catch(() => ({}))
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

      {/* PL-177: the OTHER sending identities — changing one someday is a
          settings edit with understood consequences, not archaeology. */}
      {identities && (
        <div className="mt-6 pt-5 border-t border-gray-200">
          <h3 className="text-sm font-bold text-hgl-slate mb-1">Sending identities</h3>
          <p className="text-xs text-gray-500 mb-3">
            Every address the system sends email as. Editing one switches the From line of all its
            future sends immediately. What does <span className="font-semibold">not</span> change:
            an address on a brand-new domain can&apos;t send until that domain is verified in
            Resend, and replies keep going wherever the address&apos;s inbox actually lives.
          </p>
          <div className="space-y-3 text-sm">
            {(['info', 'personal'] as const).map((k) => (
              <div key={k} className="border border-gray-200 rounded-md p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-hgl-slate">{IDENTITY_META[k].label}</span>
                  {!identities[k].overridden && (
                    <span
                      className="text-[10px] uppercase font-bold bg-gray-100 text-gray-500 rounded px-1.5 py-0.5"
                      title="No override saved — the deployed environment value is in use"
                    >
                      deploy default
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-500 mt-0.5 mb-2">{IDENTITY_META[k].usedFor}</p>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={identityDrafts[k] ?? ''}
                    onChange={(e) => setIdentityDrafts({ ...identityDrafts, [k]: e.target.value })}
                    placeholder='Name <address@highergroundlearning.com>'
                    className="flex-1 border border-gray-300 rounded-md p-2 text-xs"
                  />
                  <button
                    onClick={() => saveIdentity(k)}
                    disabled={saving || identityDrafts[k] === identities[k].value}
                    className="bg-hgl-slate text-white py-1.5 px-3 rounded hover:opacity-90 disabled:opacity-50 text-xs"
                  >
                    Save
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
