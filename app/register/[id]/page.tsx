'use client'

import { useParams } from 'next/navigation'
import { RegistrationForm } from './registration-form'
import { publicSkin } from '../../components/public-skin'

// The URL segment is a human-readable slug (Squarespace buttons, print) —
// raw UUIDs still work for legacy links and Stripe cancel URLs. The form
// lives in registration-form.tsx (PL-384: shared with /{code}/register).

export default function RegistrationPage() {
  const params = useParams()
  // PL-408: the real register form finally wears the public skin too — it
  // was the one public page left on the system face (PL-374 gap).
  return (
    <div className={publicSkin}>
      <RegistrationForm idOrSlug={params.id as string} />
    </div>
  )
}
