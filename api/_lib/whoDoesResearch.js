// The pure half of /api/who-does-research: what Claude is asked, the
// request, and the reading of its answer. Powers "Research with Claude" on
// the company popup's "Who does it here?" section, which asks the standard
// questions ("Who handles energy procurement at this company?") of the
// public web for one company. Kept apart from the handler so it loads under
// plain Node (scripts/whoDoesResearch.test.mjs) without an API key.
//
// Each question is its own request with its own search budget. Asking them
// all in one turn let the first question spend the shared budget and the
// rest come back empty: Simon Property Group's Director of Sustainability,
// who a single search finds, was missed that way.
//
// Web search answers come back with citations, which structured output
// does not accept, so the answer is asked for as JSON in plain text and
// read defensively here: anything malformed, unsourced or nameless is
// dropped rather than shown as a finding.

// More questions than this is not a card someone reads; more people per
// question than this is a list of guesses.
export const MAX_QUESTIONS = 12;
export const MAX_PEOPLE = 4;
// Searches per question: enough for a title search, a LinkedIn search and
// the company's own leadership or sustainability pages.
export const SEARCHES_PER_QUESTION = 8;

const text = (v) => String(v ?? '').trim();

/**
 * The questions to ask: those with wording. Returns
 * [{ id, question, keywords }], keywords being the card's title keywords
 * ("energy, procurement"), passed on as job titles to search for.
 */
export function cleanQuestions(list) {
  const out = [];
  for (const q of (Array.isArray(list) ? list : [])) {
    const id = text(q?.id);
    const question = text(q?.question);
    if (!id || !question) continue;
    out.push({ id, question, keywords: text(q?.keywords) });
    if (out.length >= MAX_QUESTIONS) break;
  }
  return out;
}

export const SYSTEM_PROMPT = `You research who holds a specific responsibility at a company, for a B2B sales team that sells energy, sustainability and utility-data services. Use web search to find named people.

How to search (do all of these before concluding nobody holds the role):
- Search the company name with the job titles that usually own this responsibility, several wordings each (for sustainability, say: "Director of Sustainability", "VP Sustainability", "Head of ESG", "Chief Sustainability Officer"; for energy procurement: "Energy Manager", "Director of Energy", "Procurement"; and so on).
- Search public professional profiles, e.g. site:linkedin.com/in "<company>" "<title>". A current profile headline that names the company and the title is a valid source.
- Look at the company's own leadership, team or sustainability/ESG report pages, press releases and conference speaker pages.

Rules:
- Only name a real person you found on a page in your search results. Never infer a name from a title, never guess, never invent.
- The person must work at this company now (or its operating business when the name is shared with a parent or a fund). Leave out anyone a source shows has left the role or the company. When the only source is older than about two years, say so in note and use low confidence.
- Prefer the person who owns the responsibility day to day over the CEO, unless the company is small enough that the executive is the answer.
- Give the job title as the source states it.
- Do not give email addresses or phone numbers.
- If the searches above find nobody, return an empty people list.

Answer with ONLY one JSON object, no prose before or after it and no markdown fences:
{"people":[{"name":"...","title":"...","confidence":"high|medium|low","note":"one short sentence on why this person answers the question","sourceUrl":"https://...","sourceTitle":"..."}]}

At most ${MAX_PEOPLE} people, best first. confidence is "high" when a current source names them in this exact responsibility, "medium" when their current title clearly covers it, "low" otherwise.`;

/** The user turn: the company, what identifies it, then the question. */
export function buildUserPrompt(company, question) {
  const lines = [`Company: ${text(company?.company)}`];
  const website = text(company?.website);
  if (website) lines.push(`Website: ${website}`);
  const domains = (Array.isArray(company?.domains) ? company.domains : []).map(text).filter(Boolean);
  if (domains.length) lines.push(`Email domains: ${domains.join(', ')}`);
  lines.push('', `Question: ${question.question}`);
  if (question.keywords) lines.push(`Title words our team associates with it: ${question.keywords}`);
  return lines.join('\n');
}

/**
 * The Messages API request for one question. Web search for current
 * names; medium effort, since it is a few lookups rather than a long
 * investigation. Server-side fallback is on, so a classifier decline is
 * retried on the model Anthropic recommends rather than handed back as a
 * refusal.
 */
export function buildRequest(company, question) {
  return {
    model: 'claude-opus-5-5',
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: SYSTEM_PROMPT,
    output_config: { effort: 'medium' },
    tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: SEARCHES_PER_QUESTION }],
    messages: [{ role: 'user', content: buildUserPrompt(company, question) }],
  };
}

const CONFIDENCE = new Set(['high', 'medium', 'low']);

function readPerson(p) {
  if (!p || typeof p !== 'object') return null;
  const name = text(p.name);
  const sourceUrl = text(p.sourceUrl || p.url);
  // A finding has to be checkable: a name and the page it came from.
  if (!name || !/^https?:\/\//i.test(sourceUrl)) return null;
  return {
    name,
    title: text(p.title),
    confidence: CONFIDENCE.has(p.confidence) ? p.confidence : 'low',
    note: text(p.note),
    sourceUrl,
    sourceTitle: text(p.sourceTitle) || sourceUrl,
  };
}

/**
 * The people in one question's answer, deduplicated, at most MAX_PEOPLE.
 * Returns null when the text holds no readable JSON object with a people
 * list, which the handler reports as that question failing.
 */
export function readPeople(raw) {
  const s = String(raw || '');
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let parsed;
  try { parsed = JSON.parse(s.slice(start, end + 1)); } catch { return null; }
  if (!parsed || !Array.isArray(parsed.people)) return null;
  const out = [];
  const seen = new Set();
  for (const p of parsed.people) {
    const person = readPerson(p);
    if (!person || seen.has(person.name.toLowerCase())) continue;
    seen.add(person.name.toLowerCase());
    out.push(person);
    if (out.length >= MAX_PEOPLE) break;
  }
  return out;
}
