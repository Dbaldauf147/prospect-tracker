// Which opportunity a call belongs to — including "none, and that's the
// answer".
//
// The page could already tag a call to an opp, but only in one
// direction: a call was either tagged or it wasn't, and "wasn't" covered
// two completely different situations. Most calls that will never belong
// to an opp — an internal 1:1, a training session, a prospecting block
// Granola happened to sit in — sat in the same undifferentiated pile as
// the client call nobody has got to yet. So the pile only ever grew, and
// the one question worth asking of it ("what still needs doing?") had no
// answer.
//
// Marking a call N/A is what closes that gap. It is a decision, stored
// like any other, and it is deliberately NOT the same as clearing the
// tag: clearing puts a call back into the queue, N/A takes it out.
//
// Pure: patches in, patches out, no fetch and no React, so the rules
// stay testable (scripts/callOppTag.test.mjs).

/** A call tagged to an opportunity. */
export const OPP_TAG_TAGGED = 'tagged';
/** A call that deliberately belongs to no opportunity. */
export const OPP_TAG_NA = 'na';
/** A call nobody has decided about yet. */
export const OPP_TAG_NONE = 'none';

function textOf(value) {
  return typeof value === 'string' ? value.trim() : '';
}

const STATES = new Set([OPP_TAG_TAGGED, OPP_TAG_NA, OPP_TAG_NONE]);

/**
 * Where one call stands: tagged, N/A, or undecided.
 *
 * Takes a stored RECORD or a history ROW. That matters more than it
 * looks: the History table renders rows, which carry a precomputed
 * `oppTag` and none of the raw fields it came from — so a version of
 * this that only read `oppId`/`oppNa` reported every row in the table as
 * undecided, which silently emptied the N/A filter and inflated the
 * queue. Reading the precomputed value first covers both shapes.
 *
 * A real opp id otherwise wins over the N/A flag. The two are cleared
 * against each other on every write below, so both being set means
 * something wrote a patch by hand — and a call with an opp on it is
 * tagged, whatever a stale flag says.
 */
export function oppTagStateOf(record) {
  if (STATES.has(record?.oppTag)) return record.oppTag;
  if (textOf(record?.oppId)) return OPP_TAG_TAGGED;
  if (record?.oppNa) return OPP_TAG_NA;
  return OPP_TAG_NONE;
}

/** What the tag reads as in a cell or a chip. '' when undecided. */
export function oppTagLabelOf(record) {
  const state = oppTagStateOf(record);
  if (state === OPP_TAG_TAGGED) return textOf(record?.oppLabel) || 'Opportunity';
  if (state === OPP_TAG_NA) return 'N/A';
  return '';
}

/** Has this call been triaged at all — either way? */
export function isOppTagged(record) {
  return oppTagStateOf(record) !== OPP_TAG_NONE;
}

/**
 * The patch that tags a call to an opportunity.
 *
 * Clears the N/A flag: a call cannot both belong to a deal and belong to
 * no deal, and leaving the flag behind would have it come back the
 * moment the opp tag was removed.
 *
 * `company` is adopted from the opp's account only when the call has
 * none, so the two tags can't contradict each other — and an existing
 * company link (which the user may have set by hand, against a parent or
 * a broker) is never overwritten.
 */
export function tagOppPatch(opp, { label = '', company = '' } = {}) {
  const account = textOf(opp?.Account);
  return {
    oppId: String(opp?._id || ''),
    oppLabel: label,
    oppNa: false,
    oppNaAt: '',
    oppNaRule: '',
    oppTagManual: true,
    ...(company ? {} : (account ? { company: account } : {})),
  };
}

/**
 * The patch that marks a call as belonging to no opportunity.
 *
 * Drops any opp tag it had, because that is what the user just said. The
 * timestamp is what lets a later reader tell a deliberate N/A from a
 * record that happens to carry the field.
 */
export function markOppNaPatch(now = new Date()) {
  return {
    oppId: '',
    oppLabel: '',
    oppNa: true,
    oppNaAt: now.toISOString(),
    oppNaRule: '',
    oppTagManual: true,
  };
}

/**
 * The same, applied by a name rule rather than by the user.
 *
 * `oppNaRule` records WHICH rule did it — so the page can say why a call
 * it never touched is marked N/A, and so deleting a rule can find what
 * it did. `oppTagManual` stays false, which is what keeps the two kinds
 * of N/A apart everywhere it matters.
 */
export function autoNaPatch(rule, now = new Date()) {
  return {
    oppId: '',
    oppLabel: '',
    oppNa: true,
    oppNaAt: now.toISOString(),
    oppNaRule: textOf(rule),
    oppTagManual: false,
  };
}

/**
 * The patch that puts a call back in the queue — neither tagged nor N/A.
 * One button undoes either decision, because from the user's side they
 * are the same action: "this isn't settled after all".
 *
 * Marks the call as manually decided even though the decision was to
 * un-decide. Without that, a rule would re-apply on the next sync and
 * the user would be arguing with the page: clear it, sync, watch it come
 * back, clear it again. Saying "leave this one alone" is exactly what
 * clearing an auto-tag means.
 */
export function clearOppTagPatch() {
  return {
    oppId: '',
    oppLabel: '',
    oppNa: false,
    oppNaAt: '',
    oppNaRule: '',
    oppTagManual: true,
  };
}

/** Was this N/A put there by a rule rather than by the user? */
export function isAutoNa(record) {
  return oppTagStateOf(record) === OPP_TAG_NA && !!textOf(record?.oppNaRule);
}

/**
 * How the triage stands across a list of rows.
 *
 * `untagged` is the number worth acting on, and the only reason to count
 * any of this: it is the size of the queue.
 */
export function oppTagCounts(rows) {
  const counts = { tagged: 0, na: 0, untagged: 0, total: 0 };
  for (const row of (Array.isArray(rows) ? rows : [])) {
    counts.total += 1;
    const state = oppTagStateOf(row);
    if (state === OPP_TAG_TAGGED) counts.tagged += 1;
    else if (state === OPP_TAG_NA) counts.na += 1;
    else counts.untagged += 1;
  }
  return counts;
}

/** The rows matching one of the filters below. */
export const OPP_TAG_FILTERS = [
  { key: 'all', label: 'All', title: 'Every stored call' },
  { key: 'untagged', label: 'Needs tagging', title: 'Calls with no opportunity and no N/A: the queue' },
  { key: 'tagged', label: 'Tagged', title: 'Calls tagged to an opportunity' },
  { key: 'na', label: 'N/A', title: 'Calls marked as belonging to no opportunity' },
];

// The filter chips are named for what the user is looking for; the
// states are named for what a record IS. "Needs tagging" and "none" are
// the same pile, and only this map says so — without it that filter
// matches nothing and the queue looks permanently empty.
const FILTER_TO_STATE = {
  untagged: OPP_TAG_NONE,
  tagged: OPP_TAG_TAGGED,
  na: OPP_TAG_NA,
};

export function filterByOppTag(rows, key) {
  const list = Array.isArray(rows) ? rows : [];
  const state = FILTER_TO_STATE[key];
  if (!state) return list;
  return list.filter(row => oppTagStateOf(row) === state);
}
