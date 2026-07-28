import { NextResponse } from 'next/server'
import { sessionRole } from '../../../utils/staff-gate'
import { loadTutorHoursReport, stripTutorHoursRevenue } from '../../../utils/tutor-hours-report'

// PL-218: tutor hours breakdown (the spreadsheet replacement). Same role
// rule as the PL-204 report: managers get the hours-only variant — dollar
// fields removed from the payload server-side, never hidden client-side.

export async function GET(request: Request) {
  const caller = await sessionRole('staff')
  if (!caller) return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })

  const url = new URL(request.url)
  const tutorId = url.searchParams.get('tutor') || 'all'
  const monthRe = /^\d{4}-\d{2}$/
  const now = new Date()
  const thisMonth = now.toISOString().slice(0, 7)
  const yearAgo = new Date(now.getFullYear() - 1, now.getMonth(), 1)
  const defaultFrom = `${yearAgo.getFullYear()}-${String(yearAgo.getMonth() + 1).padStart(2, '0')}`
  const fromMonth = monthRe.test(url.searchParams.get('from') ?? '') ? url.searchParams.get('from')! : defaultFrom
  const toMonth = monthRe.test(url.searchParams.get('to') ?? '') ? url.searchParams.get('to')! : thisMonth
  if (toMonth < fromMonth) {
    return NextResponse.json({ error: 'The range ends before it starts.' }, { status: 400 })
  }

  const report = await loadTutorHoursReport({ tutorId, fromMonth, toMonth })
  return NextResponse.json(caller.role === 'admin' ? report : stripTutorHoursRevenue(report))
}
