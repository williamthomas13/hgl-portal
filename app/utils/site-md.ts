// PL-348: tiny markdown → HTML renderer for the PUBLIC class pages'
// site_content_blocks. Deliberately separate from comms-md.ts — that one
// emits email-client inline styles; this one emits semantic HTML with the
// page's Tailwind classes. Input is staff-authored, but everything is
// HTML-escaped anyway so a stray angle bracket can never become markup.
// Supported: ### sub-headings, - lists, [label](url) links, **bold**,
// *italic*, blank-line paragraphs. LEAF FILE — no imports.

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function renderInline(text: string): string {
  let out = escapeHtml(text)
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label, href) => {
    const safeHref = /^(https?:\/\/|\/|mailto:|tel:)/i.test(href.trim()) ? href.trim() : '#'
    return `<a href="${safeHref}" class="text-hgl-blue underline hover:opacity-80">${label}</a>`
  })
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  out = out.replace(/\*([^*]+)\*/g, '<em>$1</em>')
  return out
}

/** Render a content block's markdown to page HTML. */
export function renderSiteMarkdown(markdown: string): string {
  const blocks = markdown.replace(/\r\n/g, '\n').trim().split(/\n\s*\n/)
  const html: string[] = []
  for (const block of blocks) {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean)
    if (lines.length === 0) continue
    if (lines.every((l) => l.startsWith('- '))) {
      html.push(
        `<ul class="list-disc pl-5 space-y-1 text-gray-700">${lines
          .map((l) => `<li>${renderInline(l.slice(2))}</li>`)
          .join('')}</ul>`
      )
      continue
    }
    if (lines[0].startsWith('### ')) {
      html.push(`<h4 class="font-semibold text-hgl-slate mt-4 mb-1">${renderInline(lines[0].slice(4))}</h4>`)
      const rest = lines.slice(1)
      if (rest.length > 0) html.push(`<p class="text-gray-700">${rest.map(renderInline).join('<br/>')}</p>`)
      continue
    }
    html.push(`<p class="text-gray-700">${lines.map(renderInline).join('<br/>')}</p>`)
  }
  return html.join('\n')
}

/** Split a FAQ block ("### Question" + answer paragraphs) into items. */
export function parseFaqItems(markdown: string): { question: string; answerMarkdown: string }[] {
  const items: { question: string; answerMarkdown: string }[] = []
  const parts = markdown.replace(/\r\n/g, '\n').split(/^### /m).map((p) => p.trim()).filter(Boolean)
  for (const part of parts) {
    const nl = part.indexOf('\n')
    if (nl === -1) continue
    items.push({ question: part.slice(0, nl).trim(), answerMarkdown: part.slice(nl + 1).trim() })
  }
  return items
}
