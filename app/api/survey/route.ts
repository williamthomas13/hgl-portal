import { NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '../../utils/supabase-admin'
import { verifySurveyToken } from '../../utils/survey'

// PL-219 v1.5: survey submission. The anonymity contract is enforced HERE,
// structurally: an in-class token physically cannot write a student_id, and
// an email link with the anonymous box checked discards the identity before
// insert — only the enrollment's responded-bit survives (reminder
// suppression). No login on either channel; the signed token is the
// authorization.

export async function POST(req: Request) {
  let body: {
    token?: string
    satisfaction?: number
    recommend?: number
    instructor_rating?: number
    most_useful?: string | null
    anonymous?: boolean
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }

  const info = verifySurveyToken(body.token ?? '')
  if (info === 'expired') {
    return NextResponse.json({ error: 'This link has aged out — email us instead.' }, { status: 403 })
  }
  if (!info) return NextResponse.json({ error: 'This link is not valid.' }, { status: 403 })

  const ratings = [body.satisfaction, body.recommend, body.instructor_rating]
  if (ratings.some((r) => typeof r !== 'number' || r < 1 || r > 5)) {
    return NextResponse.json({ error: 'Each rating needs a number from 1 to 5.' }, { status: 400 })
  }

  let classId: string
  let studentId: string | null = null
  if (info.kind === 'class') {
    classId = info.classId
  } else {
    const { data: enr } = await supabase
      .from('enrollments')
      .select('id, class_id, student_id, survey_responded_at')
      .eq('id', info.enrollmentId)
      .maybeSingle()
    if (!enr) return NextResponse.json({ error: 'This link is not valid.' }, { status: 403 })
    if (enr.survey_responded_at) {
      return NextResponse.json({ error: 'We already have your feedback — thank you!' }, { status: 409 })
    }
    classId = enr.class_id
    // The anonymous checkbox: identity discarded BEFORE the insert.
    studentId = body.anonymous ? null : enr.student_id
  }

  const { error } = await supabase.from('class_survey_responses').insert({
    class_id: classId,
    student_id: studentId,
    channel: info.kind === 'class' ? 'in_class' : 'email',
    satisfaction: body.satisfaction,
    recommend: body.recommend,
    instructor_rating: body.instructor_rating,
    most_useful: (body.most_useful ?? '').trim() || null,
  })
  if (error) {
    console.error('survey insert failed:', error.message)
    return NextResponse.json({ error: 'Could not save — please try again.' }, { status: 500 })
  }

  // The responded-bit (email channel only — in-class is unmatchable by
  // design; the reminder copy owns that tradeoff).
  if (info.kind === 'student') {
    await supabase
      .from('enrollments')
      .update({ survey_responded_at: new Date().toISOString() })
      .eq('id', info.enrollmentId)
  }

  return NextResponse.json({ ok: true })
}
