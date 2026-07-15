'use client'

import { useState } from 'react'

// In-page confirmation (no native confirm(): it freezes the renderer for
// automation and clashes with the reschedule flow's in-dialog pattern).
// First click arms; the armed state shows the consequence text and an
// explicit yes/cancel pair.

export function ConfirmAction({
  label,
  message,
  confirmLabel,
  className = 'underline',
  confirmClassName = 'text-red-700 font-semibold underline',
  disabled = false,
  onConfirm,
}: {
  label: string
  message: string
  confirmLabel?: string
  className?: string
  confirmClassName?: string
  disabled?: boolean
  onConfirm: () => void
}) {
  const [armed, setArmed] = useState(false)
  if (!armed) {
    return (
      <button type="button" disabled={disabled} onClick={() => setArmed(true)} className={className}>
        {label}
      </button>
    )
  }
  return (
    <span className="inline-flex items-center gap-2 bg-amber-50 border border-amber-200 rounded px-2 py-1">
      <span className="text-amber-900">{message}</span>
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          setArmed(false)
          onConfirm()
        }}
        className={confirmClassName}
      >
        {confirmLabel ?? `Yes, ${label.toLowerCase()}`}
      </button>
      <button type="button" onClick={() => setArmed(false)} className="text-gray-500 underline">
        cancel
      </button>
    </span>
  )
}
