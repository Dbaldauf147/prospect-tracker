// The Next Steps field on an opp: how it is stored, and how a call's
// follow-ups get added to it.
//
// "Next Steps" is the column Opps 2 renders as **Notes** — the bulleted
// checklist a rep works off. It is stored as one newline-joined string
// (so search, sort, and export keep working on a plain field) with four
// parallel arrays, one entry per line, index-aligned: `_nextStepsWaiting`
// holding each step's Waiting On, `_nextStepsDone` holding the day it
// was last ticked off, `_nextStepsHold` whether it is on hold, and
// `_nextStepsWait` when a "wait until afternoon" on it lifts. That
// alignment is the whole reason this file exists: anything appending to
// the list has to extend every part together, or every step below the insertion point starts showing
// somebody else's Waiting On.
//
// The format helpers were Opps 2's own until a call's follow-ups needed
// to land in the same field. Two copies of a storage format is a drift
// waiting to happen, so they live here and Opps 2 imports them.

import { withLastCallStamp } from './lastCallOnOpp.js';
import { easternDayParts, easternWallToUtcMs } from './nfatSchedules.js';

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

// ---- done for today ---------------------------------------------------

/** The opp field holding each step's last-ticked day, index-aligned. */
export const NEXT_STEPS_DONE_FIELD = '_nextStepsDone';

/**
 * A step's "done" mark is the DAY it was ticked, not a boolean.
 *
 * The mark is meant to last one day: it says "I did this today", and
 * every step starts tomorrow unticked again. A boolean would need
 * somebody to come along at midnight and clear it — a scheduled job that
 * has to run on the right device, in the right timezone, whether or not
 * anybody had the app open, and that silently leaves yesterday's ticks
 * standing every time it doesn't. A date needs nobody: the mark simply
 * stops being today's, on every device at once, and an app that was shut
 * for a week comes back correct.
 *
 * It also keeps something a boolean throws away — when the step was last
 * worked — which is what the checkbox's tooltip says.
 *
 * This is the same mechanism as the Called / Meeting chips in the popup's
 * header (`_calledOn`, `_metOn`), which stamp a day and read back as
 * "marked" only while that day is today.
 */
export function isStepDoneToday(stamp, today) {
  const s = String(stamp ?? '').trim();
  return !!s && s === String(today ?? '').trim();
}

/** Tick an unticked step for today, or untick one already ticked today. */
export function toggleStepDone(stamp, today) {
  return isStepDoneToday(stamp, today) ? '' : String(today ?? '').trim();
}

/** A stored `_nextStepsDone` value as a plain array of stamps. */
export function readStepsDone(opp) {
  const raw = opp?.[NEXT_STEPS_DONE_FIELD];
  return Array.isArray(raw) ? raw.map(v => String(v ?? '').trim()) : [];
}

/** How many of a list of stamps are today's. */
export function countStepsDoneToday(stamps, today) {
  return (Array.isArray(stamps) ? stamps : []).filter(s => isStepDoneToday(s, today)).length;
}

// ---- on hold -----------------------------------------------------------

/** The opp field holding each step's "on hold" flag, index-aligned. */
export const NEXT_STEPS_HOLD_FIELD = '_nextStepsHold';

/**
 * A step put on hold stays greyed out until somebody unticks it.
 *
 * The other half of "done today": that tick is a DAY and lapses overnight,
 * which is right for "I worked this today" and wrong for "nothing to do
 * here until they come back to me", where the step should stay out of the
 * way for as long as it takes. So this one is a plain flag that nothing
 * clears on its own.
 */
export function readStepsHold(opp) {
  const raw = opp?.[NEXT_STEPS_HOLD_FIELD];
  return Array.isArray(raw) ? raw.map(v => v === true || v === 'true' || v === 1 || v === '1') : [];
}

// ---- wait until afternoon ---------------------------------------------

/** The opp field holding each step's "wait until afternoon" expiry, index-aligned. */
export const NEXT_STEPS_WAIT_FIELD = '_nextStepsWait';

/** The Eastern hour a wait lifts at: 1 PM, the same time the Opps table's X marks clear. */
export const STEP_WAIT_HOUR = 13;

/**
 * A step parked until the afternoon is stored as the INSTANT it lifts (UTC
 * ms), not as a flag, for the same reason "done today" is a day: nothing has
 * to come along at 1 PM and clear it. The step simply stops waiting once
 * that moment has passed, on every device at once, whether or not the app
 * was open.
 *
 * The instant is the next 1 PM Eastern after the tick: today's when ticked
 * in the morning, tomorrow's when ticked after 1 PM, which is when an X put
 * on an opp that afternoon would clear too.
 */
export function nextStepWaitEndMs(nowMs = Date.now()) {
  const today = easternDayParts(nowMs);
  const occ = easternWallToUtcMs(today.year, today.month, today.day, STEP_WAIT_HOUR, 0);
  if (occ > nowMs) return occ;
  const next = easternDayParts(nowMs + 24 * 60 * 60 * 1000);
  return easternWallToUtcMs(next.year, next.month, next.day, STEP_WAIT_HOUR, 0);
}

/** Is a step with this stored expiry still waiting? */
export function isStepWaiting(until, nowMs = Date.now()) {
  const t = Number(until);
  return Number.isFinite(t) && t > nowMs;
}

/** Tick a step to wait until the afternoon, or untick one that is waiting. */
export function toggleStepWait(until, nowMs = Date.now()) {
  return isStepWaiting(until, nowMs) ? 0 : nextStepWaitEndMs(nowMs);
}

/** A stored `_nextStepsWait` value as a plain array of expiries (0 = none). */
export function readStepsWait(opp) {
  const raw = opp?.[NEXT_STEPS_WAIT_FIELD];
  return Array.isArray(raw) ? raw.map(v => (Number.isFinite(Number(v)) ? Number(v) : 0)) : [];
}

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
    return `${text}${owner ? ` - ${owner}` : ''}${due ? ` (due ${due})` : ''}`;
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

// ---- what one opp learns from one call --------------------------------

/**
 * The whole patch a mapped call puts on its opp: the reference saying it
 * is that deal's last conversation, and nothing else.
 *
 * It used to append the call's follow-ups to the opp's Next Steps as
 * well. That checklist is what the Opps table shows as "Notes" and what
 * the Follow Up Notes popup opens on, and a deal with a few mapped calls
 * filled it with lines nobody typed — a call's follow-ups aren't a
 * to-do list somebody has decided to work off, they're what one
 * conversation said. Once merged in they couldn't be told apart from a
 * hand-written note either: Next Steps is plain text with an
 * index-aligned Waiting On array and carries no provenance.
 *
 * So a call's follow-ups now stay on the call record, where they are
 * kept forever, and the Follow Up Notes popup's Calls tab reads them
 * back per call, newest first (see callNextStepsLog.js). The checklist
 * holds what the user put on it.
 *
 *   { patch, added }
 *
 * `patch` is empty when the opp already carries this stamp, so a caller
 * can skip the write rather than stamping an opp for an edit that
 * changed nothing. `added` stays in the shape for the callers that
 * report a count back to the user, and is now always 0.
 */
export function callOnOppPatch(opp, record) {
  return { patch: withLastCallStamp({}, opp, record), added: 0 };
}
