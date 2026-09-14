// Account Potential - what one company is still worth to us.
//
// The Deal Pricing tab this grew out of priced a hypothetical: type the
// sites and accounts by hand, tick the services, read the deal off the bar.
// That is a useful calculator and a poor answer to the question actually
// asked in a pipeline review, which is "we have this account - where is the
// money we have not gone after yet?"
//
// So this names a company and works the rest out. Two things change once a
// company is on the page:
//
//   - Its own figures price the services. Sites, accounts, meters,
//     equipment and MWh come off the company record instead of being typed,
//     which is what makes a number here checkable against something.
//
//   - Anything already decided drops out. A service we sold them is not
//     potential, and neither is one they turned down or one marked N/A -
//     and nor, less obviously, is one already in flight, because the money
//     in a live opp is in the pipeline already and counting it here would
//     be counting it twice. What is left is the whitespace: services
//     nobody has ruled on either way.
//
// Then the whitespace is ranked by what it is worth, because a list of a
// hundred untouched services in alphabetical order answers nothing. The
// ranking is by Est. Deal Value over the contract term - the whole prize -
// and at the LOW end of a quoted range, so a service priced "nothing up to
// half a million" cannot outrank one that is reliably worth four hundred
// thousand.
//
// Pure, so the decisions worth arguing about (what counts as decided, what
// outranks what) can be read and tested without a browser.

import { exploredStatus } from './clientDealSizing.js';
import { serviceStatusBucket } from './serviceStatusColors.js';
import { estimateScope } from './servicePricing.js';

/**
 * What the company record already says about one service.
 *
 * The status is the company page's own effective status - a manual entry in
 * servicesExplored wins, otherwise whatever the account's opportunities
 * imply - so this page and that page can never disagree about whether a
 * service has been dealt with.
 *
 * @param oppStages Map<serviceName, stage> for THIS client, or null when no
 *                  opps are loaded; then only the manual statuses are read.
 */
export function serviceDecision(client, name, oppStages = null) {
  const status = exploredStatus(client, name, oppStages);
  const statusBucket = serviceStatusBucket(status);
  return { status, statusBucket, decided: statusBucket !== 'none' };
}

/**
 * The catalogue split into what is still open and what has been decided.
 *
 * `statusBucket` rather than `bucket` on the way out: a service row already
 * carries a `bucket`, and that one is the service bucket it is filed under
 * (DATA, GHG Reporting). Two different things, and one of them silently
 * overwriting the other is the kind of bug that prices a page wrong without
 * ever looking wrong.
 *
 * With no client this returns everything as open, which is what the page
 * shows before a company is picked.
 */
export function splitByDecision(client, serviceRows = [], oppStages = null) {
  const open = [];
  const decided = [];
  for (const row of serviceRows) {
    const d = serviceDecision(client, row.name, oppStages);
    (d.decided ? decided : open).push({ ...row, ...d });
  }
  return { open, decided };
}

/** The decided services counted by outcome, for a tile that has to say why. */
export function decidedCounts(decided = []) {
  const counts = { sold: 0, inProgress: 0, notSold: 0, na: 0 };
  for (const d of decided) {
    if (counts[d.statusBucket] !== undefined) counts[d.statusBucket] += 1;
  }
  return counts;
}

/**
 * The estimate lines in prize order, biggest first.
 *
 * By Est. Deal Value rather than Year 1, because the question is what the
 * account is worth rather than what it bills in the first twelve months,
 * and a five-year recurring service and a one-off project of the same
 * annual size are not the same prize.
 *
 * At the LOW end first: a range is an admission of uncertainty, and ranking
 * on its top would put the service we know least about at the head of the
 * list. The high end breaks ties, then Year 1, then the name so two runs of
 * the same account rank identically.
 *
 * A service the rate card cannot price sorts to the bottom rather than to
 * zero-and-therefore-nowhere: it is not worth nothing, it is unknown, and
 * the difference is the whole reason to go and price it.
 */
export function rankByPotential(lines = []) {
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  return [...lines].sort((a, b) => {
    if (!!a.priced !== !!b.priced) return a.priced ? -1 : 1;
    return num(b.value) - num(a.value)
      || num(b.valueHigh) - num(a.valueHigh)
      || num(b.fee) - num(a.fee)
      || String(a.name).localeCompare(String(b.name));
  });
}

/**
 * Everything the page states for one company.
 *
 * The estimate covers the OPEN services only, so the totals are the prize
 * rather than the prize plus what we already bill them - see the note at
 * the top about counting pipeline money twice.
 *
 * `rank` is a fixed position on the way out, not the row's index: the table
 * can be re-sorted by name or by bucket and each service still says where
 * it came in the money order, which is the one number the page exists to
 * produce.
 */
export function accountPotential({
  client = null,
  serviceRows = [],
  pricing,
  bases,
  counts,
  dealSize,
  serviceUnits = null,
  oppStages = null,
} = {}) {
  const { open, decided } = splitByDecision(client, serviceRows, oppStages);
  const estimate = estimateScope({
    rows: open,
    services: open.map(r => r.name),
    pricing, counts, dealSize, bases, serviceUnits,
  });
  const ranked = rankByPotential(estimate.lines);
  const rank = new Map(ranked.map((l, i) => [l.name, l.priced ? i + 1 : null]));
  return {
    open,
    decided,
    decidedCounts: decidedCounts(decided),
    estimate,
    ranked,
    rank,
    // The services the card has ruled on, by name, so a caller can say which
    // rather than only how many.
    decidedNames: new Set(decided.map(d => d.name)),
  };
}
