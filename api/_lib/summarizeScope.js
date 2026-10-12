// The pure half of /api/summarize-notes with kind 'scope': what Claude is
// asked, the shape its answer must take, and the check that turns it back
// into one line per opp. Kept apart from the handler so it loads under
// plain Node (scripts/summarizeScope.test.mjs) without an API key.
//
// Powers the Scope column on the New Opps subtab and the Scope column of
// the New Opps email (downloaded draft and scheduled send alike), which
// show a long list of services as one short line.
//
// The batch size and the item cleaning are the notes summary's, so the two
// kinds share one request shape on the client.
import { cleanBullet } from './summarizeNotes.js';

export { MAX_ITEMS, cleanItems } from './summarizeNotes.js';

// A summary is a table cell, not a sentence: past this it is cut.
export const MAX_SUMMARY_CHARS = 140;

export const SYSTEM_PROMPT = `You summarize the scope of each sales opportunity, so a manager scanning a table of deals can see what each one is for at a glance.

Each opp's scope is a comma-separated list of the services being sold (energy and sustainability services: procurement, utility bill management, GHG inventories, reporting frameworks such as CDP, CSRD or GRESB, efficiency projects, and so on). Some service names contain commas themselves.

For each opp, write one short line:
- About 4 to 14 words, no trailing period.
- Group related services into what they amount to (for example "GHG inventory and CDP, CSRD reporting"), and name the main ones; drop minor add-ons when the line would run long.
- Use only the services listed. Do not invent services, sites, amounts or dates.
- Do not use em dashes; use a comma, a colon or a hyphen instead.

Return one entry per opp, using the id it was given.`;

/** The user turn: every opp's scope, each under its id. */
export function buildUserPrompt(items) {
  return items
    .map(it => `<opp id="${it.id.replace(/"/g, '')}">\n${it.text}\n</opp>`)
    .join('\n\n');
}

/** The JSON schema the answer is held to. */
export function outputSchema() {
  return {
    type: 'object',
    properties: {
      summaries: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            summary: { type: 'string' },
          },
          required: ['id', 'summary'],
          additionalProperties: false,
        },
      },
    },
    required: ['summaries'],
    additionalProperties: false,
  };
}

// The line as the cell shows it: tidied the way a notes bullet is (marker
// dropped, em dashes swapped for hyphens so the site rule holds however
// the model words it), trailing period dropped, and capped.
function cleanSummary(s) {
  const line = cleanBullet(s).replace(/\.$/, '');
  return line.length > MAX_SUMMARY_CHARS ? `${line.slice(0, MAX_SUMMARY_CHARS - 3).trimEnd()}...` : line;
}

/**
 * The answer as { [id]: [line] }: one line per opp, in a one-item list so
 * the client caches it the way it caches notes bullets. Held to the ids
 * that were asked about; an id with no usable line is left out. Null when
 * the text isn't the JSON asked for.
 */
export function readScopeSummaries(text, items) {
  let parsed;
  try { parsed = JSON.parse(String(text || '')); } catch { return null; }
  if (!parsed || !Array.isArray(parsed.summaries)) return null;
  const asked = new Set(items.map(it => it.id));
  const out = {};
  for (const s of parsed.summaries) {
    const id = String(s?.id ?? '');
    if (!asked.has(id) || out[id]) continue;
    const line = cleanSummary(s?.summary);
    if (line) out[id] = [line];
  }
  return out;
}

/**
 * The Messages API request: a light rewrite, so low effort; structured
 * output keeps the answer machine-readable; server-side fallback retries a
 * classifier decline on the model Anthropic recommends.
 */
export function buildScopeRequest(items) {
  return {
    model: 'claude-opus-5-5',
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: SYSTEM_PROMPT,
    output_config: {
      effort: 'low',
      format: { type: 'json_schema', schema: outputSchema() },
    },
    messages: [{ role: 'user', content: buildUserPrompt(items) }],
  };
}

/**
 * Ask Claude for one batch and read the answer back: { [id]: [line] }, or
 * null when it declined or the answer can't be read. Shared by
 * /api/summarize-notes and the scheduled New Opps email.
 */
export async function summarizeScopeBatch(client, items) {
  const response = await client.beta.messages.create(buildScopeRequest(items));
  if (response.stop_reason === 'refusal') return null;
  const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
  return readScopeSummaries(text, items);
}
