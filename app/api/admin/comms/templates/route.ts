import { NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '../../../../utils/supabase-admin'
import { sessionRole } from '../../../../utils/staff-gate'
import { clearTemplateCache, renderVersion } from '../../../../utils/comms-db-render'
import { extractVariables } from '../../../../utils/comms-md'
import { KNOWN_VARIABLE_NAMES, SAMPLE_CONTEXT, SAMPLE_EXTRA } from '../../../../utils/comms-variables'
import { sendOnce, type Audience } from '../../../../utils/email'

// Feature A4 template editor backend (docs/COMMS_ATTENDANCE_PARENT_SPEC.md).
// Admin + manager only (spec permissions). Versions are immutable: save and
// revert both create a NEW version and point active_version_id at it; the
// `live` flag is the per-template scheduler cutover (test-send first).

type SaveBody = {
  action: 'save_version' | 'revert' | 'test_send' | 'preview' | 'set_live'
  templateKey?: string
  subject?: string
  preheader?: string
  bodyMarkdown?: string
  footerNote?: string | null
  notes?: string
  versionId?: string
  audience?: Audience
  live?: boolean
}

function validateVariables(texts: string[]): { unknown: string[] } {
  const used = new Set(texts.flatMap((t) => extractVariables(t)))
  return { unknown: [...used].filter((v) => !KNOWN_VARIABLE_NAMES.includes(v)) }
}

export async function POST(req: Request) {
  const caller = await sessionRole('staff')
  if (!caller) return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })

  let body: SaveBody
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }
  const key = (body.templateKey ?? '').trim()

  const { data: template } = key
    ? await supabase.from('email_templates').select('*').eq('template_key', key).maybeSingle()
    : { data: null }

  switch (body.action) {
    case 'preview': {
      // Render arbitrary draft content (unsaved) with sample data.
      if (!template) return NextResponse.json({ error: 'Unknown template.' }, { status: 404 })
      const rendered = renderVersion(
        {
          subject: body.subject ?? '',
          preheader: body.preheader ?? '',
          body_markdown: body.bodyMarkdown ?? '',
          footer_note: body.footerNote ?? null,
        },
        template,
        SAMPLE_CONTEXT,
        body.audience ?? 'parent',
        SAMPLE_EXTRA
      )
      const { unknown } = validateVariables([
        body.subject ?? '',
        body.preheader ?? '',
        body.bodyMarkdown ?? '',
      ])
      return NextResponse.json({ ...rendered, unknownVariables: unknown })
    }

    case 'save_version': {
      if (!template) return NextResponse.json({ error: 'Unknown template.' }, { status: 404 })
      const subject = (body.subject ?? '').trim()
      const markdown = (body.bodyMarkdown ?? '').trim()
      if (!subject || !markdown) {
        return NextResponse.json({ error: 'Subject and body are required.' }, { status: 400 })
      }
      // Spec: block save on unknown variables (typo protection).
      const { unknown } = validateVariables([subject, body.preheader ?? '', markdown])
      if (unknown.length > 0) {
        return NextResponse.json(
          { error: `Unknown variable(s): ${unknown.map((v) => `{${v}}`).join(', ')}` },
          { status: 422 }
        )
      }
      const { data: latest } = await supabase
        .from('email_template_versions')
        .select('version_number')
        .eq('template_key', key)
        .order('version_number', { ascending: false })
        .limit(1)
      const nextNumber = (latest?.[0]?.version_number ?? 0) + 1
      const { data: inserted, error } = await supabase
        .from('email_template_versions')
        .insert([
          {
            template_key: key,
            version_number: nextNumber,
            subject,
            preheader: (body.preheader ?? '').trim(),
            body_markdown: markdown,
            footer_note: (body.footerNote ?? '')?.trim() || null,
            variables_used: extractVariables(`${subject}\n${body.preheader ?? ''}\n${markdown}`),
            notes: (body.notes ?? '').trim() || null,
            created_by: caller.email,
          },
        ])
        .select('id, version_number')
      if (error || !inserted?.[0]) {
        return NextResponse.json({ error: error?.message ?? 'Insert failed.' }, { status: 500 })
      }
      await supabase
        .from('email_templates')
        .update({ active_version_id: inserted[0].id, updated_at: new Date().toISOString() })
        .eq('template_key', key)
      clearTemplateCache()
      return NextResponse.json({ ok: true, versionId: inserted[0].id, versionNumber: nextNumber })
    }

    case 'revert': {
      if (!template || !body.versionId) {
        return NextResponse.json({ error: 'Need template and versionId.' }, { status: 400 })
      }
      const { data: old } = await supabase
        .from('email_template_versions')
        .select('*')
        .eq('id', body.versionId)
        .eq('template_key', key)
        .maybeSingle()
      if (!old) return NextResponse.json({ error: 'Version not found.' }, { status: 404 })
      const { data: latest } = await supabase
        .from('email_template_versions')
        .select('version_number')
        .eq('template_key', key)
        .order('version_number', { ascending: false })
        .limit(1)
      const nextNumber = (latest?.[0]?.version_number ?? 0) + 1
      const { data: inserted, error } = await supabase
        .from('email_template_versions')
        .insert([
          {
            template_key: key,
            version_number: nextNumber,
            subject: old.subject,
            preheader: old.preheader,
            body_markdown: old.body_markdown,
            footer_note: old.footer_note,
            variables_used: old.variables_used,
            notes: `revert to v${old.version_number}`,
            created_by: caller.email,
          },
        ])
        .select('id, version_number')
      if (error || !inserted?.[0]) {
        return NextResponse.json({ error: error?.message ?? 'Insert failed.' }, { status: 500 })
      }
      await supabase
        .from('email_templates')
        .update({ active_version_id: inserted[0].id, updated_at: new Date().toISOString() })
        .eq('template_key', key)
      clearTemplateCache()
      return NextResponse.json({ ok: true, versionId: inserted[0].id, versionNumber: nextNumber })
    }

    case 'test_send': {
      if (!template?.active_version_id) {
        return NextResponse.json({ error: 'No active version to test.' }, { status: 400 })
      }
      const { data: version } = await supabase
        .from('email_template_versions')
        .select('*')
        .eq('id', body.versionId ?? template.active_version_id)
        .maybeSingle()
      if (!version) return NextResponse.json({ error: 'Version not found.' }, { status: 404 })
      const audience: Audience = body.audience ?? 'parent'
      const rendered = renderVersion(version, template, SAMPLE_CONTEXT, audience, SAMPLE_EXTRA)
      const status = await sendOnce({
        dedupeKey: `test:${key}:v${version.version_number}:${audience}:${Date.now()}`,
        emailType: 'template_test',
        templateKey: key,
        recipientRole: 'admin',
        to: [caller.email],
        from: rendered.from,
        subject: `[TEST ${key} v${version.version_number}] ${rendered.subject}`,
        html: rendered.html,
        isTest: true,
        bodySnapshotId: version.id,
      })
      return NextResponse.json({ ok: status === 'sent', status, to: caller.email })
    }

    case 'set_live': {
      if (!template) return NextResponse.json({ error: 'Unknown template.' }, { status: 404 })
      if (body.live && !template.active_version_id) {
        return NextResponse.json({ error: 'No active version — save one first.' }, { status: 400 })
      }
      const { error } = await supabase
        .from('email_templates')
        .update({ live: Boolean(body.live), updated_at: new Date().toISOString() })
        .eq('template_key', key)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      clearTemplateCache()
      return NextResponse.json({ ok: true })
    }

    default:
      return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
  }
}
