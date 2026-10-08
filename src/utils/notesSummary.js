// The Notes column on the New Opps and PE Opps subtabs shows each opp's
// running notes (the Next Steps field) summarised into a few bullets by
// /api/summarize-notes. This file is the pure half: what text an opp is
// summarised from, which notes are worth a call at all, and the key a
// summary is cached under. The fetching lives in hooks/useNotesSummaries.

import { textToBulletItems } from './nextSteps.js';

// Notes this short are already a summary: one line that fits the cell.
// Sending them would spend a call to get the same words back.
export const SHORT_NOTE_CHARS = 120;

/**
 * The opp's notes as the summariser reads them: one step per line, each
 * with its Waiting On (the parallel `_nextStepsWaiting` array) appended
 * when it has one, since who a step is waiting on is often the point.
 */
export function oppNotesText(opp) {
  const steps = textToBulletItems(opp?.['Next Steps']);
  const waiting = Array.isArray(opp?._nextStepsWaiting) ? opp._nextStepsWaiting : [];
  return steps
    .map((s, i) => {
      const w = String(waiting[i] ?? '').trim();
      return `- ${s.replace(/\s*\n\s*/g, ' ')}${w ? ` [waiting on: ${w}]` : ''}`;
    })
    .join('\n');
}

/** Whether these notes are long enough to be worth summarising. */
export function needsSummary(text) {
  const t = String(text ?? '').trim();
  if (!t) return false;
  return t.includes('\n') || t.length > SHORT_NOTE_CHARS;
}

/**
 * The cache key for a summary: a hash of the exact text summarised, so an
 * edit to the notes (or to a Waiting On) is a new key and a fresh summary,
 * and two opps with identical notes share one. FNV-1a, 32-bit, plus the
 * length to make an accidental collision between edits vanishingly rare.
 */
export function summaryKey(text) {
  const s = String(text ?? '');
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `${(h >>> 0).toString(36)}.${s.length.toString(36)}`;
}

/** Split a list into chunks of at most `size`. */
export function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}
