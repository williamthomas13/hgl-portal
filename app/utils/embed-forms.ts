// PL-473 / PL-477: the embeddable public forms — ONE builder for the three
// Squarespace snippets (/embed/inquire.js, /embed/partner.js,
// /embed/compass.js). Same pattern as /embed/upcoming-classes.js (PL-385):
// the host page pastes ONE code block, the script renders the form inline
// (inline styles only — nothing inherited from Squarespace CSS, no iframe,
// no scrollbars), posts JSON to the portal, shows the thank-you in place;
// a <noscript> link to the full page is the fallback. Source tagging: the
// mount div's data-source (default: the host page path) and data-interest.
// Spam: the same honeypot every portal form uses + the API's per-email
// throttle. Works at 375px (every field is width:100%).

export type EmbedField =
  | { name: string; label: string; type: 'text' | 'email' | 'tel' | 'textarea'; required?: boolean; placeholder?: string }
  | { name: string; label: string; type: 'select'; required?: boolean; options: string[]; placeholder?: string }
  | { name: string; label: string; type: 'phone'; required?: boolean }

export type EmbedSpec = {
  /** The mount element id the snippet creates. */
  mountId: string
  /** POST target path on the portal. */
  apiPath: string
  /** The full-page fallback path (noscript link + "open the full form"). */
  pagePath: string
  heading: string
  intro: string
  fields: EmbedField[]
  submitLabel: string
  thankYou: string
  /** Small print under the button (consent text for Compass). */
  finePrint: string
  /** data-interest pre-selects this field's value when present. */
  interestField?: string
}

/** Common dial codes for the phone field — the country the family is in. */
export const DIAL_CODES: [string, string][] = [
  ['+1', 'US / CA'], ['+52', 'MX'], ['+39', 'IT'], ['+49', 'DE'], ['+34', 'ES'], ['+351', 'PT'], ['+33', 'FR'],
  ['+44', 'UK'], ['+43', 'AT'], ['+41', 'CH'], ['+46', 'SE'], ['+31', 'NL'], ['+32', 'BE'], ['+45', 'DK'], ['+47', 'NO'],
  ['+966', 'SA'], ['+971', 'AE'], ['+974', 'QA'], ['+212', 'MA'], ['+20', 'EG'], ['+27', 'ZA'], ['+55', 'BR'], ['+507', 'PA'],
  ['+57', 'CO'], ['+56', 'CL'], ['+54', 'AR'], ['+86', 'CN'], ['+81', 'JP'], ['+82', 'KR'], ['+65', 'SG'], ['+91', 'IN'],
  ['+61', 'AU'], ['+64', 'NZ'], ['+90', 'TR'], ['+30', 'GR'], ['+36', 'HU'], ['+48', 'PL'], ['+420', 'CZ'],
]

export const INTEREST_OPTIONS = [
  'SAT',
  'ACT',
  'AP/IB',
  'University applications',
  'GRE/GMAT',
  'Academic support',
  'School partnership',
  'Other',
]

/** The self-contained JS the snippet loads. `base` = the portal origin the
 *  form posts to (the API answers CORS for any origin — it only creates a
 *  pipeline row / subscriber, nothing to gain). */
export function embedScript(spec: EmbedSpec, base: string): string {
  return `(function(){
  var el = document.getElementById(${JSON.stringify(spec.mountId)});
  if (!el) return;
  var spec = ${JSON.stringify({ ...spec, base, dialCodes: DIAL_CODES })};
  var source = el.getAttribute('data-source') || ('sqsp:' + location.pathname);
  var interest = el.getAttribute('data-interest') || '';
  // PL-488: ONE required set everywhere (the spec); the per-page attribute switch is retired — nothing can loosen or change the set.
  var S = {
    wrap: 'font-family:inherit;color:#334155;max-width:640px;width:100%;box-sizing:border-box',
    h: 'font-size:22px;font-weight:700;margin:0 0 6px;color:#1e293b',
    p: 'font-size:14px;color:#64748b;margin:0 0 16px',
    row: 'margin:0 0 12px',
    label: 'display:block;font-size:13px;font-weight:600;margin:0 0 4px;color:#334155',
    input: 'display:block;width:100%;box-sizing:border-box;border:1px solid #cbd5e1;border-radius:6px;padding:10px 12px;font-size:15px;font-family:inherit;background:#fff;color:#1e293b',
    btn: 'display:block;width:100%;box-sizing:border-box;background:#00AEEE;color:#fff;font-weight:700;font-size:16px;padding:12px 20px;border:0;border-radius:6px;cursor:pointer;font-family:inherit',
    fine: 'font-size:12px;color:#94a3b8;margin:10px 0 0;text-align:center',
    err: 'background:#fef2f2;border:1px solid #fecaca;color:#b91c1c;border-radius:6px;padding:10px 12px;font-size:14px;margin:0 0 12px',
    ok: 'background:#f0fdf4;border:1px solid #bbf7d0;color:#166534;border-radius:6px;padding:14px 16px;font-size:15px'
  };
  function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function field(f){
    var req = !!f.required;
    var lab = '<label style="' + S.label + '" for="hgl-f-' + f.name + '">' + esc(f.label) + (req ? ' <span style="color:#ef4444">*</span>' : '') + '</label>';
    if (f.type === 'textarea') return '<div style="' + S.row + '">' + lab + '<textarea style="' + S.input + ';min-height:90px" id="hgl-f-' + f.name + '" name="' + f.name + '" ' + (req ? 'required' : '') + ' placeholder="' + esc(f.placeholder || '') + '"></textarea></div>';
    if (f.type === 'select') {
      var opts = '<option value="">' + esc(f.placeholder || 'Pick one…') + '</option>' + f.options.map(function(o){ return '<option value="' + esc(o) + '"' + (spec.interestField === f.name && o === interest ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join('');
      return '<div style="' + S.row + '">' + lab + '<select style="' + S.input + '" id="hgl-f-' + f.name + '" name="' + f.name + '" ' + (req ? 'required' : '') + '>' + opts + '</select></div>';
    }
    if (f.type === 'phone') {
      var codes = spec.dialCodes.map(function(c){ return '<option value="' + c[0] + '">' + c[0] + ' ' + esc(c[1]) + '</option>'; }).join('');
      return '<div style="' + S.row + '">' + lab + '<div style="display:flex;gap:8px"><select style="' + S.input + ';width:128px;flex:none" name="' + f.name + 'Country" aria-label="Country code">' + codes + '</select><input style="' + S.input + '" type="tel" id="hgl-f-' + f.name + '" name="' + f.name + '" ' + (req ? 'required' : '') + ' placeholder="Phone or WhatsApp"></div></div>';
    }
    return '<div style="' + S.row + '">' + lab + '<input style="' + S.input + '" type="' + f.type + '" id="hgl-f-' + f.name + '" name="' + f.name + '" ' + (req ? 'required' : '') + ' placeholder="' + esc(f.placeholder || '') + '"></div>';
  }
  el.innerHTML = '<div style="' + S.wrap + '"><h3 style="' + S.h + '">' + esc(spec.heading) + '</h3><p style="' + S.p + '">' + esc(spec.intro) + '</p>' +
    '<form novalidate>' + spec.fields.map(field).join('') +
    '<div style="position:absolute;left:-9999px" aria-hidden="true"><label>Company<input name="company" tabindex="-1" autocomplete="off"></label></div>' +
    '<div class="hgl-err" style="' + S.err + ';display:none"></div>' +
    '<button type="submit" style="' + S.btn + '">' + esc(spec.submitLabel) + '</button>' +
    '<p style="' + S.fine + '">' + esc(spec.finePrint) + ' <a href="' + esc(spec.base + spec.pagePath) + '" style="color:#94a3b8">Open the full form</a></p></form></div>';
  var form = el.querySelector('form'), err = el.querySelector('.hgl-err'), btn = el.querySelector('button');
  form.addEventListener('submit', function(ev){
    ev.preventDefault();
    err.style.display = 'none';
    var data = { source: source, interestTag: interest || null, company: '' };
    var missing = [];
    spec.fields.forEach(function(f){
      var input = form.querySelector('[name="' + f.name + '"]');
      var v = input ? input.value.trim() : '';
      data[f.name] = v;
      if (f.type === 'phone') { var cc = form.querySelector('[name="' + f.name + 'Country"]'); data[f.name + 'Country'] = cc ? cc.value : ''; }
      if (f.required && !v) missing.push(f.label);
    });
    var hp = form.querySelector('[name="company"]'); data.company = hp ? hp.value : '';
    if (missing.length) { err.textContent = 'Please fill in: ' + missing.join(', ') + '.'; err.style.display = 'block'; return; }
    btn.disabled = true; btn.textContent = 'Sending…';
    fetch(spec.base + spec.apiPath, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
      .then(function(r){ return r.json().catch(function(){ return {}; }).then(function(j){ return { ok: r.ok, j: j }; }); })
      .then(function(res){
        if (!res.ok) { err.textContent = res.j.error || 'That did not go through — please try again, or email us.'; err.style.display = 'block'; btn.disabled = false; btn.textContent = spec.submitLabel; return; }
        el.innerHTML = '<div style="' + S.wrap + '"><div style="' + S.ok + '">' + esc(spec.thankYou) + '</div></div>';
      })
      .catch(function(){ err.textContent = 'That did not go through — please try again, or email us.'; err.style.display = 'block'; btn.disabled = false; btn.textContent = spec.submitLabel; });
  });
})();`
}

export function embedResponseHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/javascript; charset=utf-8',
    'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
    'Access-Control-Allow-Origin': '*',
  }
}

/** CORS for the public form APIs — the embeds post from Squarespace. */
export const FORM_CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export const INQUIRE_SPEC: EmbedSpec = {
  mountId: 'hgl-inquire',
  apiPath: '/api/inquiry',
  pagePath: '/inquire',
  heading: "Let's get started",
  intro: "Tell us a little about what you're looking for and we'll usually be able to reach out the same day. We'll get the rest of the details later when we connect!",
  fields: [
    // PL-488 (Scarlett, Sep 21): every field required EXCEPT "Anything else".
    { name: 'parentFirst', label: 'First name', type: 'text', required: true },
    { name: 'parentLast', label: 'Last name', type: 'text', required: true },
    { name: 'parentEmail', label: 'Email', type: 'email', required: true },
    { name: 'parentPhone', label: 'Phone / WhatsApp', type: 'phone', required: true },
    { name: 'connectPref', label: 'How do you prefer to connect?', type: 'select', required: true, options: ['Phone call', 'Text', 'Email', 'WhatsApp'], placeholder: 'Pick one…' },
    { name: 'studentFirst', label: 'Student first name', type: 'text', required: true },
    { name: 'studentLast', label: 'Student last name', type: 'text', required: true },
    { name: 'studentSchool', label: "Student's school", type: 'text', required: true, placeholder: 'Homeschooled or graduated? Just say so' },
    { name: 'subject', label: 'What would you like help with?', type: 'select', required: true, options: INTEREST_OPTIONS, placeholder: 'Pick one…' },
    { name: 'other', label: 'Anything else we should know?', type: 'textarea', placeholder: 'Grade, recent scores, goals, timing — whatever is useful' },
  ],
  submitLabel: 'Get in touch',
  thankYou: "Got it — thank you! We'll be in touch soon, usually the same day.",
  finePrint: 'Straight to our team — never shared, never a mailing list.',
  interestField: 'subject',
}

export const PARTNER_SPEC: EmbedSpec = {
  mountId: 'hgl-partner',
  apiPath: '/api/partner',
  pagePath: '/partner',
  heading: 'Bring Higher Ground to your school',
  intro: 'Tell us about your students and how you would like to run test prep — we will come back with options.',
  fields: [
    { name: 'contactName', label: 'Your name', type: 'text', required: true },
    { name: 'role', label: 'Your role', type: 'text', placeholder: 'e.g. College counselor, Head of Upper School' },
    { name: 'school', label: 'School', type: 'text', required: true },
    { name: 'location', label: 'Country / city', type: 'text' },
    { name: 'email', label: 'Email', type: 'email', required: true },
    { name: 'phone', label: 'Phone / WhatsApp', type: 'phone' },
    { name: 'tests', label: 'Which tests?', type: 'select', options: ['SAT', 'ACT', 'SAT + ACT', 'PSAT', 'Other'], placeholder: 'Pick one…' },
    { name: 'cohortSize', label: 'Roughly how many students?', type: 'text', placeholder: 'e.g. 10–15' },
    { name: 'format', label: 'How would you like to run it?', type: 'select', options: ['On campus', 'Online', 'School-sponsored (the school covers the fee)', 'Not sure yet'], placeholder: 'Pick one…' },
    { name: 'timing', label: 'When?', type: 'text', placeholder: 'e.g. this spring, before the March SAT' },
    { name: 'message', label: 'Anything else?', type: 'textarea' },
  ],
  submitLabel: 'Get started with Higher Ground',
  thankYou: "Thank you — we'll be in touch within a business day to set up a call.",
  finePrint: 'School partnerships only — families, use the inquiry form instead.',
}

export const COMPASS_SPEC: EmbedSpec = {
  mountId: 'hgl-compass',
  apiPath: '/api/compass',
  pagePath: '/compass',
  heading: 'College Prep Compass',
  intro: 'Occasional emails on test dates, deadlines and how to prepare — for parents and students.',
  fields: [
    { name: 'email', label: 'Email', type: 'email', required: true },
    { name: 'firstName', label: 'First name', type: 'text' },
    { name: 'role', label: 'I am a…', type: 'select', options: ['Parent', 'Student'], placeholder: 'Pick one…' },
    { name: 'gradYear', label: 'Graduation year (optional)', type: 'text', placeholder: 'e.g. 2028' },
  ],
  submitLabel: 'Sign me up',
  thankYou: "You're in — watch for the College Prep Compass in your inbox.",
  finePrint: 'By signing up you agree to receive College Prep Compass emails from Higher Ground Learning. Unsubscribe any time with one click.',
}
