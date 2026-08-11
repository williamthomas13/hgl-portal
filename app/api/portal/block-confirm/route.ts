import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '../../../utils/supabase-server'
import { supabaseAdmin as supabase } from '../../../utils/supabase-admin'
import { recordBlockDecision } from '../../../utils/block-confirm'

// PL-299: the signed-in family records their continue-or-stop decision on an
// hours block. No tokenized path exists by design — the session IS the
// authorization; the engagement must belong to a family whose parent email
// matches the signed-in user.

export async function POST(req: Request) {
  const session = await createSupabaseServerClient()
  const {
    data: { user },
  } = await session.auth.getUser()
  if (!user?.email) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 })

  let body: {
    engagementId?: string
    decision?: 'confirmed' | 'declined'
    choice?: '5' | '10' | '15' | 'monthly'
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }
  if (!body.engagementId || (body.decision !== 'confirmed' && body.decision !== 'declined')) {
    return NextResponse.json({ error: 'Pass the engagement and a decision.' }, { status: 400 })
  }

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const { data: eng } = await supabase
    .from('tutoring_engagements')
    .select('id, students!inner ( family_id, families!inner ( parent_email ) )')
    .eq('id', body.engagementId)
    .maybeSingle()
  const student: any = Array.isArray(eng?.students) ? eng?.students[0] : eng?.students
  const family: any = Array.isArray(student?.families) ? student?.families[0] : student?.families
  /* eslint-enable @typescript-eslint/no-explicit-any */
  if (!eng || (family?.parent_email ?? '').toLowerCase() !== user.email.toLowerCase()) {
    return NextResponse.json({ error: 'Not your engagement.' }, { status: 403 })
  }

  const result = await recordBlockDecision(body.engagementId, body.decision, 'portal', body.choice)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })
  return NextResponse.json({
    ok: true,
    outcome: result.outcome,
    ...(result.outcome === 'reserved' ? { sessions: result.sessions } : {}),
  })
}
