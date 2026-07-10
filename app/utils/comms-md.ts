// Feature A4 (docs/COMMS_ATTENDANCE_PARENT_SPEC.md): the tiny markdown
// dialect email templates are written in. Layout stays in code (the wrap()
// shell); this renders BODY copy only. Supported, and nothing else:
//   # H1 / ## H2 headings          *italic* / **bold**
//   - bullet lists                 [text](url) links
//   > testimonial/quote blocks     [button:Label](url-or-{variable}) CTAs
//   {variable} placeholders        blank line = paragraph break
//
// Variables are substituted AFTER structure parsing: scalar values are
// HTML-escaped; block variables (pre-rendered HTML like {orderSummaryBlock})
// must stand alone as their own paragraph and are inserted raw.

export type ResolvedVars = Record<string, { value: string; block?: boolean }>

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** {variable} tokens present in a template body/subject (editor validation). */
export function extractVariables(text: string): string[] {
  return [...new Set([...text.matchAll(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g)].map((m) => m[1]))]
}

function substituteInline(text: string, vars: ResolvedVars): string {
  return text.replace(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g, (raw, name) => {
    const v = vars[name]
    if (!v) return raw // unknown tokens survive visibly — validation blocks them on save
    return v.block ? v.value : escapeHtml(v.value)
  })
}

/** Inline markdown: bold, italic, links, buttons. Escapes everything else. */
function renderInline(text: string, vars: ResolvedVars): string {
  let out = escapeHtml(text)
  // [button:Label](href) — href may itself be a {variable}
  out = out.replace(/\[button:([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => {
    const resolved = substituteInline(href.trim(), vars)
    return `<a href="${resolved}" style="display:inline-block;background:#00AEEE;color:#fff;font-weight:bold;padding:12px 24px;border-radius:6px;text-decoration:none">${substituteInline(label, vars)}</a>`
  })
  // [text](href)
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => {
    const resolved = substituteInline(href.trim(), vars)
    return `<a href="${resolved}">${substituteInline(label, vars)}</a>`
  })
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  out = out.replace(/\*([^*]+)\*/g, '<em>$1</em>')
  return substituteInline(out, vars)
}

/** Render a template body (markdown + variables) to shell-ready HTML. */
export function renderMarkdownBody(markdown: string, vars: ResolvedVars): string {
  const blocks = markdown.replace(/\r\n/g, '\n').trim().split(/\n\s*\n/)
  const html: string[] = []

  for (const block of blocks) {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean)
    if (lines.length === 0) continue

    // A paragraph that IS a single block variable → raw HTML insertion.
    const soloVar = block.trim().match(/^\{([a-zA-Z][a-zA-Z0-9_]*)\}$/)
    if (soloVar && vars[soloVar[1]]?.block) {
      html.push(vars[soloVar[1]].value)
      continue
    }

    if (lines.every((l) => l.startsWith('- '))) {
      html.push(
        `<ul style="padding-left:20px">${lines
          .map((l) => `<li>${renderInline(l.slice(2), vars)}</li>`)
          .join('')}</ul>`
      )
      continue
    }
    if (lines.every((l) => l.startsWith('> '))) {
      html.push(
        `<p style="font-size:14px;color:#475569">${lines
          .map((l) => renderInline(l.slice(2), vars))
          .join('<br/>')}</p>`
      )
      continue
    }
    if (lines[0].startsWith('## ')) {
      html.push(`<h3 style="color:#334155">${renderInline(lines[0].slice(3), vars)}</h3>`)
      const rest = lines.slice(1)
      if (rest.length > 0) html.push(`<p>${rest.map((l) => renderInline(l, vars)).join('<br/>')}</p>`)
      continue
    }
    if (lines[0].startsWith('# ')) {
      html.push(
        `<h2 style="color:#334155;font-size:26px;margin:8px 0">${renderInline(lines[0].slice(2), vars)}</h2>`
      )
      const rest = lines.slice(1)
      if (rest.length > 0) html.push(`<p>${rest.map((l) => renderInline(l, vars)).join('<br/>')}</p>`)
      continue
    }

    // A lone [button:…] paragraph renders as the standard CTA block.
    if (lines.length === 1 && /^\[button:[^\]]+\]\([^)]+\)$/.test(lines[0])) {
      html.push(`<p style="margin:20px 0">${renderInline(lines[0], vars)}</p>`)
      continue
    }

    html.push(`<p>${lines.map((l) => renderInline(l, vars)).join('<br/>')}</p>`)
  }
  return html.join('\n')
}

/** Subject/preheader: plain-text substitution, no markdown, no escaping. */
export function renderPlain(text: string, vars: ResolvedVars): string {
  return text.replace(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g, (raw, name) => vars[name]?.value ?? raw)
}
