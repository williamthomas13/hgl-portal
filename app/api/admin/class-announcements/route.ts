import { NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '../../../utils/supabase-admin'
import { sessionRole } from '../../../utils/staff-gate'

// PL-452: which classes have had their CS "class is ready" welcome sent —
// recomputed from the SEND LOG on every read (the state-driven rule: no
// stored flag, so a send from any path clears the chip on the next fetch).
// Both welcome variants count (with and without attachments — both send
// under CS_CLASS_CONFIRMED); the collateral-only follow-up is a different
// template and deliberately does not.

export async function GET() {
  const caller = await sessionRole('staff')
  if (!caller) return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })
  const { data, error } = await supabase
    .from('email_sends')
    .select('class_id')
    .eq('template_key', 'CS_CLASS_CONFIRMED')
    .eq('is_test', false)
    .in('status', ['sending', 'sent', 'delivered'])
    .not('class_id', 'is', null)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ announced: [...new Set((data ?? []).map((r) => r.class_id as string))] })
}
