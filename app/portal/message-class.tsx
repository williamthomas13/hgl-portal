'use client'

import { useEffect, useState } from 'react'

// Feature B3 compose UI (docs/COMMS_ATTENDANCE_PARENT_SPEC.md): Message
// class + the low-end convenience next to it — Copy emails for instructors
// who'd rather use their own mail client. The confirm dialog surfaces the
// recipient count (rate/abuse guard).

type MessageRecipients = {
  parents: string[]
  students: string[]
}

export default function MessageClass({
  classId,
  classLabel,
}: {
  classId: string
  classLabel: string
}) {
  // Parent emails are deliberately hidden from instructor RLS — the route
  // hands back only this class's roster addresses.
  const [recipients, setRecipients] = useState<MessageRecipients>({ parents: [], students: [] })
  useEffect(() => {
    fetch(`/api/portal/message-class?classId=${classId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
         
        if (d) setRecipients(d)
      })
      .catch(() => {})
  }, [classId])
  const [open, setOpen] = useState(false)
  const [audience, setAudience] = useState<'both' | 'parents' | 'students'>('both')
  const [subject, setSubject] = useState(`${classLabel}: `)
  const [message, setMessage] = useState('')
  const [ccMe, setCcMe] = useState(true)
  const [sending, setSending] = useState(false)
  const [status, setStatus] = useState('')
  const [copied, setCopied] = useState('')

  const emailsFor = (aud: 'both' | 'parents' | 'students') => {
    const set = new Set<string>([
      ...(aud !== 'students' ? recipients.parents : []),
      ...(aud !== 'parents' ? recipients.students : []),
    ])
    return [...set]
  }
  const count = emailsFor(audience).length

  async function copyEmails(aud: 'both' | 'parents' | 'students') {
    await navigator.clipboard.writeText(emailsFor(aud).join(', '))
    setCopied(aud)
    setTimeout(() => setCopied(''), 2000)
  }

  async function handleSend() {
    if (!subject.trim() || !message.trim()) return
    if (
      !confirm(
        `Send this to ${count} recipient${count === 1 ? '' : 's'} (${audience})?\n\n` +
          `Each person gets an individual email from "you via Higher Ground Learning" — replies come straight to you.`
      )
    )
      return
    setSending(true)
    setStatus('')
    const res = await fetch('/api/portal/message-class', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ classId, audience, subject, message, ccMe }),
    })
    setSending(false)
    const out = await res.json().catch(() => ({}))
    if (!res.ok || !out.ok) {
      setStatus(`⚠ ${out.error ?? (out.failures ?? []).join(', ') ?? 'Send failed.'}`)
      return
    }
    setStatus(`✓ Sent to ${out.sent} recipient${out.sent === 1 ? '' : 's'}.`)
    setMessage('')
    setOpen(false)
  }

  return (
    <div className="mt-3">
      <div className="flex items-center gap-3 flex-wrap text-sm">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="bg-hgl-blue text-white font-bold px-4 py-2 rounded hover:bg-hgl-blue-hover"
        >
          {open ? 'Close message' : 'Message class'}
        </button>
        <span className="text-xs text-gray-500">
          Copy emails:{' '}
          {(['parents', 'students', 'both'] as const).map((aud) => (
            <button
              key={aud}
              type="button"
              onClick={() => copyEmails(aud)}
              className="text-hgl-blue underline mr-2"
            >
              {copied === aud ? 'copied!' : aud}
            </button>
          ))}
        </span>
        {status && <span>{status}</span>}
      </div>

      {open && (
        <div className="mt-3 border border-gray-200 rounded-lg p-4 space-y-3 text-sm bg-gray-50">
          <div className="flex items-center gap-4 flex-wrap">
            <span className="text-xs font-semibold text-gray-600">To:</span>
            {(['both', 'parents', 'students'] as const).map((aud) => (
              <label key={aud} className="flex items-center gap-1.5">
                <input
                  type="radio"
                  name={`aud-${classId}`}
                  checked={audience === aud}
                  onChange={() => setAudience(aud)}
                />
                <span className="capitalize">{aud === 'both' ? 'Students + parents' : aud}</span>
              </label>
            ))}
            <span className="text-xs text-gray-400">({count} recipients)</span>
          </div>
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="w-full border border-gray-300 rounded p-2"
            placeholder="Subject"
          />
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={6}
            className="w-full border border-gray-300 rounded p-2"
            placeholder="Your message — plain text; blank lines make paragraphs. Recipients can reply directly to you."
          />
          <div className="flex items-center justify-between flex-wrap gap-2">
            <label className="flex items-center gap-1.5 text-xs text-gray-600">
              <input type="checkbox" checked={ccMe} onChange={(e) => setCcMe(e.target.checked)} />
              Send me a copy
            </label>
            <button
              type="button"
              onClick={handleSend}
              disabled={sending || !subject.trim() || !message.trim() || count === 0}
              className="bg-hgl-slate text-white font-bold px-5 py-2 rounded hover:opacity-90 disabled:opacity-50"
            >
              {sending ? 'Sending…' : `Send to ${count}`}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
