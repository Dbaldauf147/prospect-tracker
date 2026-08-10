// Turn a HubSpot error response body into one readable sentence.
//
// Every company write path used to surface failures by slicing the raw
// response body to 300 characters. HubSpot's bodies lead with metadata
// (status, boilerplate message, correlationId) and bury the useful part —
// the list of scopes the call actually needs — in a nested `errors[]`
// entry, so the slice reliably cut the answer off mid-sentence. A missing-
// scope 403 came out as:
//
//   {"status":"error","message":"This app hasn't been granted all required
//   scopes …","correlationId":"019fec2f…","errors":[{"message":"One or more
//   of the following scopes are required:
//
// — everything after the colon, i.e. the scope names, lost to the cut.
//
// This extracts the messages instead of truncating the envelope, and gives
// missing-scope failures a sentence that says what to go fix.

const MAX_LEN = 300;

// HubSpot's boilerplate top-level message on a scope failure. It carries no
// information the extracted scope list doesn't, and it's long enough to
// crowd out the part that does.
const SCOPE_BOILERPLATE = /^This app hasn't been granted all required scopes/i;

function truncate(text, max = MAX_LEN) {
  const s = String(text || '').trim();
  if (s.length <= max) return s;
  // Cut on a word boundary so the tail reads as an abridged sentence
  // rather than a severed one.
  const cut = s.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

// Pull scope names out of wherever this particular error shape put them:
// `context.requiredScopes`, or the "One or more of the following scopes are
// required: a, b." sentence in a nested error.
function requiredScopes(body) {
  const out = [];
  const push = (v) => {
    const name = String(v || '').trim().replace(/[.,]+$/, '');
    if (name && !out.includes(name)) out.push(name);
  };
  const fromContext = (ctx) => {
    const list = ctx?.requiredScopes || ctx?.requiredGranularScopes;
    if (Array.isArray(list)) list.forEach(push);
  };
  fromContext(body?.context);
  const entries = Array.isArray(body?.errors) ? body.errors : [];
  for (const e of entries) {
    fromContext(e?.context);
    // Scope names contain dots ("crm.objects.companies.write"), so the list
    // runs to the end of the line rather than to the first period; `push`
    // strips the sentence's trailing period off the last name.
    const m = /scopes are required:\s*([^\n]*)/i.exec(String(e?.message || ''));
    if (m) m[1].split(/[,;]|\s+or\s+/i).forEach(push);
  }
  return out;
}

// True when the failure is HubSpot refusing the call for lack of a scope,
// rather than rejecting the data we sent.
function isMissingScopes(body) {
  if (String(body?.category || '') === 'MISSING_SCOPES') return true;
  return SCOPE_BOILERPLATE.test(String(body?.message || ''));
}

// `status` is the HTTP status, `bodyText` the raw response body. Returns a
// short sentence suitable for showing to the user; falls back to a trimmed
// slice of the body when it isn't the JSON envelope we know.
export function describeHubSpotError(status, bodyText) {
  const raw = String(bodyText || '').trim();
  let body = null;
  try { body = JSON.parse(raw); } catch { /* not JSON — fall through */ }
  if (!body || typeof body !== 'object') {
    return truncate(raw) || `HubSpot returned HTTP ${status || 0} with no details`;
  }

  if (isMissingScopes(body)) {
    const scopes = requiredScopes(body);
    const needs = scopes.length
      ? `needs the ${scopes.join(' or ')} scope${scopes.length > 1 ? 's' : ''}`
      : 'is missing a required scope';
    return truncate(
      `The HubSpot private app ${needs}. Add it in HubSpot under Settings → Integrations → Private Apps → Auth, then save the app.`,
      420,
    );
  }

  const parts = [];
  const top = String(body.message || '').trim();
  if (top) parts.push(top);
  for (const e of Array.isArray(body.errors) ? body.errors : []) {
    const m = String(e?.message || '').trim();
    if (m && !parts.includes(m)) parts.push(m);
  }
  return truncate(parts.join(' ')) || `HubSpot returned HTTP ${status || 0}`;
}

// Read a failed Response and describe it, swallowing body-read errors the
// same way the call sites did before.
export async function describeHubSpotResponse(res) {
  let text = '';
  try { text = await res.text(); } catch { /* body unreadable */ }
  return describeHubSpotError(res?.status, text);
}
