// The pure half of /api/find-person: what Claude is asked, and the check
// on what it hands back. Kept apart from the handler so it loads under
// plain Node (scripts/findPerson.test.mjs) without an API key or a request.
//
// Powers the "Who is it?" column on the Events tab's LinkedIn lookup list:
// a row is a job title at a company with no name yet, and this finds the
// person who holds that title there.

export const SYSTEM_PROMPT = `You identify the person who currently holds a given job title at a given company, for a sales team building an event attendee list.

Use web search: LinkedIn profiles, the company's team / leadership pages, press releases, conference speaker pages. Prefer the person who holds the title now; if the title is held by several people, pick the one whose title matches most closely. A title that is close but not identical (e.g. "VP, ESG" vs "Vice President, Sustainability") is fine when it is clearly the same role.

Do not guess. If nothing you find ties a named person to this role at this company, return an empty name and say so in reason.

When you are done searching, reply with ONLY a single JSON object (no prose, no markdown fences):
{"name": string, "title": string, "linkedinUrl": string, "confidence": "high" | "medium" | "low", "reason": string, "sources": [{"title": string, "url": string}]}
- name: the person's full name, or "" when not found.
- title: their title as the source states it, or "".
- linkedinUrl: their LinkedIn profile URL if you found one, else "".
- confidence: "high" when a current source names them in this role, "medium" when the source is older or the title only roughly matches, "low" otherwise.
- reason: one short sentence a salesperson can check at a glance. Use plain hyphens or commas, never em dashes.
- sources: up to 3 pages you relied on.`;

/** The user turn: the row's title and company. */
export function buildUserPrompt(title, company) {
  return `Title: ${String(title || '').trim()}\nCompany: ${String(company || '').trim()}\n\nWho holds this role? Return the JSON object as specified.`;
}

/**
 * The Messages API request. Web search is the point here, so the answer
 * is read out of the text rather than through structured output (which
 * doesn't accept the citations search results come back with). Low effort
 * keeps a row's lookup quick; server-side fallback is on so a classifier
 * decline is retried rather than handed back as a refusal.
 */
export function buildRequest(title, company) {
  return {
    model: 'claude-opus-5-5',
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: SYSTEM_PROMPT,
    output_config: { effort: 'low' },
    tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 5 }],
    messages: [{ role: 'user', content: buildUserPrompt(title, company) }],
  };
}

const isHttpUrl = (u) => /^https?:\/\//i.test(String(u || '').trim());
// Em dashes are not allowed anywhere the app shows text, so model output is
// normalised on the way in rather than trusted to follow the prompt.
const clean = (s) => String(s ?? '').replace(/\s*\u2014\s*/g, ' - ').trim(); // em-dash-ok: strips em dashes out of model-written text

/**
 * The answer, checked on our side: the last JSON object in the text, with
 * every field coerced to the shape the column renders. A non-LinkedIn URL
 * in linkedinUrl is dropped rather than shown as a profile link.
 */
export function readAnswer(text) {
  const s = String(text || '');
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let parsed;
  try { parsed = JSON.parse(s.slice(start, end + 1)); } catch { return null; }
  if (!parsed || typeof parsed !== 'object') return null;
  const linkedinUrl = String(parsed.linkedinUrl || '').trim();
  const sources = Array.isArray(parsed.sources) ? parsed.sources
    .filter(o => o && isHttpUrl(o.url))
    .slice(0, 3)
    .map(o => ({ title: clean(o.title || o.url), url: String(o.url).trim() })) : [];
  return {
    name: clean(parsed.name),
    title: clean(parsed.title),
    linkedinUrl: isHttpUrl(linkedinUrl) && /linkedin\.com\//i.test(linkedinUrl) ? linkedinUrl : '',
    confidence: ['high', 'medium', 'low'].includes(parsed.confidence) ? parsed.confidence : 'low',
    reason: clean(parsed.reason),
    sources,
  };
}
