// The opps tied to a company, as the company popup lists them.
//
// The popup already read the Opps 2 rows whose Account matches the company —
// it has done for a while, to work out which services a scope has been sold
// or quoted into (that is what paints the Services Explored grid). What it
// never did was show the opps themselves, so "what is actually open with
// these people" meant leaving the card and filtering the Opps tab by hand.
//
// This is the shaping half of that list: which fields make a row, what order
// the rows come in, and what the collapsed header says without opening it.
// Matching an Account to a company is deliberately NOT here — the popup has
// its own tolerant matcher and uses it for the scope grid, and a second
// opinion about which opps are this company's is exactly what would make the
// two disagree.
//
// Pure, so the ordering can be tested without a browser.

import { isActiveOppStage, activeStageRank, isRealOppStage } from './oppStages.js';

// The Opps 2 keys this reads. 'BFO Link' holds the BFO opportunity NAME
// rather than a URL (the Opps tab labels it "BFO Opportunity Name"), and
// 'Quoted Amount' is what that tab shows as "Deal Size" — the labels here
// follow the tab, so a row reads the same in both places.
const NAME_KEY = 'BFO Link';
const AMOUNT_KEY = 'Quoted Amount';

// A dash is how a blank arrives from an export, and the Opps tab already
// treats it as "nothing here" rather than as a value.
function cell(record, key) {
  const value = String(record?.[key] ?? '').trim();
  return value === '-' ? '' : value;
}

// Milliseconds for sorting, 0 when the cell is blank or unparseable. Dates
// are shown exactly as they are stored — a row that reads "6/24" on the Opps
// tab reads "6/24" here — so this only ever decides order.
function dateValue(text) {
  const t = Date.parse(String(text || '').trim());
  return Number.isNaN(t) ? 0 : t;
}

/**
 * One row per opp, in the order the popup lists them.
 *
 * Live opps first, furthest along leading, because the question the list
 * answers is "what is in play with these people" — a deal at Agreement Sent
 * is the answer more often than one at Lead, and both beat a deal that closed
 * two years ago. Closed opps keep their place at the bottom, most recently
 * closed first: they are history, and history is read newest first.
 */
export function companyOppRows(records) {
  return (records || [])
    .filter(r => r && typeof r === 'object')
    .map((r, i) => {
      const stage = cell(r, 'Stage');
      const start = cell(r, 'Start Date');
      const close = cell(r, 'Close Date');
      return {
        id: r._id != null ? String(r._id) : `opp-${i}`,
        name: cell(r, NAME_KEY),
        account: cell(r, 'Account'),
        scope: cell(r, 'Scope'),
        stage,
        status: cell(r, 'Status'),
        amount: cell(r, AMOUNT_KEY),
        startDate: start,
        closeDate: close,
        // A stage that is neither live nor a real stage at all (a broken
        // cell, a blank) is not counted as closed — it is counted as
        // nothing, and sorts with the live ones so it can't hide at the
        // bottom of a long list.
        active: isActiveOppStage(stage) || !isRealOppStage(stage),
        rank: activeStageRank(stage),
        startAt: dateValue(start),
        closeAt: dateValue(close),
      };
    })
    .sort((a, b) => {
      if (a.active !== b.active) return a.active ? -1 : 1;
      if (a.active) {
        if (b.rank !== a.rank) return b.rank - a.rank;
        return b.startAt - a.startAt;
      }
      // Closed: most recently closed first, and one with no close date
      // recorded falls back to when it started rather than to the bottom.
      return (b.closeAt || b.startAt) - (a.closeAt || a.startAt);
    });
}

/**
 * What the collapsed header says: how many opps there are and how many of
 * them are still live.
 *
 * Open vs closed rather than a bare total, because a company with six closed
 * opps and none open is a very different card from one with six open — and
 * the whole point of a collapsed section is that it has to be worth opening
 * from the outside.
 */
export function summarizeCompanyOpps(rows) {
  const total = (rows || []).length;
  const open = (rows || []).filter(r => r.active).length;
  return { total, open, closed: total - open };
}
