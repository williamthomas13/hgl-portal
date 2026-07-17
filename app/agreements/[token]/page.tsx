import { supabaseAdmin as supabase } from '../../utils/supabase-admin'
import { verifyAgreementToken } from '../../utils/intake'
import { loadContactInfo } from '../../utils/tutoring-emails'
import { renderMarkdownBody } from '../../utils/comms-md'
import { PublicNoticeCard } from '../../components/PublicNotice'
import AgreementAccept from './agreement-accept'

// Policy agreement page (Phase 7e, docs/PHASE7_SPEC.md §12) — the signed-link
// target inside T8 (or sent standalone from /admin/agreements). Shows the
// ACTIVE policy version in full, takes a typed full name + checkbox, and
// records a first-class acceptance (identity, timestamp, IP, content
// snapshot) — the click-through replacement for the Google Forms "signature".

export const dynamic = 'force-dynamic'

/* eslint-disable @typescript-eslint/no-explicit-any */
function one<T>(v: T | T[] | null | undefined): T | null {
  if (v == null) return null
  return Array.isArray(v) ? ((v[0] as T) ?? null) : v
}

export default async function AgreementPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const familyId = verifyAgreementToken(token)
  const contact = await loadContactInfo()

  const notFound = (
    <PublicNoticeCard title="We couldn't open that link">
      The link may be out of date. Email {contact.email}{' or call '} {contact.phone}{' and '} we&apos;ll
      send you a fresh one.
    </PublicNoticeCard>
  )
  if (!familyId) return notFound

  const { data: family } = await supabase
    .from('families')
    .select('id, parent_first_name, parent_last_name, parent_email')
    .eq('id', familyId)
    .maybeSingle()
  if (!family) return notFound

  const { data: template } = await supabase
    .from('agreement_templates')
    .select('id, version, body_markdown, effective_date')
    .eq('kind', 'scheduling_billing_policy')
    .eq('active', true)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!template) {
    return (
      <PublicNoticeCard title="Nothing to sign right now">
        There&apos;s no policy awaiting your acceptance. If you were expecting one, email{' '}
        {contact.email}{' or call '} {contact.phone}.
      </PublicNoticeCard>
    )
  }

  // Already accepted THIS version? Show the record instead of re-asking.
  const { data: acceptance } = await supabase
    .from('agreement_acceptances')
    .select('id, accepted_by_name, accepted_at, agreement_templates ( version )')
    .eq('family_id', familyId)
    .eq('agreement_template_id', template.id)
    .order('accepted_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const bodyHtml = renderMarkdownBody(template.body_markdown, {})

  return (
    <div className="min-h-screen bg-gray-50 py-10 px-4">
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="bg-white rounded-lg shadow-md border-t-4 border-hgl-blue p-8">
          <p className="text-xs text-gray-400 mb-4">
            Higher Ground Learning · policy version {template.version}
            {template.effective_date ? ` · effective ${template.effective_date}` : ''}
          </p>
          <div
            className="agreement-body text-[15px] leading-relaxed text-slate-700"
            // Rendered from our own versioned template markdown — staff-authored content.
            dangerouslySetInnerHTML={{ __html: bodyHtml }}
          />
          <div className="mt-8 border-t border-gray-100 pt-6">
            {acceptance ? (
              <div className="p-4 rounded bg-green-50 border border-green-200 text-green-800 text-sm">
                <strong>Already accepted.</strong>{' '}
                {(one<any>(acceptance.agreement_templates)?.version ?? template.version) &&
                  `Version ${one<any>(acceptance.agreement_templates)?.version ?? template.version} was accepted by ${acceptance.accepted_by_name} on ${new Date(
                    acceptance.accepted_at
                  ).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}.`}{' '}
                Nothing more to do — we keep a copy of the exact text, and you can request it any
                time.
              </div>
            ) : (
              <AgreementAccept token={token} defaultEmail={family.parent_email ?? ''} />
            )}
          </div>
        </div>
        <div className="bg-white rounded-lg shadow-sm p-5 text-sm text-gray-600">
          Questions about any of these policies? Email{' '}
          <a href={`mailto:${contact.email}`} className="text-hgl-blue underline">
            {contact.email}
          </a>{' '}
          or give us a call at <strong>{contact.phone}</strong>{' — '}we&apos;re happy to walk through
          them before you accept.
        </div>
      </div>
    </div>
  )
}
/* eslint-enable @typescript-eslint/no-explicit-any */
