import { supabaseAdmin as supabase } from './supabase-admin'
import {
  PERSONAL_FROM,
  footerR,
  footerT,
  wrap,
  type Audience,
  type EnrollmentEmailContext,
  type Rendered,
} from './email'
import { renderMarkdownBody, renderPlain } from './comms-md'
import { resolveVariables, type ExtraVars } from './comms-variables'

// Feature A4 render path (docs/COMMS_ATTENDANCE_PARENT_SPEC.md §A4): look up
// the template's active version at send time, render its markdown into the
// standard shell, and hand back the version id so sendOnce can stamp
// body_snapshot_id. A template only takes over from its code-rendered twin
// once `live=true` (flipped per-template after test-send verification);
// until then — and on any load/render failure — the caller's code fallback
// sends, so copy edits can never take the pipeline down.

export type RenderedWithVersion = Rendered & { versionId?: string }

type ActiveTemplate = {
  template_key: string
  from_identity: 'info' | 'billy'
  category: 'transactional' | 'relationship'
  live: boolean
  version: {
    id: string
    subject: string
    preheader: string
    body_markdown: string
    footer_note: string | null
  } | null
}

const CACHE_TTL_MS = 60_000
const cache = new Map<string, { at: number; row: ActiveTemplate | null }>()

export function clearTemplateCache() {
  cache.clear()
}

async function loadActiveTemplate(templateKey: string): Promise<ActiveTemplate | null> {
  const hit = cache.get(templateKey)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.row

  const { data } = await supabase
    .from('email_templates')
    .select(
      `template_key, from_identity, category, live,
       version:email_template_versions!email_templates_active_version_fk
         ( id, subject, preheader, body_markdown, footer_note )`
    )
    .eq('template_key', templateKey)
    .maybeSingle()

  const row = (data as unknown as ActiveTemplate | null) ?? null
  cache.set(templateKey, { at: Date.now(), row })
  return row
}

/**
 * Render a specific version (editor preview / test send) — no live gate.
 */
export function renderVersion(
  version: { subject: string; preheader: string; body_markdown: string; footer_note: string | null },
  meta: { from_identity: string; category: string },
  ctx: EnrollmentEmailContext,
  audience: Audience,
  extra: ExtraVars = {}
): Rendered {
  const vars = resolveVariables(ctx, audience, extra)
  const bodyHtml = renderMarkdownBody(version.body_markdown, vars)
  const footer =
    meta.category === 'relationship'
      ? footerR(ctx.unsubscribeUrl, version.footer_note ?? undefined)
      : footerT(version.footer_note ?? undefined)
  return {
    subject: renderPlain(version.subject, vars),
    html: wrap(bodyHtml, { preheader: renderPlain(version.preheader, vars), footer }),
    from: meta.from_identity === 'billy' ? PERSONAL_FROM : undefined,
  }
}

/** DB render when the template is live; null → caller uses the code fallback. */
export async function renderDbEmail(
  templateKey: string,
  ctx: EnrollmentEmailContext,
  audience: Audience,
  extra: ExtraVars = {}
): Promise<RenderedWithVersion | null> {
  const tpl = await loadActiveTemplate(templateKey)
  if (!tpl || !tpl.live || !tpl.version) return null
  return { ...renderVersion(tpl.version, tpl, ctx, audience, extra), versionId: tpl.version.id }
}

/**
 * The pipeline's render call: DB template when live, code template otherwise.
 * Never throws — a bad template falls back to code and logs.
 */
export async function renderEmail(
  templateKey: string,
  ctx: EnrollmentEmailContext,
  audience: Audience,
  extra: ExtraVars,
  fallback: () => Rendered
): Promise<RenderedWithVersion> {
  try {
    const db = await renderDbEmail(templateKey, ctx, audience, extra)
    if (db) return db
  } catch (e) {
    console.error(`DB template render failed for ${templateKey} — using code fallback:`, e)
  }
  return fallback()
}
