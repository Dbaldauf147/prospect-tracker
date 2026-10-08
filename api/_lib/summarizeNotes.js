// The pure half of /api/summarize-notes: what Claude is asked, the shape
// its answer must take, and the check that turns that answer back into
// bullets per opp. Kept apart from the handler so it loads under plain
// Node (scripts/summarizeNotes.test.mjs) without an API key or a request.
//
// Powers the Notes column on the New Opps (Opps) and PE Opps (PE
// Portfolio) subtabs, which show each opp's running Next Steps notes as a
// short summary instead of the raw, often long, checklist.

// One request carries at most this many opps. The tables ask in chunks of
// this size, so a long list is several requests rather than one huge one.
export const MAX_ITEMS = 25;

// A single opp's notes past this length are not a note any more but a
// pasted email thread; the tail is the oldest part and adds least to a
// summary of where the deal stands.
export const MAX_NOTE_CHARS = 6000;

// The most bullets a summary may have. The cell is a table cell, not a
// report: anything that needs more than this is better read in the popup.
export const MAX_BULLETS = 4;

/**
 * The items to summarise: { id, text } with a non-blank id and text, ids
 * unique, text trimmed and capped. Anything else is dropped rather than
 * failing the batch, so one malformed row can't cost the rest theirs.
 */
export function cleanItems(list) {
  const out = [];
  const seen = new Set();
  for (const it of (Array.isArray(list) ? list : [])) {
    const id = String(it?.id ?? '').trim();
    const text = String(it?.text ?? '').trim();
    if (!id || !text || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, text: text.slice(0, MAX_NOTE_CHARS) });
  }
  return out;
}

export const SYSTEM_PROMPT = `You summarize the running notes a sales team keeps on each sales opportunity, so a manager scanning a table of deals can see where each one stands at a glance.

Each opp's notes are a checklist of next steps, follow-ups and status lines, usually one per line, written in shorthand by the salesperson. Some lines may end in "[waiting on: X]" naming who the step is waiting on.

For each opp, write between 1 and ${MAX_BULLETS} bullets:
- Lead with the current status or the most important open next step.
- Keep each bullet short: a fragment of about 4 to 12 words, no trailing period.
- Keep names, companies, dates, amounts and who it is waiting on; drop filler and repetition.
- Use only what the notes say. Do not invent dates, owners or outcomes.
- If the notes are already a single short line, return that line as the only bullet, lightly tidied.
- Do not use em dashes; use a comma, a colon or a hyphen instead.

Return one entry per opp, using the id it was given.`;

/** The user turn: every opp's notes, each under its id. */
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
            bullets: { type: 'array', items: { type: 'string' } },
          },
          required: ['id', 'bullets'],
          additionalProperties: false,
        },
      },
    },
    required: ['summaries'],
    additionalProperties: false,
  };
}

// A bullet as the cell shows it: trimmed, any leading marker the model
// added despite the schema dropped, and em dashes swapped for hyphens so
// the site rule holds however the model words it.
function cleanBullet(s) {
  return String(s ?? '')
    .replace(/^\s*(?:[-*•·]|\d+[.)])\s*/, '')
    .replace(/\s*—\s*/g, ' - ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The answer as { [id]: bullets[] }, held to the ids that were asked about
 * (a stray or repeated id is ignored) and to MAX_BULLETS each. An id with
 * no usable bullets is left out, so the caller can tell "not summarised"
 * from "summarised as nothing". Null when the text isn't the JSON asked for.
 */
export function readSummaries(text, items) {
  let parsed;
  try { parsed = JSON.parse(String(text || '')); } catch { return null; }
  if (!parsed || !Array.isArray(parsed.summaries)) return null;
  const asked = new Set(items.map(it => it.id));
  const out = {};
  for (const s of parsed.summaries) {
    const id = String(s?.id ?? '');
    if (!asked.has(id) || out[id]) continue;
    const bullets = (Array.isArray(s.bullets) ? s.bullets : [])
      .map(cleanBullet)
      .filter(Boolean)
      .slice(0, MAX_BULLETS);
    if (bullets.length) out[id] = bullets;
  }
  return out;
}

/**
 * The Messages API request. Summarising notes is a light rewrite, so low
 * effort; structured output keeps the answer machine-readable. Server-side
 * fallback is on, so a classifier decline is retried on the model
 * Anthropic recommends rather than handed back as a refusal.
 */
export function buildRequest(items) {
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
