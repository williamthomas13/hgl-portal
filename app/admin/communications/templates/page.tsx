'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../../../utils/supabase'
import { VARIABLES } from '../../../utils/comms-variables'

// Feature A4 template editor (docs/COMMS_ATTENDANCE_PARENT_SPEC.md §A4).
// Markdown editor + variable palette + live sample-data preview; saving
// always creates a new immutable version; revert copies an old version
// forward; "send test to me" mails the signed-in staff member. The `live`
// toggle is the per-template scheduler cutover from code-rendered copy.

type TemplateRow = {
  template_key: string
  display_name: string
  sequence_number: string | null
  audience: string
  from_identity: string
  category: string
  active_version_id: string | null
  live: boolean
  updated_at: string
}

type VersionRow = {
  id: string
  template_key: string
  version_number: number
  subject: string
  preheader: string
  body_markdown: string
  footer_note: string | null
  notes: string | null
  created_by: string | null
  created_at: string
}

export default function TemplateEditor() {
  const [templates, setTemplates] = useState<TemplateRow[]>([])
  const [selected, setSelected] = useState<TemplateRow | null>(null)
  const [versions, setVersions] = useState<VersionRow[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  // Draft fields
  const [subject, setSubject] = useState('')
  const [preheader, setPreheader] = useState('')
  const [bodyMarkdown, setBodyMarkdown] = useState('')
  const [footerNote, setFooterNote] = useState('')
  const [notes, setNotes] = useState('')
  const [dirty, setDirty] = useState(false)

  // Preview
  const [previewAudience, setPreviewAudience] = useState<'parent' | 'student'>('parent')
  const [previewHtml, setPreviewHtml] = useState('')
  const [previewSubject, setPreviewSubject] = useState('')
  const [unknownVars, setUnknownVars] = useState<string[]>([])
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [showHistory, setShowHistory] = useState(false)
  const [diffAgainst, setDiffAgainst] = useState<VersionRow | null>(null)
  const bodyRef = useRef<HTMLTextAreaElement | null>(null)

  const fetchTemplates = useCallback(async () => {
    const { data, error } = await supabase
      .from('email_templates')
      .select('*')
      .order('template_key')
    setError(error ? `${error.message} — has migration 20260712000002 been applied?` : '')
    if (data) setTemplates(data as TemplateRow[])
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchTemplates()
  }, [fetchTemplates])

  async function selectTemplate(t: TemplateRow) {
    setSelected(t)
    setShowHistory(false)
    setDiffAgainst(null)
    setMessage('')
    const { data } = await supabase
      .from('email_template_versions')
      .select('*')
      .eq('template_key', t.template_key)
      .order('version_number', { ascending: false })
    const rows = (data as VersionRow[]) ?? []
    setVersions(rows)
    const active = rows.find((v) => v.id === t.active_version_id) ?? rows[0]
    setSubject(active?.subject ?? '')
    setPreheader(active?.preheader ?? '')
    setBodyMarkdown(active?.body_markdown ?? '')
    setFooterNote(active?.footer_note ?? '')
    setNotes('')
    setDirty(false)
    setPreviewAudience(t.audience === 'student' ? 'student' : 'parent')
  }

  const refreshPreview = useCallback(
    (draft: { subject: string; preheader: string; bodyMarkdown: string; footerNote: string }, audience: string) => {
      if (!selected) return
      if (previewTimer.current) clearTimeout(previewTimer.current)
      previewTimer.current = setTimeout(async () => {
        const res = await fetch('/api/admin/comms/templates', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'preview',
            templateKey: selected.template_key,
            ...draft,
            audience,
          }),
        })
        if (res.ok) {
          const out = await res.json()
          setPreviewHtml(out.html)
          setPreviewSubject(out.subject)
          setUnknownVars(out.unknownVariables ?? [])
        }
      }, 400)
    },
    [selected]
  )

  useEffect(() => {
    refreshPreview({ subject, preheader, bodyMarkdown, footerNote }, previewAudience)
  }, [subject, preheader, bodyMarkdown, footerNote, previewAudience, refreshPreview])

  async function api(body: Record<string, unknown>) {
    setBusy(true)
    setMessage('')
    const res = await fetch('/api/admin/comms/templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    setBusy(false)
    const out = await res.json().catch(() => ({}))
    if (!res.ok) {
      setMessage(`⚠ ${out.error ?? res.status}`)
      return null
    }
    return out
  }

  async function handleSave() {
    if (!selected) return
    const out = await api({
      action: 'save_version',
      templateKey: selected.template_key,
      subject,
      preheader,
      bodyMarkdown,
      footerNote,
      notes,
    })
    if (out) {
      setMessage(`✓ Saved as v${out.versionNumber} (now the active version${selected.live ? ' — live' : ''}).`)
      setDirty(false)
      await fetchTemplates()
      const fresh = { ...selected, active_version_id: out.versionId }
      await selectTemplate(fresh)
      setMessage(`✓ Saved as v${out.versionNumber}.`)
    }
  }

  async function handleTestSend(audience: 'parent' | 'student') {
    if (!selected) return
    if (dirty && !confirm('You have unsaved changes — the test sends the last SAVED version. Continue?')) return
    const out = await api({ action: 'test_send', templateKey: selected.template_key, audience })
    if (out) setMessage(out.ok ? `✓ Test sent to ${out.to}.` : `⚠ Test send: ${out.status}`)
  }

  async function handleLiveToggle() {
    if (!selected) return
    const goingLive = !selected.live
    if (
      !confirm(
        goingLive
          ? `Make ${selected.template_key} LIVE? Future sends use this DB copy instead of the code-rendered original. Send yourself a test first.`
          : `Take ${selected.template_key} off DB copy? The pipeline falls back to the code-rendered original.`
      )
    )
      return
    const out = await api({ action: 'set_live', templateKey: selected.template_key, live: goingLive })
    if (out) {
      setMessage(goingLive ? '✓ Live — future sends use the DB template.' : '✓ Reverted to code-rendered copy.')
      await fetchTemplates()
      setSelected({ ...selected, live: goingLive })
    }
  }

  async function handleRevert(v: VersionRow) {
    if (!selected) return
    if (!confirm(`Revert to v${v.version_number}? This creates a NEW version with that content.`)) return
    const out = await api({ action: 'revert', templateKey: selected.template_key, versionId: v.id })
    if (out) {
      await fetchTemplates()
      await selectTemplate({ ...selected, active_version_id: out.versionId })
      setMessage(`✓ Reverted — saved as v${out.versionNumber}.`)
    }
  }

  function insertVariable(name: string) {
    const el = bodyRef.current
    const token = `{${name}}`
    if (!el) {
      setBodyMarkdown((b) => b + token)
      setDirty(true)
      return
    }
    const start = el.selectionStart ?? bodyMarkdown.length
    const end = el.selectionEnd ?? start
    setBodyMarkdown(bodyMarkdown.slice(0, start) + token + bodyMarkdown.slice(end))
    setDirty(true)
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(start + token.length, start + token.length)
    })
  }

  // Minimal line diff for version history: lines added/removed vs current draft.
  function diffLines(a: string, b: string) {
    const aLines = a.split('\n')
    const bLines = b.split('\n')
    const aSet = new Set(aLines)
    const bSet = new Set(bLines)
    return {
      removed: aLines.filter((l) => l.trim() && !bSet.has(l)),
      added: bLines.filter((l) => l.trim() && !aSet.has(l)),
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 p-10">
      <div className="max-w-7xl mx-auto space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h1 className="text-2xl font-bold text-hgl-slate">Email templates</h1>
          <a href="/admin/communications" className="text-sm text-gray-500 underline hover:text-hgl-slate">
            ← Communications
          </a>
        </div>
        {error && <div className="p-3 rounded bg-red-100 text-red-700 font-semibold text-sm">{error}</div>}

        <div className="grid grid-cols-12 gap-4">
          {/* Template list */}
          <div className="col-span-3 bg-white border border-gray-200 rounded-lg overflow-hidden">
            {templates.length === 0 ? (
              <p className="p-4 text-sm text-gray-500 italic">No templates yet — run the seed.</p>
            ) : (
              <ul className="divide-y divide-gray-100 max-h-[75vh] overflow-y-auto">
                {templates.map((t) => (
                  <li key={t.template_key}>
                    <button
                      onClick={() => {
                        if (dirty && !confirm('Discard unsaved changes?')) return
                        selectTemplate(t)
                      }}
                      className={`w-full text-left px-3 py-2.5 text-sm hover:bg-gray-50 ${
                        selected?.template_key === t.template_key ? 'bg-blue-50' : ''
                      }`}
                    >
                      <span className="block font-medium text-gray-800">{t.display_name}</span>
                      <span className="text-xs text-gray-400">
                        {t.audience} · from {t.from_identity} ·{' '}
                        {t.live ? (
                          <span className="text-green-700 font-semibold">live</span>
                        ) : (
                          <span className="text-gray-400">code copy</span>
                        )}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {!selected ? (
            <div className="col-span-9 bg-white border border-gray-200 rounded-lg p-8 text-gray-500 text-sm">
              Pick a template. Saving always creates a new version — nothing is ever overwritten, and
              history shows exactly what each past send used.
            </div>
          ) : (
            <>
              {/* Editor */}
              <div className="col-span-5 bg-white border border-gray-200 rounded-lg p-4 space-y-3 text-sm">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <h2 className="font-bold text-hgl-slate">{selected.display_name}</h2>
                  <div className="flex items-center gap-2">
                    <button onClick={() => setShowHistory((s) => !s)} className="text-xs text-hgl-blue underline">
                      history ({versions.length})
                    </button>
                    <button
                      onClick={handleLiveToggle}
                      disabled={busy}
                      className={`text-xs font-bold px-3 py-1 rounded ${
                        selected.live ? 'bg-green-600 text-white' : 'bg-gray-200 text-gray-700'
                      }`}
                      title="Live = the pipeline renders this DB copy instead of the code original"
                    >
                      {selected.live ? 'LIVE' : 'code copy'}
                    </button>
                  </div>
                </div>
                {message && <p className="text-sm">{message}</p>}
                {unknownVars.length > 0 && (
                  <p className="text-xs text-red-600 font-semibold">
                    Unknown variable{unknownVars.length > 1 ? 's' : ''}: {unknownVars.map((v) => `{${v}}`).join(', ')} —
                    saving is blocked until fixed.
                  </p>
                )}

                {showHistory ? (
                  <ul className="divide-y divide-gray-100 border border-gray-200 rounded max-h-[60vh] overflow-y-auto">
                    {versions.map((v) => {
                      const isActive = v.id === selected.active_version_id
                      const diff = diffAgainst?.id === v.id ? diffLines(v.body_markdown, bodyMarkdown) : null
                      return (
                        <li key={v.id} className="p-3">
                          <div className="flex items-center justify-between">
                            <span>
                              <strong>v{v.version_number}</strong>
                              {isActive && <span className="ml-2 text-xs text-green-700 font-bold">active</span>}
                              <span className="block text-xs text-gray-400">
                                {v.created_by ?? '—'} · {new Date(v.created_at).toLocaleString()}
                                {v.notes ? ` · ${v.notes}` : ''}
                              </span>
                            </span>
                            <span className="flex gap-2 text-xs">
                              <button
                                onClick={() => setDiffAgainst(diffAgainst?.id === v.id ? null : v)}
                                className="text-hgl-blue underline"
                              >
                                diff
                              </button>
                              {!isActive && (
                                <button onClick={() => handleRevert(v)} className="text-amber-700 underline">
                                  revert to this
                                </button>
                              )}
                            </span>
                          </div>
                          {diff && (
                            <div className="mt-2 text-xs font-mono space-y-0.5 max-h-48 overflow-y-auto">
                              {diff.removed.map((l, i) => (
                                <p key={`r${i}`} className="bg-red-50 text-red-700 px-1">− {l}</p>
                              ))}
                              {diff.added.map((l, i) => (
                                <p key={`a${i}`} className="bg-green-50 text-green-700 px-1">+ {l}</p>
                              ))}
                              {diff.removed.length === 0 && diff.added.length === 0 && (
                                <p className="text-gray-400">identical to the current draft</p>
                              )}
                            </div>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                ) : (
                  <>
                    <label className="block">
                      <span className="text-xs font-semibold text-gray-600">Subject</span>
                      <input
                        value={subject}
                        onChange={(e) => {
                          setSubject(e.target.value)
                          setDirty(true)
                        }}
                        className="mt-1 w-full border rounded p-2"
                      />
                    </label>
                    <label className="block">
                      <span className="text-xs font-semibold text-gray-600">Preheader (inbox preview line)</span>
                      <input
                        value={preheader}
                        onChange={(e) => {
                          setPreheader(e.target.value)
                          setDirty(true)
                        }}
                        className="mt-1 w-full border rounded p-2"
                      />
                    </label>
                    <label className="block">
                      <span className="text-xs font-semibold text-gray-600">
                        Body — markdown: **bold**, *italic*, [link](url), [button:Label](&#123;variable&#125;), - lists,
                        &gt; testimonials
                      </span>
                      <textarea
                        ref={bodyRef}
                        value={bodyMarkdown}
                        onChange={(e) => {
                          setBodyMarkdown(e.target.value)
                          setDirty(true)
                        }}
                        rows={18}
                        className="mt-1 w-full border rounded p-2 font-mono text-xs leading-relaxed"
                      />
                    </label>
                    <label className="block">
                      <span className="text-xs font-semibold text-gray-600">
                        Footer note (optional line above the standard footer)
                      </span>
                      <input
                        value={footerNote}
                        onChange={(e) => {
                          setFooterNote(e.target.value)
                          setDirty(true)
                        }}
                        className="mt-1 w-full border rounded p-2"
                      />
                    </label>
                    <label className="block">
                      <span className="text-xs font-semibold text-gray-600">Why this change? (version notes)</span>
                      <input
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        className="mt-1 w-full border rounded p-2"
                        placeholder="e.g. softened PR3 wording"
                      />
                    </label>
                    <div className="flex items-center gap-2 flex-wrap">
                      <button
                        onClick={handleSave}
                        disabled={busy || !dirty || unknownVars.length > 0}
                        className="bg-hgl-blue text-white font-bold px-4 py-2 rounded disabled:opacity-50"
                      >
                        Save as new version
                      </button>
                      <button
                        onClick={() => handleTestSend('parent')}
                        disabled={busy}
                        className="text-sm text-hgl-blue underline disabled:opacity-50"
                      >
                        Send test to me (parent)
                      </button>
                      {selected.audience === 'both' && (
                        <button
                          onClick={() => handleTestSend('student')}
                          disabled={busy}
                          className="text-sm text-hgl-blue underline disabled:opacity-50"
                        >
                          (student)
                        </button>
                      )}
                    </div>

                    {/* Variable palette */}
                    <details className="border border-gray-200 rounded p-2">
                      <summary className="text-xs font-semibold text-gray-600 cursor-pointer">
                        Variable palette — click to insert
                      </summary>
                      <ul className="mt-2 max-h-56 overflow-y-auto space-y-1">
                        {Object.entries(VARIABLES).map(([name, def]) => (
                          <li key={name} className="flex items-baseline gap-2 text-xs">
                            <button
                              onClick={() => insertVariable(name)}
                              className="font-mono text-hgl-blue underline whitespace-nowrap"
                            >
                              {'{'}{name}{'}'}
                            </button>
                            <span className="text-gray-500">{def.description}</span>
                          </li>
                        ))}
                      </ul>
                    </details>
                  </>
                )}
              </div>

              {/* Live preview */}
              <div className="col-span-4 bg-white border border-gray-200 rounded-lg overflow-hidden flex flex-col">
                <div className="px-3 py-2 border-b flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs text-gray-400">Preview with sample data</p>
                    <p className="text-sm font-semibold text-gray-800 truncate" title={previewSubject}>
                      {previewSubject || '—'}
                    </p>
                  </div>
                  {selected.audience === 'both' && (
                    <select
                      value={previewAudience}
                      onChange={(e) => setPreviewAudience(e.target.value as 'parent' | 'student')}
                      className="border rounded p-1 text-xs"
                    >
                      <option value="parent">parent</option>
                      <option value="student">student</option>
                    </select>
                  )}
                </div>
                <iframe title="Template preview" srcDoc={previewHtml} className="flex-1 min-h-[70vh] w-full" sandbox="" />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
