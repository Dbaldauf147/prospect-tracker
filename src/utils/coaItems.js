// COA approval items on an opportunity.
//
// A quote can need several COA (Conditions of Approval) exceptions signed off
// before it can go out — a 3% escalator to start with — and each one is its
// own small errand: it gets requested on a date, and it comes back approved on
// a later one. The opp record already carried a single "COA Approval" cell and
// a ticket link, which answers "is COA involved?" but not "which exception,
// asked for when, and has it come back?".
//
// So the opp carries a list under `_coaItems`, one row per exception, edited
// as a table on the Opp details page. Same shape and storage route as the
// `_timelines` rows the Notes popup edits: an array of plain objects written
// straight back on every edit, so there is one way to hold a per-opp sub-table
// rather than two.
//
// Dates are ISO 'yyyy-mm-dd' — what <input type="date"> gives and takes, and
// what sorts lexically, so "which is oldest" needs no parsing.
//
// A row can also be marked `na`: the exception doesn't apply to this deal.
// That is a different answer from "not requested yet" — the seeded 3% esc row
// sits on every opp, and without a way to say "not on this one" the only ways
// to clear it were to delete the row (which says nothing) or to leave it
// reading as outstanding forever.

// The item every opp starts with. A new opp shows this row already named, so
// the common case is two dates and no typing; anything else is typed into the
// item cell and remembered by coaItemOptions.js for the next opp.
export const DEFAULT_COA_ITEMS = ['3% esc'];

/** A blank row, for the editor's "+ Add item" button. */
export function emptyCoaItem() {
  return { item: '', requested: '', approved: '' };
}

/**
 * Clean whatever is stored into rows of { item, requested, approved }.
 *
 * Forgiving on the way in: these records are long-lived and hand-editable, so
 * a row written by an older version comes back usable rather than taking the
 * opp's whole list with it.
 */
export function normalizeCoaItems(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(r => r && typeof r === 'object')
    .map(r => {
      const row = {
        item: String(r.item ?? '').trim(),
        requested: String(r.requested ?? '').trim(),
        approved: String(r.approved ?? '').trim(),
      };
      // Only present when it is set, so a row nobody marked reads on the
      // record exactly as it always did.
      if (r.na === true || r.na === 'true') row.na = true;
      return row;
    });
}

/**
 * The rows to show for an opp: what it has stored, or the seeded first item
 * when it has nothing.
 *
 * Seeding rather than starting empty is what makes the table always visible —
 * the same reason the timelines editor seeds a row per timeline-driven
 * service. A row that is only a seed is not stored (see coaItemsToStore), so
 * an opp nobody has touched carries no COA data.
 */
export function coaItemsForOpp(opp) {
  const stored = normalizeCoaItems(opp?._coaItems);
  if (stored.length) return stored;
  return DEFAULT_COA_ITEMS.map(item => ({ ...emptyCoaItem(), item }));
}

/**
 * The rows worth writing to the record.
 *
 * A row with nothing on it is the editor's empty form row, not a COA item:
 * kept in local state so it stays on screen while it is typed into, dropped on
 * the way to the record so an opp never stores a row of blanks. A row carrying
 * only the seeded name is the same thing — nothing has been recorded about it
 * yet — so an untouched opp stays untouched.
 */
export function coaItemsToStore(list) {
  return normalizeCoaItems(list)
    .filter(r => r.requested || r.approved || (r.na && r.item) || (r.item && !isSeedName(r.item)));
}

function isSeedName(item) {
  const key = String(item).trim().toLowerCase();
  return DEFAULT_COA_ITEMS.some(d => d.toLowerCase() === key);
}

/**
 * Where one row stands: 'na' (doesn't apply to this deal), 'approved',
 * 'requested' (asked for, still waiting) or 'open' (not asked for yet).
 *
 * An approved date wins on its own. A COA that came back without anyone
 * recording the request is still approved, and reading it as "not requested"
 * because the first date is blank would be a status that argues with the date
 * beside it.
 */
export function coaItemStatus(row) {
  // Marked N/A wins over the dates: a row that was asked for and then turned
  // out not to apply is not still waiting on anybody.
  if (row?.na) return 'na';
  if (String(row?.approved ?? '').trim()) return 'approved';
  if (String(row?.requested ?? '').trim()) return 'requested';
  return 'open';
}

/**
 * How long a request has been out, in days, or null when the row isn't
 * waiting on anything. Counted from the requested date to `nowMs`.
 */
export function coaDaysWaiting(row, nowMs = Date.now()) {
  if (coaItemStatus(row) !== 'requested') return null;
  const t = Date.parse(`${String(row.requested).trim()}T00:00:00`);
  if (Number.isNaN(t)) return null;
  const now = new Date(nowMs);
  const todayMid = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.max(0, Math.round((todayMid - t) / 86400000));
}

/**
 * The rows of a list still to be settled: an item that is neither approved
 * nor marked N/A is one somebody still has to chase. Rows with no item name
 * are the editor's blank form row and are skipped.
 */
export function unsettledCoaItems(list) {
  return normalizeCoaItems(list)
    .filter(r => r.item && coaItemStatus(r) !== 'approved' && coaItemStatus(r) !== 'na');
}

/**
 * What an opp still has to settle: its unsettled stored rows, plus any
 * DEFAULT item its record has no row for at all.
 *
 * The defaults matter because of how little gets stored. "3% esc" is the
 * question every opp is asked, and a row carrying only that name is dropped
 * on the way to the record (coaItemsToStore) precisely because nothing has
 * been recorded about it — so "the record has no 3% esc row" and "nobody has
 * dealt with the 3% escalator" are the same state, whether the opp has other
 * items stored or nothing at all. Answering it — an approved date, or the
 * N/A button — is what settles it.
 */
export function outstandingCoaItems(opp) {
  const stored = normalizeCoaItems(opp?._coaItems);
  const named = new Set(stored.map(r => r.item.toLowerCase()));
  const unanswered = DEFAULT_COA_ITEMS
    .filter(d => !named.has(d.toLowerCase()))
    .map(item => ({ ...emptyCoaItem(), item }));
  return unsettledCoaItems([...stored, ...unanswered]);
}

/**
 * One line for the section header: what is done and what is outstanding.
 *
 * Counts only rows that have been recorded — a seeded row nobody has filled in
 * is not an outstanding approval, and counting it would put a number on the
 * header of every opp in the book. Rows marked N/A are counted separately:
 * they are settled, but they were never approvals.
 */
export function coaItemsSummary(list, nowMs = Date.now()) {
  const stored = coaItemsToStore(list);
  // N/A rows are counted on their own and kept out of the rest: they are not
  // approvals anyone is chasing, so folding them into the total would make
  // "2 of 3 approved" the permanent reading of a fully-cleared deal.
  const na = stored.filter(r => coaItemStatus(r) === 'na').length;
  const rows = stored.filter(r => coaItemStatus(r) !== 'na');
  const approved = rows.filter(r => coaItemStatus(r) === 'approved').length;
  const waiting = rows.filter(r => coaItemStatus(r) === 'requested');
  const oldest = waiting.reduce((max, r) => {
    const d = coaDaysWaiting(r, nowMs);
    return d != null && (max == null || d > max) ? d : max;
  }, null);
  return { total: rows.length, approved, waiting: waiting.length, oldestWaitingDays: oldest, na };
}
