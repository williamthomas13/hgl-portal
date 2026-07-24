// PL-137: coverage-alert copy, kept LEAF on purpose.
//
// The sample pins in comms-variables.ts must be computed from the same code
// the real send uses, or they drift silently — which is the whole bug PL-137
// fixes. But comms-variables.ts is reachable from the client bundle, and
// coverage.ts pulls in supabase-admin. Importing one from the other is
// exactly the crash PL-96 hit with cancellation-copy.ts.
//
// So the copy lives here with NO imports at all: coverage.ts composes real
// sends through it, comms-variables.ts computes its samples through it, and
// the regress:client-imports gate stays green.

export type CoverageEvent = 'requested' | 'accepted' | 'declined' | 'cancelled'

export type CoverageAlertFacts = {
  event: CoverageEvent
  studentName: string
  studentFirst: string
  studentId: string
  subjectName: string
  /** Already formatted on the tutor's clock by the caller. */
  when: string
  requesterName: string
  candidateName: string
  baseUrl: string
}

/** The {alertDetailsBlock} body for AL_COVERAGE_REQUEST / AL_COVERAGE_RESOLVED. */
export function coverageAlertDetails(f: CoverageAlertFacts): string {
  const link = `${f.baseUrl}/admin/tutoring?schedule=${f.studentId}`
  const headline =
    f.event === 'requested'
      ? `${f.requesterName} asked ${f.candidateName} to cover ${f.studentName}'s ${f.subjectName} session on ${f.when}.`
      : f.event === 'accepted'
        ? `${f.candidateName} accepted coverage of ${f.studentName}'s ${f.subjectName} session on ${f.when} — the session moved to their schedule and calendar.`
        : f.event === 'declined'
          ? `${f.candidateName} declined to cover ${f.studentName}'s ${f.subjectName} session on ${f.when}. The session still needs coverage — ${f.requesterName} can pick another candidate, or step in to help.`
          : `${f.requesterName} withdrew the coverage request for ${f.studentName}'s ${f.subjectName} session on ${f.when} (they are keeping the session).`
  return `<p>${headline}</p>
      <p style="margin:20px 0"><a href="${link}" style="display:inline-block;background:#00AEEE;color:#fff;font-weight:bold;padding:12px 24px;border-radius:6px;text-decoration:none">Open ${f.studentFirst}'s schedule</a></p>`
}

/** The alert SUBJECT — pinned alongside the body for the same reason. */
export function coverageAlertSubject(f: Pick<CoverageAlertFacts, 'event' | 'studentName' | 'when'>): string {
  return f.event === 'requested'
    ? `Substitute requested: ${f.studentName} — ${f.when}`
    : `Substitute request ${f.event}: ${f.studentName} — ${f.when}`
}
