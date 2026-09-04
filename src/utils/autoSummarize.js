// Which transcribed calls should be summarised without being asked.
//
// A call arrives from Granola already transcribed, and then sits there:
// the opp popup's Calls section could only say "Transcribed, but not
// summarized yet: run Summarize on the Call Recordings page", so the one
// thing the user wanted from the call — what was said, what's next — was
// behind a page visit and a button click, per call.
//
// This picks the calls a background pass should summarise. It is the
// spending decision, so it is the part worth being conservative and
// testable about (scripts/autoSummarize.test.mjs): every call it returns
// costs a real API call, made while nobody is watching.
//
// The rules:
//
//   Has a transcript, has no summary. Nothing else is summarisable, and
//   re-summarising is a deliberate act (the page's Re-summarize button).
//
//   Not marked N/A. An N/A call is one the user has already said belongs
//   to no deal — an internal 1:1, a prospecting block. Paying to
//   summarise it unattended is the one case where automatic is worse than
//   the button. Untagged calls DO qualify: a call nobody has triaged yet
//   is exactly the one a summary helps triage.
//
//   Gives up after a few failures. A transcript the summariser chokes on
//   would otherwise be retried every hour forever.
//
//   Newest first, and capped. A first run against a long back-fill would
//   otherwise summarise a year of calls in one burst.

import { oppTagStateOf, OPP_TAG_NA } from './callOppTag.js';

/** How many times one call is retried before the pass leaves it alone. */
export const AUTO_SUMMARY_MAX_ATTEMPTS = 3;
/** How many calls one background pass will summarise. */
export const AUTO_SUMMARY_PER_RUN = 3;

function whenOf(record) {
  return String(record?.recordedAt || record?.createdAt || '');
}

/** Is this one call due for an unattended summary? */
export function isDueForAutoSummary(record) {
  if (!record) return false;
  if (!String(record.transcript || '').trim()) return false;
  if (record.summarizedAt) return false;
  if (record.summary) return false;
  if (oppTagStateOf(record) === OPP_TAG_NA) return false;
  const attempts = Number(record.autoSummaryAttempts);
  if (Number.isFinite(attempts) && attempts >= AUTO_SUMMARY_MAX_ATTEMPTS) return false;
  return true;
}

/**
 * The calls a background pass should summarise now, newest first.
 *
 * @param {object|Array} records  The stored records, keyed by id or as a list.
 * @param {object} [o]
 * @param {number} [o.limit]      How many to return. Defaults to the per-run cap.
 * @returns {Array} stored records, at most `limit` of them.
 */
export function callsDueForAutoSummary(records, { limit = AUTO_SUMMARY_PER_RUN } = {}) {
  const list = Array.isArray(records) ? records : Object.values(records || {});
  const due = list.filter(isDueForAutoSummary);
  due.sort((a, b) => whenOf(b).localeCompare(whenOf(a)));
  return limit > 0 ? due.slice(0, limit) : due;
}

/**
 * The patch recording that an unattended attempt failed.
 *
 * Counting attempts on the record rather than in memory is what makes the
 * give-up survive a reload — otherwise every refresh hands the same
 * broken transcript another three tries.
 */
export function autoSummaryFailurePatch(record, error) {
  const prev = Number(record?.autoSummaryAttempts);
  const attempts = (Number.isFinite(prev) && prev > 0 ? prev : 0) + 1;
  return {
    autoSummaryAttempts: attempts,
    autoSummaryError: String(error || '').slice(0, 300),
    autoSummaryFailedAt: new Date().toISOString(),
  };
}

/** Has this call been given up on by the background pass? */
export function autoSummaryGaveUp(record) {
  const attempts = Number(record?.autoSummaryAttempts);
  return Number.isFinite(attempts) && attempts >= AUTO_SUMMARY_MAX_ATTEMPTS;
}
