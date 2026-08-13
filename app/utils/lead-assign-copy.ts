// PL-174: lead-assignment notification copy, kept LEAF on purpose (the
// coverage-copy.ts rule): the sample pin in comms-variables.ts must be
// computed from the same code the real send uses, and comms-variables.ts is
// reachable from the client bundle — so no imports at all here.

/** Plain-English pipeline stages (PL-109 wording) — one map, used by the
 *  pipeline page and the assignment email so they can't drift. */
export const LEAD_STATUS_LABELS: Record<string, string> = {
  new: 'New',
  contacted: 'Contacted',
  intake_sent: 'Intake form sent',
  intake_complete: 'Intake complete',
  consult_scheduled: 'Consult scheduled',
  consult_done: 'Consult done',
  proposal_sent: 'Proposal sent',
  scheduled: 'Started',
  /** PL-336: the WON ending — enrolled in a group class. */
  converted: 'Enrolled',
  lost: 'Closed — not now',
}

export type LeadAssignedFacts = {
  /** Who did the assigning (the actor's email or name). */
  actorName: string
  /** The lead's display name (student, falling back to contact). */
  leadName: string
  contactName: string | null
  contactEmail: string | null
  /** What they're interested in, already phrased ("SAT prep at SIS"). */
  interest: string | null
  /** Plain-English pipeline stage ("Contacted", never a raw enum). */
  statusLabel: string
  /** Whole days since the lead was created. */
  ageDays: number
  /** Deep link to this lead on the pipeline (standing alert rule). */
  leadUrl: string
}

export function leadAssignedSubject(f: Pick<LeadAssignedFacts, 'actorName' | 'leadName'>): string {
  return `${f.actorName} assigned you a pipeline lead: ${f.leadName}`
}

/** The {alertDetailsBlock} body for AL_LEAD_ASSIGNED. */
export function leadAssignedDetails(f: LeadAssignedFacts): string {
  const age = f.ageDays <= 0 ? 'came in today' : f.ageDays === 1 ? '1 day old' : `${f.ageDays} days old`
  const facts = [
    `<li style="margin:2px 0"><strong>Stage:</strong> ${f.statusLabel}</li>`,
    ...(f.contactName || f.contactEmail
      ? [
          `<li style="margin:2px 0"><strong>Contact:</strong> ${[f.contactName, f.contactEmail]
            .filter(Boolean)
            .join(' · ')}</li>`,
        ]
      : []),
    ...(f.interest ? [`<li style="margin:2px 0"><strong>Interested in:</strong> ${f.interest}</li>`] : []),
    `<li style="margin:2px 0"><strong>Age:</strong> ${age}</li>`,
  ]
  return `<p><strong>${f.actorName}</strong> assigned you <strong>${f.leadName}</strong> on the pipeline.</p><ul style="margin:0;padding-left:20px;color:#334155">${facts.join('')}</ul><p style="margin:20px 0"><a href="${f.leadUrl}" style="display:inline-block;background:#00AEEE;color:#fff;font-weight:bold;padding:12px 24px;border-radius:6px;text-decoration:none">Open the lead</a></p>`
}
