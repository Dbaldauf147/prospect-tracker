// Every call mapped to one opp, as the running log of what each one said
// to do next.
//
// The opp's Next Steps field is a working checklist: lines from several
// calls merged into one list, reworded, reordered, and ticked off. That
// is the right shape for "what do I do now" and the wrong shape for
// "what have we been saying we'd do" — once a step is merged in, nothing
// records which conversation it came out of or when, and a step that was
// finished and deleted leaves no trace at all.
//
// This reads the call records instead, which keep their own follow-ups
// forever, and turns them back into a timeline: one entry per call, its
// follow-ups underneath it, newest first. It is a history, so it is
// deliberately NOT deduplicated across calls — the same commitment made
// on three consecutive calls is the most interesting thing such a log
// can show, and collapsing it to one line would hide exactly that.
//
// Pure: records in, entries out. No React, no Firestore, no clock — so
// the rules stay testable (scripts/callNextStepsLog.test.mjs).

import { nextStepLinesFromCall } from './nextSteps.js';

function textOf(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function msOf(value) {
  const t = new Date(value || 0).getTime();
  return Number.isFinite(t) && t > 0 ? t : null;
}

/**
 * The calls mapped to one opp, newest first, each with the next steps it
 * produced.
 *
 *   records — stored call records (array, or the id-keyed map)
 *   oppId   — the opp's `_id`
 *
 * Entries are `{ id, name, at, atMs, url, steps, summarized, pushed }`.
 * `steps` is the same list the push onto the checklist would add, through
 * the same helper, so the log can't disagree with what actually landed.
 *
 * A call with NO follow-ups is still an entry. It is a conversation that
 * happened on this deal, and dropping it would make an un-summarised call
 * indistinguishable from one that was never mapped — the log would just
 * be missing a week with nothing to say why. `summarized` is what lets
 * the view tell "we talked and agreed nothing" from "nobody has run the
 * summary yet", which are different problems with different fixes.
 *
 * Undated calls sort last: a call with no date can't be shown to belong
 * anywhere in the order, and putting it at the top would have it claim to
 * be the most recent thing that happened.
 */
export function callNextStepsLog(records, oppId) {
  const id = String(oppId ?? '').trim();
  if (!id) return [];
  const list = Array.isArray(records) ? records : Object.values(records || {});

  return list
    .filter(r => r?.id && String(r?.oppId || '').trim() === id)
    .map((record, i) => ({
      // The original position rides alongside the entry rather than on
      // it, so equal (or absent) dates keep a stable order instead of
      // shuffling between renders — and the entry handed back carries no
      // sorting scaffolding.
      i,
      entry: {
        id: String(record.id),
        name: textOf(record.name) || 'Untitled call',
        at: record.recordedAt || record.createdAt || null,
        atMs: msOf(record.recordedAt || record.createdAt),
        url: textOf(record.granolaUrl),
        steps: nextStepLinesFromCall(record),
        // Either summariser counts: the AI pass writes `summarizedAt`, and
        // a Granola note arrives already written up. Both mean the same
        // thing here — this call has been read, so an empty step list is
        // an answer rather than a gap.
        summarized: !!(record.summarizedAt || textOf(record.summary) || textOf(record.granolaSummary)),
        pushed: Number(record.nextStepsPushed) || 0,
      },
    }))
    .sort((a, b) => {
      const at = a.entry.atMs, bt = b.entry.atMs;
      if (at == null && bt == null) return a.i - b.i;
      if (at == null) return 1;
      if (bt == null) return -1;
      return bt - at || a.i - b.i;
    })
    .map(x => x.entry);
}

/**
 * What the log adds up to, for a header that says whether it is worth
 * opening.
 *
 * `unsummarized` is the actionable one: those calls are mapped to the
 * deal and have never been read, so whatever was agreed on them is
 * sitting in a transcript rather than on the checklist.
 */
export function callNextStepsSummary(entries) {
  const list = Array.isArray(entries) ? entries : [];
  let steps = 0, unsummarized = 0;
  for (const entry of list) {
    steps += entry.steps.length;
    if (!entry.summarized) unsummarized += 1;
  }
  return { calls: list.length, steps, unsummarized };
}
