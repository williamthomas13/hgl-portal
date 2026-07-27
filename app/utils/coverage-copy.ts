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

// ---- PL-157: the SUB_* tutor-facing copy moves here too --------------------
// The SUB_COVERAGE_NOTE preview read as one person writing to themselves:
// the greeting resolved from the shared sample pool ("Billy") while the
// pinned {coverageNoteBlock} prose was written around a different scenario
// (thanking Jordan). Same class of bug as PL-137's registration-copy-in-a-
// coverage-alert: two sources for one story. The fix is structural, not a
// re-sample — these composers are the single source, coverage.ts sends
// through them, and comms-variables.ts derives EVERY sample in the trio from
// one facts object through them, so the sources cannot drift apart again.

/** The {coverageSessionBlock} lines for SUB_COVERAGE_OFFER (joined with \n). */
export function coverageSessionLines(f: {
  when: string
  studentFirst: string
  subjectName: string
  location?: string | null
  requesterName: string
  note?: string | null
}): string[] {
  return [
    `${f.when} (your local time)`,
    `${f.studentFirst} · ${f.subjectName}`,
    ...(f.location ? [f.location] : []),
    ...(f.note?.trim() ? [`From ${f.requesterName}: ${f.note.trim()}`] : []),
  ]
}

/** The {coverageOutcomeLine} for SUB_COVERAGE_RESULT. */
export function coverageOutcomeLine(f: {
  accepted: boolean
  candidateName: string
  studentFirst: string
  subjectName: string
  when: string
  /** Escalation contact shown on the declined path. */
  contactEmail: string
}): string {
  return f.accepted
    ? `${f.candidateName} accepted — ${f.studentFirst}'s ${f.subjectName} session on ${f.when} has moved to their schedule and calendar. Nothing else to do.`
    : `${f.candidateName} can't cover ${f.studentFirst}'s ${f.subjectName} session on ${f.when}. It's still yours — pick another candidate from your portal, or your manager can help find a suitable replacement (${f.contactEmail}).`
}

/**
 * The {coverageNoteButton} for the ACCEPTED outcome — declined/withdrawn
 * outcomes pass empty (nobody to hand off to). The URL is caller-supplied
 * (the PL-96 convertUrl lesson: no URL machinery in a leaf module).
 */
export function coverageNoteButtonHtml(f: {
  noteUrl: string
  subFirstName: string
  studentFirst: string
}): string {
  return `<p style="margin:20px 0"><a href="${f.noteUrl}" style="display:inline-block;background:#00AEEE;color:#fff;font-weight:bold;padding:12px 24px;border-radius:6px;text-decoration:none">Send ${f.subFirstName} a note</a></p>
         <p style="color:#506171;font-size:14px">Anything ${f.subFirstName} should know before walking in — where ${f.studentFirst} is stuck, what to bring, what not to repeat. It goes to them and stays with the handoff.</p>`
}

/**
 * The {coverageNoteBlock}: the tutor's free text, escaped and wrapped as
 * paragraphs (blank line = new paragraph, single newline = line break).
 * Escapes BEFORE inserting <br> — the previous inline version escaped after,
 * turning its own <br> tags into visible "<br>" text.
 */
export function coverageNoteHtml(note: string): string {
  return note
    .split(/\n{2,}/)
    .map((para) => `<p>${para.replace(/</g, '&lt;').replace(/\n/g, '<br>')}</p>`)
    .join('')
}
