// PL-449C: the plain-error rule for failed admin requests — a failed fetch
// renders ONE plain-English line with the honest status, NEVER the response
// body verbatim (the SLS incident rendered a Next 500's entire raw HTML into
// the branding panel). The one exception: a SHORT text/plain or {error} JSON
// body — our own routes' crafted refusals — IS the plain reason and shows.
// Client-safe leaf.

export async function fetchErrorLine(res: Response, action: string): Promise<string> {
  let detail = ''
  try {
    const ct = res.headers.get('content-type') ?? ''
    if (ct.startsWith('application/json')) {
      const j = (await res.json()) as { error?: unknown }
      if (typeof j?.error === 'string') detail = j.error.trim()
    } else if (ct.startsWith('text/plain')) {
      const t = (await res.text()).trim()
      if (t && t.length <= 300 && !t.startsWith('<')) detail = t
    }
  } catch {
    /* body unreadable — the status alone is still honest */
  }
  return detail
    ? `Couldn't ${action} — ${detail} (HTTP ${res.status})`
    : `Couldn't ${action} (HTTP ${res.status}) — try again; if it keeps failing, tell Code.`
}
