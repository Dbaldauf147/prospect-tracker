// The pure half of /api/suggest-vertical: what Claude is asked, the shape
// its answer must take, and the check that the answer is one of the user's
// own verticals. Kept apart from the handler so it loads under plain Node
// (scripts/suggestVertical.test.mjs) without an API key or a request.

// The facts the company popup holds that say what a company does. Every
// one is optional except the name; a blank is left out of the prompt
// rather than sent as an empty line the model has to read past.
const CONTEXT_FIELDS = [
  ['website', 'Website'],
  ['bfoCompanyName', 'Legal / BFO name'],
  ['aliases', 'Also known as'],
  ['peOwner', 'Owner / parent company'],
  ['type', 'Account type in our CRM'],
];

/** The verticals to choose from: trimmed, de-duplicated, blanks dropped. */
export function cleanVerticals(list) {
  const out = [];
  const seen = new Set();
  for (const v of (Array.isArray(list) ? list : [])) {
    const s = String(v ?? '').trim();
    if (!s || seen.has(s.toLowerCase())) continue;
    seen.add(s.toLowerCase());
    out.push(s);
  }
  return out;
}

export const SYSTEM_PROMPT = `You classify companies into one industry vertical from a fixed list supplied by a sales team.

Pick the vertical that best describes how the company itself makes its money: what it produces, sells or operates. A company owned by a private-equity firm belongs in its own industry, not in the owner's; the owner is only context for telling apart companies with similar names. Use the website domain and any legal or former names to identify the company.

Choose only from the list. If none of the verticals is a reasonable fit, or you cannot tell which company this is, return an empty string for vertical rather than guessing, and say why in reason.

reason is one short sentence a salesperson can check at a glance: what the company does, in plain words. confidence is "high" when you know the company and the fit is clear, "medium" when the company is known but sits between two verticals, "low" otherwise.`;

/** The user turn: the company and what we know about it, then the list. */
export function buildUserPrompt(company, verticals) {
  const lines = [`Company: ${String(company.company || '').trim()}`];
  for (const [key, label] of CONTEXT_FIELDS) {
    const v = String(company?.[key] ?? '').trim();
    if (v) lines.push(`${label}: ${v}`);
  }
  return `${lines.join('\n')}\n\nVerticals:\n${verticals.map(v => `- ${v}`).join('\n')}`;
}

/**
 * The JSON schema the answer is held to. `vertical` is an enum of the list
 * itself (plus "" for no fit), so the model cannot hand back a vertical the
 * dropdown doesn't have.
 */
export function outputSchema(verticals) {
  return {
    type: 'object',
    properties: {
      vertical: { type: 'string', enum: [...verticals, ''] },
      confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
      reason: { type: 'string' },
    },
    required: ['vertical', 'confidence', 'reason'],
    additionalProperties: false,
  };
}

/**
 * The answer, checked against the list once more on our side: the schema
 * already constrains it, but a fallback model or a future change to how
 * the request is built must not be able to put a stray value in the field.
 * Matched case-insensitively and returned in the list's own spelling.
 */
export function readSuggestion(text, verticals) {
  let parsed;
  try { parsed = JSON.parse(String(text || '')); } catch { return null; }
  if (!parsed || typeof parsed !== 'object') return null;
  const want = String(parsed.vertical || '').trim().toLowerCase();
  const vertical = want ? (verticals.find(v => v.toLowerCase() === want) || '') : '';
  const confidence = ['high', 'medium', 'low'].includes(parsed.confidence) ? parsed.confidence : 'low';
  return { vertical, confidence, reason: String(parsed.reason || '').trim() };
}

/**
 * The Messages API request. Classification from what the model knows plus
 * the popup's own facts (website, legal name, owner); no web search, since
 * its results come back with citations, which structured output does not
 * accept, and the website domain is usually what tells two same-named
 * companies apart. Low effort for the same reason: it is a pick from a
 * list. Server-side fallback is on, so a classifier decline is retried on
 * the model Anthropic recommends rather than handed back as a refusal.
 */
export function buildRequest(company, verticals) {
  return {
    model: 'claude-opus-5-5',
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: SYSTEM_PROMPT,
    output_config: {
      effort: 'low',
      format: { type: 'json_schema', schema: outputSchema(verticals) },
    },
    messages: [{ role: 'user', content: buildUserPrompt(company, verticals) }],
  };
}
