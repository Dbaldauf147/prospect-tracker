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
// container, with the timeline graphic uploaded into that container.

import { toFile } from '@anthropic-ai/sdk';

export const MODEL = 'claude-opus-5-5';

// Caps on what the client may send. The instructions and knowledge are
// stored in the settings doc, so the UI enforces the same limits.
export const MAX_INSTRUCTIONS_CHARS = 20000;
export const MAX_KNOWLEDGE_CHARS = 60000;
export const MAX_BRIEF_CHARS = 20000;
export const MAX_REQUEST_CHARS = 4000;
// The timeline picture, base64. Vercel caps a request body at 4.5 MB.
export const MAX_PNG_BASE64_CHARS = 3_500_000;

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
  parts.push([
    'Your job in this conversation is to produce one PowerPoint (.pptx) file using the pptx skill.',
    '- Save the finished deck to $OUTPUT_DIR (or /mnt/user-data/outputs if that is unset) so it is returned as a file. Produce exactly one .pptx file.',
    '- The timeline graphic is attached as timeline.png. Use it on the timeline slide, kept at its own aspect ratio and not cropped or stretched.',
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
    'Build a PowerPoint for this project timeline, following the project instructions.',
    `<timeline_brief>\n${b}\n</timeline_brief>`,
    r ? `<extra_request>\n${r}\n</extra_request>` : '',
  ].filter(Boolean).join('\n\n');
}

/**
 * The Messages API request. The pptx skill runs in a code-execution
 * container (beta), with timeline.png uploaded into it. Medium effort: a
 * deck is real work, but it has to finish inside the function's 300 s.
 * Server-side fallback is on so a classifier decline is retried rather
 * than handed back as a refusal.
 */
export function buildRequest({ project, brief, request, pngFileId }) {
  const content = [];
  if (pngFileId) content.push({ type: 'container_upload', file_id: pngFileId });
  content.push({ type: 'text', text: buildUserText({ brief, request }) });
  return {
    model: MODEL,
    max_tokens: 32000,
    betas: ['code-execution-2025-08-25', 'server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: buildSystemPrompt(project),
    output_config: { effort: 'medium' },
    container: { skills: [{ type: 'anthropic', skill_id: 'pptx', version: 'latest' }] },
    tools: [{ type: 'code_execution_20260521', name: 'code_execution' }],
    messages: [{ role: 'user', content }],
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
 * Run the whole build against an Anthropic client: upload the picture,
 * ask Claude (resuming paused turns), find the .pptx it saved, download
 * it, and clean up the Files API either way. Resolves to
 * { filename, pptx (base64), note } or { status, error }. API errors
 * throw, for the handler to word.
 */
export async function buildDeck(client, { project, brief, png, request, title }, { budgetMs = BUDGET_MS } = {}) {
  const started = Date.now();
  const uploaded = [];
  try {
    let pngFileId = '';
    if (png) {
      const meta = await client.files.upload({
        file: await toFile(Buffer.from(png, 'base64'), 'timeline.png', { type: 'image/png' }),
      });
      pngFileId = meta.id;
      uploaded.push(meta.id);
    }

    const params = buildRequest({ project, brief, request, pngFileId });
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
