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
// That is a different answer from "not requested yet" — the catalog items sit
// on every opp, and without a way to say "not on this one" the only ways to
// clear one were to delete the row (which says nothing) or to leave it
// reading as outstanding forever.
//
// WHICH items every opp is asked about is a list the user keeps, on the
// Dropdowns page's COA Items tab (utils/coaItemOptions.js holds it). It
// arrives here as the `catalog` argument: every name on it shows as a row on
// every opp, carrying whatever that opp recorded against it. Nothing here
// reads the store itself — these functions stay pure so the tests can run in
// plain Node — so a caller that passes no catalog gets DEFAULT_COA_ITEMS, the
// list as it shipped.

// The item the catalog starts with, and the fallback for any caller that
// doesn't pass one. A new opp shows this row already named, so the common
// case is two dates and no typing.
export const DEFAULT_COA_ITEMS = ['3% esc'];

/** A blank row, for the editor's "+ Add item" button. */
export function emptyCoaItem() {
  return { item: '', requested: '', approved: '' };
}

/**
 * Clean a catalog into the names to show: trimmed, blanks dropped, de-duped
 * case-insensitively on the first spelling seen. The user's list is
 * hand-typed, so "3% esc" and "3% ESC" must not become two rows on every opp.
 */
export function coaCatalogNames(catalog) {
  const out = [];
  const seen = new Set();
  for (const v of Array.isArray(catalog) ? catalog : []) {
    const label = String(v ?? '').trim();
    if (!label) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(label);
  }
  return out;
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
 * The catalog laid over a list of rows: every catalog item, in the order the
 * user arranged it, carrying whatever the opp recorded against it — then
 * anything the opp holds that the catalog doesn't name.
 *
 * Catalog order rather than stored order is what makes the table read the
 * same on every opp. Stored rows are the exception on any given deal: a row
 * carrying only a catalog name is never written (see coaItemsToStore), so the
 * ones that come back are the ones somebody answered, and threading them into
 * their catalog position keeps an item where the reader last saw it instead
 * of promoting it to the top the moment a date is typed into it.
 *
 * Rows the catalog doesn't name are kept, at the end: an exception typed onto
 * one deal is that deal's, and the user removing an item from the catalog
 * must not delete the dates recorded under it.
 */
export function withCoaCatalog(rows, catalog = DEFAULT_COA_ITEMS) {
  const stored = normalizeCoaItems(rows);
  const used = new Set();
  const out = [];
  for (const item of coaCatalogNames(catalog)) {
    const key = item.toLowerCase();
    const idx = stored.findIndex((r, i) => !used.has(i) && r.item.toLowerCase() === key);
    if (idx >= 0) {
      used.add(idx);
      out.push(stored[idx]);
    } else {
      out.push({ ...emptyCoaItem(), item });
    }
  }
  stored.forEach((r, i) => { if (!used.has(i)) out.push(r); });
  // Never leave the editor with nothing to type into — an emptied catalog on
  // an opp with no items of its own would otherwise be a table of no rows.
  return out.length ? out : [emptyCoaItem()];
}

/**
 * The rows to show when the list changes under an open editor: the new list
 * laid over what is on screen, minus the rows that were only on screen
 * because the old list asked for them.
 *
 * Without the prune, renaming an item on the Dropdowns tab leaves the opp
 * showing both names — the new one the list now asks for, and the old row
 * that is suddenly "an item of this opp's own". Worse, being the opp's own
 * item is what makes a row worth storing (see coaItemsToStore), so the next
 * edit anywhere in the table would write that empty leftover onto the
 * record. A row is dropped only when it is blank — no dates, not marked N/A
 * — so nothing anybody recorded goes with it, and only when the old list is
 * where it came from, so a name typed into the table and not yet committed
 * to the list survives a change arriving from another tab.
 */
export function applyCoaCatalogChange(rows, prevCatalog, nextCatalog) {
  const retired = new Set(coaCatalogNames(prevCatalog).map(n => n.toLowerCase()));
  for (const name of coaCatalogNames(nextCatalog)) retired.delete(name.toLowerCase());
  const kept = normalizeCoaItems(rows).filter(r => !(
    r.item && !r.requested && !r.approved && !r.na && retired.has(r.item.toLowerCase())
  ));
  return withCoaCatalog(kept, nextCatalog);
}

/**
 * The rows to show for an opp: the catalog, carrying what this opp recorded.
 *
 * Seeding rather than starting empty is what makes the table always visible —
 * the same reason the timelines editor seeds a row per timeline-driven
 * service. A row that is only a seed is not stored (see coaItemsToStore), so
 * an opp nobody has touched carries no COA data.
 */
export function coaItemsForOpp(opp, catalog = DEFAULT_COA_ITEMS) {
  return withCoaCatalog(opp?._coaItems, catalog);
}

/**
 * The rows worth writing to the record.
 *
 * A row with nothing on it is the editor's empty form row, not a COA item:
 * kept in local state so it stays on screen while it is typed into, dropped on
 * the way to the record so an opp never stores a row of blanks. A row carrying
 * only a catalog name is the same thing — nothing has been recorded about it
 * yet, and the catalog will put it back on the table anyway — so an untouched
 * opp stays untouched however long the catalog grows.
 */
export function coaItemsToStore(list, catalog = DEFAULT_COA_ITEMS) {
  const names = new Set(coaCatalogNames(catalog).map(n => n.toLowerCase()));
  return normalizeCoaItems(list)
    .filter(r => r.requested || r.approved || (r.na && r.item)
      || (r.item && !names.has(r.item.toLowerCase())));
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
 * What an opp still has to settle: every catalog item, plus anything of its
 * own, that is neither approved nor marked N/A.
 *
 * The catalog matters because of how little gets stored. Its items are the
 * questions every opp is asked, and a row carrying only one of their names is
 * dropped on the way to the record (coaItemsToStore) precisely because
 * nothing has been recorded about it — so "the record has no 3% esc row" and
 * "nobody has dealt with the 3% escalator" are the same state, whether the
 * opp has other items stored or nothing at all. Answering it — an approved
 * date, or the N/A button — is what settles it.
 */
export function outstandingCoaItems(opp, catalog = DEFAULT_COA_ITEMS) {
  return unsettledCoaItems(withCoaCatalog(opp?._coaItems, catalog));
}

/**
 * One line for the section header: what is done and what is outstanding.
 *
 * Counts only rows that have been recorded — a catalog row nobody has filled
 * in is not an outstanding approval, and counting it would put a number on
 * the header of every opp in the book. Rows marked N/A are counted
 * separately: they are settled, but they were never approvals.
 */
export function coaItemsSummary(list, nowMs = Date.now(), catalog = DEFAULT_COA_ITEMS) {
  const stored = coaItemsToStore(list, catalog);
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
