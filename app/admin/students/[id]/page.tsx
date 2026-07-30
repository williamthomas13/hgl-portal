'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '../../../utils/supabase'

// PL-230: the per-student profile UNIFIED into the Family profile
// (/admin/families/{id} — one hub per household, per-student sections).
// This route stays alive as a resolver so every existing link, alert, and
// bookmark keeps working: it looks up the student's family and lands on
// that student's section. A student with no family record (rare — pre-
// conversion imports) gets a plain explanation instead of a dead end.

export default function StudentProfileRedirect() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const studentId = params?.id ?? ''
  const [state, setState] = useState<'loading' | 'no-family' | 'missing'>('loading')
  const [name, setName] = useState('')

  useEffect(() => {
    if (!studentId) return
    supabase
      .from('students')
      .select('id, first_name, last_name, family_id')
      .eq('id', studentId)
      .maybeSingle()
      .then(({ data }) => {
        if (!data) {
          setState('missing')
          return
        }
        setName(`${data.first_name} ${data.last_name}`.trim())
        if (data.family_id) {
          router.replace(`/admin/families/${data.family_id}?student=${studentId}`)
        } else {
          setState('no-family')
        }
      })
  }, [studentId, router])

  return (
    <div className="min-h-screen bg-gray-50 p-10">
      <div className="max-w-4xl mx-auto text-sm">
        {state === 'loading' && <p className="text-gray-500">Opening the family profile…</p>}
        {state === 'missing' && (
          <>
            <p className="text-red-600">No student with this id.</p>
            <a href="/admin?tab=contacts" className="text-hgl-blue underline">
              ← Back to Contacts
            </a>
          </>
        )}
        {state === 'no-family' && (
          <>
            <p className="text-gray-700">
              <span className="font-semibold">{name}</span> has no family record linked yet, so
            there&apos;s no family profile to open. Link them to a family (or create one from
            their pipeline record) and this page will take you there.
            </p>
            <a href="/admin?tab=contacts" className="text-hgl-blue underline">
              ← Back to Contacts
            </a>
          </>
        )}
      </div>
    </div>
  )
}
