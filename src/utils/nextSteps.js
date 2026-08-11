// The Next Steps field on an opp: how it is stored, and how a call's
// follow-ups get added to it.
//
// "Next Steps" is the column Opps 2 renders as **Notes** — the bulleted
// checklist a rep works off. It is stored as one newline-joined string
// (so search, sort, and export keep working on a plain field) with a
// parallel `_nextStepsWaiting` array holding each step's Waiting On, one
// entry per line, index-aligned. That alignment is the whole reason this
// file exists: anything appending to the list has to extend both halves
// together, or every step below the insertion point starts showing
// somebody else's Waiting On.
//
// The format helpers were Opps 2's own until a call's follow-ups needed
// to land in the same field. Two copies of a storage format is a drift
// waiting to happen, so they live here and Opps 2 imports them.

// A hard line break typed INSIDE one step is stored as U+2028 (LINE
// SEPARATOR) rather than "\n": steps are split on "\n", so a newline
// inside a step would explode it into several and desync the parallel
// waiting array. U+2028 still renders as a break in the pre-formatted
// table cell, so the box looks the same.
export const NOTE_LINEBREAK = String.fromCharCode(0x2028);
const NOTE_LINEBREAK_RE = new RegExp(NOTE_LINEBREAK, 'g');

/**
 * A Next Steps cell as its bullet items.
 *
 * Splits on newlines, strips any leading marker the user typed
 * (- * • 1. etc.), and drops empty lines, so the popup and the hover
 * render cleanly even when the source was loose prose.
 */
export function textToBulletItems(text) {
  return String(text ?? '')
    .split(/\r?\n+/)
    .map(line => line.replace(/^\s*(?:[-*•·▪►]|\d+[.)])\s*/, '').replace(NOTE_LINEBREAK_RE, '\n').trim())
    .filter(Boolean);
}

/** One step's internal newlines collapsed to U+2028, ready to be joined. */
export const encodeNoteLine = (note) => String(note ?? '').trim().replace(/\r?\n/g, NOTE_LINEBREAK);

// ---- a call's follow-ups as next steps --------------------------------

// The summariser caps its own follow-up list at 15; this is the same
// ceiling applied to whatever arrives, so a malformed record can't push
// a hundred lines onto an opp.
const MAX_STEPS = 15;

/** Two steps are the same step when they read the same. */
function stepKey(line) {
  return String(line || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    // Trailing punctuation is typing, not meaning: "Send pricing." and
    // "Send pricing" are one item, and adding the second under the first
    // is exactly the duplicate this is here to stop.
    .replace(/[.;,!]+$/, '')
    .trim();
}

/**
 * A stored call record → the next-step lines it contributes.
 *
 * The AI summary's `followUps` are the structured version and are
 * preferred; `nextSteps` is a free-text paragraph the same pass writes,
 * used only when there are no structured follow-ups, so a call still
 * contributes something when the model wrote prose instead of a list.
 *
 * Owner and due date ride in the line's text rather than in the Waiting
 * On column: "who owes this" from a transcript is a name the model
 * heard, and dropping it into a structured field would give it more
 * authority than it has earned. In the line it reads as what it is.
 */
export function nextStepLinesFromCall(record) {
  const followUps = Array.isArray(record?.followUps) ? record.followUps : [];
  const fromList = followUps.map(f => {
    const text = (typeof f === 'string' ? f : f?.text || '').trim();
    if (!text) return '';
    const owner = (typeof f === 'object' && f?.owner) ? String(f.owner).trim() : '';
    const due = (typeof f === 'object' && f?.due) ? String(f.due).trim() : '';
    return `${text}${owner ? ` — ${owner}` : ''}${due ? ` (due ${due})` : ''}`;
  }).filter(Boolean);

  const lines = fromList.length > 0
    ? fromList
    : textToBulletItems(record?.nextSteps);

  // Deduped within the call as well as against the opp: a follow-up list
  // that repeats itself would otherwise arrive as two identical steps.
  const seen = new Set();
  const out = [];
  for (const line of lines) {
    const key = stepKey(line);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(encodeNoteLine(line));
    if (out.length >= MAX_STEPS) break;
  }
  return out;
}

/**
 * New steps appended to an opp's existing list.
 *
 * Append-only, and never a replacement. The Next Steps list is a
 * checklist the user works off and edits — a re-push that rewrote it
 * would delete steps they had reworded or added by hand, which is a
 * worse failure than a duplicate. Steps already on the list are skipped
 * instead, so pushing the same call twice adds nothing and re-pushing
 * after a re-summarise adds only what is new.
 *
 * New lines go at the END, which is also what keeps the Waiting On array
 * honest: every existing step keeps its index, and the appended ones get
 * blank entries of their own.
 *
 *   { text, waiting, added, skipped }
 *
 * `text` and `waiting` come back unchanged (same string, same array
 * identity) when there is nothing to add, so a caller can skip the write
 * entirely rather than stamping an opp for an edit that changed nothing.
 */
export function appendNextSteps(existingText, existingWaiting, lines) {
  const incoming = (Array.isArray(lines) ? lines : []).filter(Boolean);
  const waiting = Array.isArray(existingWaiting) ? existingWaiting : [];
  if (incoming.length === 0) {
    return { text: String(existingText ?? ''), waiting, added: 0, skipped: 0 };
  }

  const existingLines = textToBulletItems(existingText);
  const have = new Set(existingLines.map(stepKey));
  const fresh = [];
  let skipped = 0;
  for (const line of incoming) {
    const key = stepKey(line);
    if (!key || have.has(key)) { skipped += 1; continue; }
    have.add(key);
    fresh.push(encodeNoteLine(line));
  }
  if (fresh.length === 0) {
    return { text: String(existingText ?? ''), waiting, added: 0, skipped };
  }

  const text = [...existingLines.map(encodeNoteLine), ...fresh].join('\n');
  // Padded to the existing line count before the new blanks are added:
  // an opp whose waiting array is short (or absent) must not have the
  // new steps' blanks land against older lines.
  const padded = existingLines.map((_, i) => String(waiting[i] || ''));
  return {
    text,
    waiting: [...padded, ...fresh.map(() => '')],
    added: fresh.length,
    skipped,
  };
}
