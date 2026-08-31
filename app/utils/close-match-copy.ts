// PL-417: the close-match alert's details block — LEAF MODULE
// (client-importable, no server imports) so the editor's sample pin composes
// through the SAME builder real sends use (the PL-96 drift guard). This was
// the one {alertDetailsBlock} template with no pin, so its editor preview
// showed the shared registration story (the PL-137 bug class, batch-42
// finding). close-match.ts is the only real-send caller; comms-variables
// pins the sample from here with fixture facts.

export function closeMatchAlertDetails(f: {
  leadName: string
  studentFull: string
  reasons: string[]
  reviewUrl: string
}): string {
  return `
      <p>The pipeline lead <strong>${f.leadName}</strong> looks like the same person as the
      registered student <strong>${f.studentFull}</strong>:</p>
      <ul>${f.reasons.map((r) => `<li>${r}</li>`).join('')}</ul>
      <p>Nothing was merged — take a look side by side and either link them or mark them as
      different people (that answer is remembered).</p>
      <p><a href="${f.reviewUrl}">Review the pair →</a></p>`
}
