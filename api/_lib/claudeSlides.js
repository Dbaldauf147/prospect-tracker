// The pure half of /api/claude-slides: what Claude is asked when the
// Timelines page builds a PowerPoint "with Claude", and how the answer's
// output file is found. Kept apart from the handler so it loads under plain
// Node (scripts/claudeSlides.test.mjs) without an API key or a request.
//
// Dan keeps a Claude Project called "Slides and One Pagers" on claude.ai
// whose instructions and knowledge say how his decks should look and read.
// The API cannot reach a claude.ai Project, so he pastes the project's
// instructions and knowledge into the app (settings.claudeSlidesProject)
// and they travel with each request as the system prompt. Claude then
// builds the deck with Anthropic's pptx skill in a code-execution
// container: the timeline drawn as native, editable shapes, matching a
// reference slide from that project (timelineSlideReference.js), from the
// placement the app's own chart uses (src/utils/claudeSlidesBrief.js).

import { TIMELINE_SLIDE_REFERENCE_PNG } from './timelineSlideReference.js';

export const MODEL = 'claude-opus-5-5';

// Caps on what the client may send. The instructions and knowledge are
// stored in the settings doc, so the UI enforces the same limits.
export const MAX_INSTRUCTIONS_CHARS = 20000;
export const MAX_KNOWLEDGE_CHARS = 60000;
export const MAX_BRIEF_CHARS = 20000;
export const MAX_REQUEST_CHARS = 4000;

// How many times a paused server-side turn (pause_turn) is resumed before
// giving up. Each resume is another round of the container's tool loop.
export const MAX_CONTINUATIONS = 6;

// Stop resuming paused turns past this, so the user hears a reason before
// Vercel's 300 s limit kills the function silently.
export const BUDGET_MS = 250 * 1000;

export const DEFAULT_PROJECT_NAME = 'Slides and One Pagers';

const clip = (v, n) => String(v ?? '').trim().slice(0, n);

/** The project as the client sent it, trimmed and capped. */
export function cleanProject(p) {
  return {
    name: clip(p?.name, 120) || DEFAULT_PROJECT_NAME,
    instructions: clip(p?.instructions, MAX_INSTRUCTIONS_CHARS),
    knowledge: clip(p?.knowledge, MAX_KNOWLEDGE_CHARS),
  };
}

// How the timeline slide is laid out, read off the reference slide. The
// project's own instructions come first in the prompt and win where they
// say something different.
export const TIMELINE_SLIDE_SPEC = `Timeline slide layout (match the attached reference slide):
- 16:9 widescreen, white background, Arial throughout. Build every element as native, editable PowerPoint shapes and text boxes (python-pptx): no screenshots or pictures of the chart.
- Top left: the title in bold dark green #00552E, about 36 pt. Under it a subtitle in grey #626469, about 16 pt, "Stages and timeline, <first month year> to <last month year>" unless the brief gives a subtitle.
- Top right, level with the title: the legend, three entries each a filled circle and grey text: "<client> workstream" in navy #275B7F, "SE workstream" in green #3DCD58, "Both workstreams" in dark green #00552E. Leave "Both" out when no step uses it.
- A full-width dark green #00552E header band with white bold text: "Stage" over the left label column (about 28% of the width), then one heading per month column. The first month and each January carry the year ("Nov 2026", "Jan 2027"), the others the month alone.
- One row per step, rows alternating a very light grey #F3F6F4 fill and white, with thin light grey #D5DAD7 vertical grid lines at month boundaries. Rows share the height between the header and the footer.
- In the label column: a numbered circle filled with the step's workstream colour (white number, dark text on the light green), then the step name in grey #626469, about 14 pt, wrapping to two lines if needed.
- The bar: a rounded rectangle spanning exactly its month columns, filled with the workstream colour, with the bar label in bold at its left end (white on navy and dark green, dark green #00552E on light green). A milestone is a diamond in its month instead of a bar.
- Today: a solid orange #FFB04C vertical line through the rows at the position the brief gives, with an orange rounded pill under the chart reading "Today, <Mon> <day>" in bold dark text.
- Contract signature: a dashed dark green #00552E vertical line at the start of its column, with a dark green pill under the chart, white bold text, using the brief's label.
- Bottom right, italic grey: "Numbers correspond to the process steps on the next slide." Bottom left footer, small grey: "Property of Schneider Electric  |  Page <n>".
- After the timeline slide, a "process steps" slide in the same style listing each numbered step with its name, workstream, timing and detail, so the numbers on the timeline point to it.`;

/** The system prompt: the project's own instructions and knowledge first. */
export function buildSystemPrompt(project) {
  const parts = [
    `You are working inside the user's Claude Project "${project.name}". Follow the project instructions below exactly as you would in that project; they decide how slides and one-pagers look, read and are structured.`,
  ];
  if (project.instructions) {
    parts.push(`<project_instructions>\n${project.instructions}\n</project_instructions>`);
  }
  if (project.knowledge) {
    parts.push(`<project_knowledge>\n${project.knowledge}\n</project_knowledge>`);
  }
  parts.push(TIMELINE_SLIDE_SPEC);
  parts.push([
    'Your job in this conversation is to produce one PowerPoint (.pptx) file using the pptx skill.',
    '- Save the finished deck to $OUTPUT_DIR (or /mnt/user-data/outputs if that is unset) so it is returned as a file. Produce exactly one .pptx file.',
    '- Place every bar, marker and label from the brief\'s column numbers; they are exactly what the app\'s own chart draws.',
    '- Before saving, render the slides to images and compare them with the reference: fix overlapping or clipped text, bars off their columns, or labels that do not fit their bar.',
    '- Use only the facts in the brief. Do not invent dates, owners, amounts or stages.',
    '- Do not use em dashes in any slide text; use a hyphen, a comma or two sentences.',
    '- When the file is saved, reply with one short line saying what the deck contains.',
  ].join('\n'));
  return parts.join('\n\n');
}

/** The user turn's text: the timeline brief and any extra request. */
export function buildUserText({ brief, request }) {
  const b = clip(brief, MAX_BRIEF_CHARS);
  const r = clip(request, MAX_REQUEST_CHARS);
  return [
    'The image above is the reference timeline slide from this project: match its layout, colours and type. Build a PowerPoint for this project timeline, following the project instructions.',
    `<timeline_brief>\n${b}\n</timeline_brief>`,
    r ? `<extra_request>\n${r}\n</extra_request>` : '',
  ].filter(Boolean).join('\n\n');
}

/**
 * The Messages API request. The pptx skill runs in a code-execution
 * container (beta); the reference slide rides as an image Claude can see.
 * Medium effort: a deck is real work, but it has to finish inside the
 * function's 300 s. Server-side fallback is on so a classifier decline is
 * retried rather than handed back as a refusal.
 */
export function buildRequest({ project, brief, request }) {
  return {
    model: MODEL,
    max_tokens: 32000,
    betas: ['code-execution-2025-08-25', 'server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: buildSystemPrompt(project),
    output_config: { effort: 'medium' },
    container: { skills: [{ type: 'anthropic', skill_id: 'pptx', version: 'latest' }] },
    tools: [{ type: 'code_execution_20260521', name: 'code_execution' }],
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: TIMELINE_SLIDE_REFERENCE_PNG } },
        { type: 'text', text: buildUserText({ brief, request }) },
      ],
    }],
  };
}

/**
 * The file ids of anything the container produced, newest last. Code
 * execution reports created files as `*_code_execution_output` entries
 * inside its tool-result blocks; any block carrying a file_id that is not
 * one we uploaded counts.
 */
export function outputFileIds(content, uploadedIds = []) {
  const skip = new Set(uploadedIds);
  const found = [];
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(visit); return; }
    if (typeof node.file_id === 'string' && node.type !== 'container_upload' && !skip.has(node.file_id)) {
      if (!found.includes(node.file_id)) found.push(node.file_id);
    }
    for (const v of Object.values(node)) if (v && typeof v === 'object') visit(v);
  };
  visit(content);
  return found;
}

/** A download filename for the deck. */
export function deckFileName(title) {
  const base = String(title || 'Timeline').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'Timeline';
  return `${base}-Claude.pptx`;
}

/**
 * Run the whole build against an Anthropic client: ask Claude (resuming
 * paused turns), find the .pptx the container saved, download it, and
 * delete it from the Files API. Resolves to { filename, pptx (base64),
 * note } or { status, error }. API errors throw, for the handler to word.
 */
export async function buildDeck(client, { project, brief, request, title }, { budgetMs = BUDGET_MS } = {}) {
  const started = Date.now();
  const uploaded = [];
  try {
    const params = buildRequest({ project, brief, request });
    let response = await client.beta.messages.stream(params).finalMessage();
    const allContent = [...response.content];
    // A long tool loop pauses; send the turn back as it stands and the
    // server resumes it, in the same container.
    for (let i = 0; response.stop_reason === 'pause_turn' && i < MAX_CONTINUATIONS; i++) {
      if (Date.now() - started > budgetMs) break;
      params.messages = [...params.messages, { role: 'assistant', content: response.content }];
      if (response.container?.id) params.container = { ...params.container, id: response.container.id };
      response = await client.beta.messages.stream(params).finalMessage();
      allContent.push(...response.content);
    }

    if (response.stop_reason === 'refusal') {
      return { status: 422, error: 'Claude declined to build this deck.' };
    }

    // The newest .pptx the container produced.
    let deck = null;
    for (const id of outputFileIds(allContent, uploaded).reverse()) {
      const meta = await client.files.retrieveMetadata(id);
      if (/\.pptx$/i.test(meta.filename || '')) { deck = meta; break; }
    }
    if (!deck) {
      return {
        status: 502,
        error: response.stop_reason === 'pause_turn'
          ? 'Claude ran out of time before the deck was finished. Try again, or shorten the project instructions.'
          : 'Claude finished without returning a PowerPoint file.',
      };
    }
    const file = await client.files.download(deck.id);
    const buf = Buffer.from(await file.arrayBuffer());
    uploaded.push(deck.id); // handed over now; no need to keep it in Files

    const note = response.content.filter(b => b.type === 'text').map(b => b.text).join(' ').trim();
    return {
      filename: deckFileName(title),
      pptx: buf.toString('base64'),
      note: note.replace(/\s*\u2014\s*/g, ' - ').slice(0, 500), // em-dash-ok: strips em dashes out of model-written text
    };
  } finally {
    await Promise.all(uploaded.map(id => client.files.delete(id).catch(() => {})));
  }
}
