'use client'

import { useState } from 'react'

// Counselor view: copy a class's registration link (same behavior as the
// admin page's copy-link buttons).
export default function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard unavailable (permissions) — the link is still shown as text.
    }
  }
  return (
    <button
      onClick={copy}
      className="text-xs border border-hgl-blue text-hgl-blue rounded px-2 py-1 font-semibold hover:bg-hgl-blue hover:text-white transition"
    >
      {copied ? 'Copied!' : 'Copy link'}
    </button>
  )
}
