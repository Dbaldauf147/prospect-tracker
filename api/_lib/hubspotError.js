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

// HubSpot answers a scope failure with every scope that would have
// satisfied the call, and the order it lists them in is not advice — the
// sensitive-data variants tend to come first. Replayed verbatim, the
// message told the user to grant the most privileged scope on the list:
//
//   needs the crm.objects.companies.highly_sensitive.write.v2 or
//   crm.objects.companies.sensitive.write.v2 or crm.objects.companies.write
//   or crm.schemas.companies.write scopes
//
// — four alternatives read as a set of requirements, led by one that a
// private app can't even be granted until the portal is enabled for
// sensitive data. Rank them so the ordinary object-write scope is the one
// we name, and demote the rest to alternatives:
//
//   0  crm.objects.companies.write            — the one to grant
//   1  crm.schemas.companies.write            — edits property definitions,
//                                               not the record
//   2  …sensitive.write.v2                    — gated on a portal setting
//   3  …highly_sensitive.write.v2             — gated, and broader still
function scopeRank(name) {
  if (/(^|\.)highly_sensitive(\.|$)/i.test(name)) return 3;
  if (/(^|\.)sensitive(\.|$)/i.test(name)) return 2;
  if (/^crm\.schemas\./i.test(name)) return 1;
  return 0;
}

// "a", "a or b", "a, b, or c".
function orList(names) {
  if (names.length <= 1) return names.join('');
  if (names.length === 2) return names.join(' or ');
  return `${names.slice(0, -1).join(', ')}, or ${names[names.length - 1]}`;
}

// Least-privilege first, preserving HubSpot's order within a rank.
function rankScopes(scopes) {
  return scopes
    .map((name, i) => ({ name, i }))
    .sort((a, b) => scopeRank(a.name) - scopeRank(b.name) || a.i - b.i)
    .map(e => e.name);
}

// True when the failure is HubSpot refusing the call for lack of a scope,
// rather than rejecting the data we sent.
function isMissingScopes(body) {
  if (String(body?.category || '') === 'MISSING_SCOPES') return true;
  return SCOPE_BOILERPLATE.test(String(body?.message || ''));
}

// A property-validation 400 buries its detail one level deeper than the
// scope errors above: the top-level `message` is the sentence "Property
// values were not valid: " followed by a JSON array of per-property
// entries, each with its own `message`, the property's internal `name`,
// and an `error` code. Read as raw text, the useful part — which value
// was rejected, on which property — sits behind an allowed-options list
// long enough to blow any truncation budget.
//
//   {"status":"error","message":"Property values were not valid:
//    [{\"isValid\":false,\"message\":\"NAM Only was not one of the allowed
//    options: [Procurement, Hide, …]\",\"error\":\"INVALID_OPTION\",
//    \"name\":\"dans_tags\"}]", …}
//
// Returns [{ property, value, message }] — `value` is the rejected value
// when the entry is an allowed-options failure, '' otherwise.
export function invalidPropertyValues(bodyText) {
  const raw = String(bodyText || '');
  let message = raw;
  try {
    const body = JSON.parse(raw);
    if (body && typeof body.message === 'string') message = body.message;
  } catch { /* not the JSON envelope — scan the raw text below */ }

  const out = [];
  const push = (property, entryMessage) => {
    const m = /^\s*(.+?)\s+was not one of the allowed options/i.exec(entryMessage || '');
    out.push({
      property: String(property || '').trim(),
      value: m ? m[1].trim() : '',
      message: String(entryMessage || '').trim(),
    });
  };

  // Preferred path: the array inside the sentence is real JSON.
  const start = message.indexOf('[');
  if (start >= 0) {
    try {
      const entries = JSON.parse(message.slice(start));
      if (Array.isArray(entries)) {
        for (const e of entries) {
          if (e && typeof e === 'object' && 'message' in e) push(e.name, e.message);
        }
        if (out.length) return out;
      }
    } catch { /* nested array isn't parseable on its own — fall through */ }
  }

  // Fallback: pull the pairs out of the escaped text. Covers a body that
  // was truncated upstream, or a shape we haven't seen.
  const re = /\\?"message\\?":\\?"(.*?)\\?"\s*,\s*\\?"error\\?":\\?"[^"\\]*\\?"\s*,\s*\\?"name\\?":\\?"([^"\\]*)\\?"/g;
  let hit;
  while ((hit = re.exec(raw)) !== null) push(hit[2], hit[1]);
  if (out.length) return out;

  // Last resort: an allowed-options complaint with no property name
  // attached at all. The value is still worth naming.
  const lone = /([^"\\:[]+?)\s+was not one of the allowed options/i.exec(raw);
  if (lone) out.push({ property: '', value: lone[1].trim(), message: lone[0].trim() });
  return out;
}

// The values a specific property rejected as not-an-allowed-option.
// Entries with no property name count, since some error shapes omit it
// and the caller knows which property it wrote.
export function rejectedOptionValues(bodyText, property) {
  const want = String(property || '').toLowerCase();
  const out = [];
  for (const e of invalidPropertyValues(bodyText)) {
    if (!e.value) continue;
    if (want && e.property && e.property.toLowerCase() !== want) continue;
    if (!out.includes(e.value)) out.push(e.value);
  }
  return out;
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
    const [preferred, ...alternatives] = rankScopes(requiredScopes(body));
    let lead = preferred
      ? `The HubSpot private app needs the ${preferred} scope.`
      : 'The HubSpot private app is missing a required scope.';
    if (alternatives.length) {
      lead = `The HubSpot private app needs the ${preferred} scope `
        + `(HubSpot also accepts ${orList(alternatives)}).`;
    }
    // The instruction is the half the user has to act on, so it's held out
    // of the truncation budget: an over-long alternatives list loses its
    // own tail rather than the sentence saying where to go.
    const fix = 'Add it in HubSpot under Settings → Integrations → Private Apps → Auth, then save the app.';
    const budget = 420 - fix.length - 1;
    // Rather than sever the list mid-scope-name, drop it — the scope we
    // recommend is the only one the user needs.
    if (lead.length > budget && preferred) lead = `The HubSpot private app needs the ${preferred} scope.`;
    return `${truncate(lead, budget)} ${fix}`;
  }

  // Property-validation failures: say which value on which property was
  // refused, rather than replaying the envelope and the whole allowed-
  // options list.
  const invalid = invalidPropertyValues(raw).filter(e => e.value || e.message);
  if (invalid.length) {
    const sentences = invalid.map((e) => {
      const on = e.property ? ` on ${e.property}` : '';
      return e.value
        ? `HubSpot doesn't allow the value “${e.value}”${on}.`
        : `HubSpot rejected${on ? ` ${e.property}` : ' a value'}: ${e.message}`;
    });
    return truncate([...new Set(sentences)].join(' '), 420);
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
