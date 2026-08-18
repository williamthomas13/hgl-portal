'use client'

import { useParams } from 'next/navigation'
import { RegistrationForm } from './registration-form'

// The URL segment is a human-readable slug (Squarespace buttons, print) —
// raw UUIDs still work for legacy links and Stripe cancel URLs. The form
// lives in registration-form.tsx (PL-384: shared with /{code}/register).

export default function RegistrationPage() {
  const params = useParams()
  return <RegistrationForm idOrSlug={params.id as string} />
}
