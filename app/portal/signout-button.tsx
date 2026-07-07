'use client'

import { supabase } from '../utils/supabase'

export default function SignOutButton() {
  async function signOut() {
    await supabase.auth.signOut()
    window.location.assign('/login')
  }
  return (
    <button onClick={signOut} className="text-xs text-gray-400 hover:text-hgl-blue transition">
      Sign out
    </button>
  )
}
