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
//   - Anything already ANSWERED drops out of the money. A service we sold
//     them is not potential, and neither is one they turned down or one
//     marked N/A. Three different answers, all of them an answer, and none
//     of them something to go and sell.
//
//     A service in flight is not one of them. Exploring, Qualifying,
//     Quoting, Proposed: nobody has said yes and nobody has said no, so it
//     is still the account's potential and it is still what somebody is
//     working on this week. It counts here, and the biggest deal on the
//     account may well be one of them.
//
//   - The answered services are still SHOWN. They are priced and ranked
//     alongside the rest so the table reads as the whole catalogue in size
//     order, and the page can answer "what did we decide about that one?"
//     - but they are greyed, they cannot be ticked into an estimate, and
//     they can never be the biggest deal, because none of that is money
//     left to win.
//
// Then the open services are ranked by what they are worth, because a list
// of a hundred of them in alphabetical order answers nothing. The
// ranking is by the Year 1 fee - what the account bills in the first twelve
// months, which is the figure this page is read for - and at the MIDDLE of
// a quoted range, which is the deal most likely to be signed. A service
// priced "nothing up to half a million" is worth a quarter of a million on
// that reading, so it still does not outrank one reliably worth four
// hundred thousand; what it no longer does is rank at nothing.
//
// Pure, so the decisions worth arguing about (what counts as decided, what
// outranks what) can be read and tested without a browser.

import { autoAddListFor, collectAutoAdds } from './serviceAutoAdd.js';
import { exploredStatus } from './clientDealSizing.js';
import { serviceStatusBucket } from './serviceStatusColors.js';
import { basisFor, estimateScope, pricingFor, pricingLines } from './servicePricing.js';

// The outcomes that close a service off for good: we sold it, they turned
// it down, or it does not apply to them. An in-flight status is
// deliberately not here - see the note at the top - and neither is an
// empty one.
export const CLOSED_BUCKETS = new Set(['sold', 'notSold', 'na']);

/**
 * What the company record already says about one service.
 *
 * The status is the company page's own effective status - a manual entry in
 * servicesExplored wins, otherwise whatever the account's opportunities
 * imply - so this page and that page can never disagree about whether a
 * service has been dealt with.
 *
 * `fromOpp` says which record is holding that status, because the two are
 * undone in different places: a stage comes off the opportunity, a typed
 * status off the company card. A page explaining why a service is not on it
 * has to be able to say which one to go and look at.
 *
 * @param oppStages Map<serviceName, stage> for THIS client, or null when no
 *                  opps are loaded; then only the manual statuses are read.
 */
export function serviceDecision(client, name, oppStages = null) {
  const manual = String((client?.servicesExplored || {})[name] ?? '').trim();
  const status = exploredStatus(client, name, oppStages);
  const statusBucket = serviceStatusBucket(status);
  return {
    status,
    statusBucket,
    decided: CLOSED_BUCKETS.has(statusBucket),
    // Being worked on right now: a status, but not an answer. It stays in
    // the potential, which is the one thing that separates this from a
    // report of what has been closed out.
    inFlight: statusBucket === 'inProgress',
    fromOpp: !!status && !(manual && manual !== '-'),
  };
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

/**
 * Services counted by outcome bucket, for a tile that has to say why. Runs
 * over either half: the answered ones to say what was decided, the open
 * ones to say how many of them are already being worked on.
 */
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
 * By Year 1 fee: the first twelve months is what this page is asked for,
 * and a term total answers a different question with a bigger number. A
 * five-year recurring service and a one-off project of the same annual size
 * are not the same prize over a contract, but they are the same first year,
 * and the first year is the one being compared here.
 *
 * At the MIDDLE of a quoted range: a range has no single answer to "how big
 * is this one", and its two ends answer different questions - the low end
 * is the floor we would still take, the high end is the ask. Ranking on the
 * top would put the service we know least about at the head of the list;
 * ranking on the bottom prices a service quoted "nothing up to half a
 * million" at nothing, which is not what anybody thinks it is worth. The
 * midpoint is the figure the table shows, so it is the figure the order has
 * to follow, or the list would disagree with the column it is sorted on.
 *
 * The low end breaks a tie on the midpoint, so of two services averaging the
 * same the surer one leads. Then the top of the range, then the term value,
 * then the name so two runs of the same account rank identically.
 *
 * A service the rate card cannot price sorts to the bottom rather than to
 * zero-and-therefore-nowhere: it is not worth nothing, it is unknown, and
 * the difference is the whole reason to go and price it.
 */
export function rankByPotential(lines = []) {
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  // The middle of the line's own range. A line with no high end is not half
  // a line: it is worth what it says, which is both ends of it.
  const mid = (l) => (num(l?.fee) + (Number.isFinite(Number(l?.feeHigh)) ? num(l.feeHigh) : num(l?.fee))) / 2;
  return [...lines].sort((a, b) => {
    if (!!a.priced !== !!b.priced) return a.priced ? -1 : 1;
    return mid(b) - mid(a)
      || num(b.fee) - num(a.fee)
      || num(b.feeHigh) - num(a.feeHigh)
      || num(b.value) - num(a.value)
      || String(a.name).localeCompare(String(b.name));
  });
}

/**
 * The open services gathered into bundles: a lead service and whatever its
 * Auto-add Services cell drags in behind it.
 *
 * Some services are never sold alone - putting CSRD readiness in a scope
 * puts the GHG inventory behind it in scope too - and the Services tab
 * already records that. A page ranking what an account is worth has to
 * price the bundle, because the bundle is what gets sold: quoting the lead
 * service on its own understates it by however much comes with it.
 *
 * The hard part is counting each service ONCE. Two leads can name the same
 * add-on, a chain can run three deep, and two services can name each other.
 * So this is a partition, not a lookup, and it is built in that order:
 *
 *   1. A service another open service names is not a lead. The cell has a
 *      direction - it says "sell this and that comes with it" - and the
 *      thing you sell is the thing the row should be about. Size does not
 *      override that: a small service that drags in a large one is a
 *      bigger sale than the large one alone, and reads as one.
 *   2. Leads are taken biggest Year 1 fee first, so when two of them name
 *      the same add-on it hangs off the one it is most likely being sold
 *      with. Whoever gets there first keeps it; nobody gets it twice.
 *   3. Anything still unclaimed leads its own bundle, biggest first. That
 *      is the cycle case - two services naming each other are both "named
 *      by another", and without this pass neither would be a lead and the
 *      page would lose them both.
 *
 * Add-ons that are not open are left out of the money. If they already buy
 * Client management, selling them Bill payment does not bring that revenue
 * with it - the bundle still includes it, but the account is not worth it
 * again, and this page only ever counts what is not there yet.
 *
 * @param lines     the estimate lines for the open services, by name
 * @param overrides settings.serviceOverrides, which is where the cells live
 */
export function bundleAutoAdds(lines = [], overrides = null, names = null) {
  const byName = new Map(lines.map(l => [l.name, l]));
  const known = names || lines.map(l => l.name);
  const spell = (() => {
    const byLower = new Map(known.map(n => [String(n).toLowerCase(), n]));
    return (n) => byLower.get(String(n || '').trim().toLowerCase()) || n;
  })();
  const year1 = (l) => (l && l.priced ? Number(l.fee) || 0 : 0);

  // Biggest own fee first. The name breaks ties so a book where nothing is
  // priced still bundles the same way on every run rather than shuffling
  // with whatever order the catalogue came in.
  const order = [...lines].sort((a, b) => year1(b) - year1(a)
    || String(a.name).localeCompare(String(b.name)));

  // Services some OTHER open service names. Directly named, not
  // transitively: the question is whether anything sells this, and a
  // service reached only through a chain is sold by the head of that chain,
  // which is already covered by its own entry here.
  const namedByOther = new Set();
  for (const line of lines) {
    for (const raw of autoAddListFor(line.name, overrides, known)) {
      const name = spell(raw);
      if (name !== line.name && byName.has(name)) namedByOther.add(name);
    }
  }

  const claimed = new Set();
  const bundles = [];
  // Leads first, then whatever a cycle left over. Two passes rather than
  // one over everything: a service nothing names has to get its chance to
  // claim before a service that is only unclaimed because its cycle
  // partner has not been reached yet.
  const passes = [order.filter(l => !namedByOther.has(l.name)), order];
  for (const pass of passes) for (const line of pass) {
    if (claimed.has(line.name)) continue;
    claimed.add(line.name);
    // `present` is everything already spoken for, and `stopAtPresent` says
    // to take none of it and walk through none of it - so a chain stops at
    // the first service another bundle already holds instead of dragging
    // that bundle's tail in behind it. The Scope picker asks for the
    // opposite, because a person ticking a service wants everything it
    // implies; here the same money must land in exactly one bundle.
    const pulled = collectAutoAdds([line.name], overrides, {
      canonical: spell,
      present: [...claimed],
      names: known,
      stopAtPresent: true,
    });
    const adds = [];
    for (const name of pulled) {
      const child = byName.get(name);
      // Not on the page: already sold, turned down, N/A, or in flight. It
      // comes with the sale but it is not new money, so it is named and
      // not counted.
      if (!child) { adds.push({ name, line: null, open: false }); continue; }
      claimed.add(name);
      adds.push({ name, line: child, open: true });
    }
    bundles.push({ lead: line, adds });
  }
  return bundles;
}

/** A bundle's figures: the lead plus every open add-on, at both ends. */
export function bundleTotals({ lead, adds = [] }) {
  const open = adds.filter(a => a.open && a.line?.priced);
  const sum = (key) => (lead?.priced ? Number(lead[key]) || 0 : 0)
    + open.reduce((n, a) => n + (Number(a.line[key]) || 0), 0);
  return {
    // Priced when ANY part of it is: a lead with no rate that drags in two
    // services that have one is worth what those two are worth, and
    // reporting it as unpriced would lose them.
    priced: !!lead?.priced || open.length > 0,
    fee: sum('fee'),
    feeHigh: sum('feeHigh'),
    value: sum('value'),
    valueHigh: sum('valueHigh'),
    // How many of the add-ons brought money, so a row can say "+3" and
    // mean it.
    addCount: adds.length,
    openAddCount: open.length,
  };
}

/** Whether any line on a service's card is priced as a cut of a deal. */
export function pricesOnDeal(name, pricing, bases) {
  return pricingLines(pricingFor(pricing, name, bases))
    .some(line => basisFor(line.basis, bases)?.kind === 'percent');
}

/**
 * What each percentage-priced service is a percentage OF.
 *
 * Client management is not sold on its own. It comes with a bill payment
 * deal, and the card prices it the way it is actually quoted: a cut of that
 * deal. So the deal is the bundle it was auto-added into, and the figure it
 * takes its cut of is the Year 1 fee of everything else in that bundle -
 * the lead and the other add-ons, whatever they are priced on.
 *
 * Both ends of it, because that base is a range: a cut of a deal worth
 * "$44k to $87k" is itself worth a range, and pinning it to either end
 * alone would quote it at a deal nobody is offering.
 *
 * Percentage services are kept out of their own base. Two of them on one
 * bundle would otherwise each be a cut of a figure that includes the other,
 * which has no answer - and a service cannot be a percentage of itself.
 *
 * A percentage service that leads its own bundle gets no entry at all:
 * there is no deal under it to be a cut of, and it prices at nothing and
 * says why, which is the truth rather than a figure invented from a box
 * somebody typed in once.
 */
export function dealSizesByBundle(bundles = [], isPercent = () => false) {
  const out = new Map();
  for (const { lead, adds = [] } of bundles) {
    const members = [lead, ...adds.filter(a => a.open).map(a => a.line)].filter(Boolean);
    const cuts = members.filter(m => isPercent(m.name));
    if (cuts.length === 0) continue;
    let low = 0;
    let high = 0;
    for (const m of members) {
      if (isPercent(m.name) || !m.priced) continue;
      low += Number(m.fee) || 0;
      high += Number(m.feeHigh) || 0;
    }
    if (low <= 0 && high <= 0) continue;
    for (const m of cuts) out.set(m.name, { low, high });
  }
  return out;
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
  // settings.serviceOverrides, where each service's Auto-add Services cell
  // lives. Left out, nothing bundles and every service leads its own row -
  // which is what this page did before bundling existed.
  overrides = null,
} = {}) {
  const { open, decided } = splitByDecision(client, serviceRows, oppStages);
  const price = (dealSizeByService) => estimateScope({
    rows: open,
    services: open.map(r => r.name),
    pricing, counts, dealSize, bases, serviceUnits, dealSizeByService,
  });

  // What actually gets sold: a lead service and whatever its Auto-add cell
  // drags in behind it. The rows, the ranking and the totals are all in
  // bundles from here down, because a lead quoted without its add-ons is
  // quoted short by however much comes with it.
  //
  // Which takes two passes, because a percentage service is a cut of the
  // bundle it comes with and the bundle is not known until everything else
  // in it has been priced. The first pass prices what the card can price on
  // its own - a percentage service comes out at nothing there, having no
  // deal yet - and the second re-prices those against the bundle the first
  // pass put them in.
  const first = price(null);
  const shape = bundleAutoAdds(first.lines, overrides, serviceRows.map(r => r.name));
  const dealSizes = dealSizesByBundle(shape, name => pricesOnDeal(name, pricing, bases));
  const estimate = dealSizes.size ? price(dealSizes) : first;

  // The same bundles, re-priced. The shape is settled on the first pass and
  // kept: re-bundling on the second would let a fee that was worked out
  // FROM a bundle go on to decide what that bundle is, and a service whose
  // cut of a deal made it the biggest thing in it would lead the bundle it
  // is a percentage of.
  const repriced = new Map(estimate.lines.map(l => [l.name, l]));
  const bundles = shape.map(({ lead, adds }) => {
    const b = {
      lead: repriced.get(lead.name) || lead,
      adds: adds.map(a => (a.open ? { ...a, line: repriced.get(a.name) || a.line } : a)),
    };
    return { ...b, totals: bundleTotals(b) };
  });
  // The ranking runs on the bundle's money, not the lead's own: a service
  // worth little that pulls in two big ones outranks one worth slightly
  // more alone, and it should, because that is the bigger sale.
  const ranked = rankByPotential(bundles.map(b => ({
    ...b.totals, name: b.lead.name, bundle: b,
  })));
  const rank = new Map(ranked.map((l, i) => [l.name, l.priced ? i + 1 : null]));
  // Every bundle by its lead, so a row can find its own add-ons without
  // searching the list.
  const bundleOf = new Map(ranked.map(l => [l.name, l.bundle]));
  // The single biggest thing left to sell them, named. The ranking already
  // puts it first, but first-in-a-list is something a reader has to look
  // for, and this is the one line of the page worth reading out in a
  // pipeline review - so it is stated rather than implied.
  //
  // Only ever a PRICED service: the unpriced ones sort to the bottom, so
  // ranked[0] on a book with no rates at all would name a service worth an
  // unknown amount as the biggest deal on the account, which is a claim
  // nothing supports.
  const top = ranked.length && ranked[0].priced ? ranked[0] : null;

  // The answered services, priced and put in size order of their own.
  //
  // None of this is potential and none of it reaches a total, a rank or
  // the biggest deal above. It exists because the table still shows these
  // rows, greyed, and a greyed row with no figure on it would be a service
  // the page had dropped rather than one it had answered - and "what did
  // we decide about that one, and what was it worth?" is a question a
  // pipeline review asks out loud.
  //
  // Priced one at a time rather than bundled. A bundle is a sale being
  // proposed, and these are not on offer; the money is here to sort the
  // row, not to quote it. Percentage services among them are read against
  // the same bundle deals the open pass worked out, so a service that sits
  // in one is priced consistently whichever side of the line it fell.
  const closedEstimate = decided.length
    ? estimateScope({
      rows: decided,
      services: decided.map(r => r.name),
      pricing, counts, dealSize, bases, serviceUnits, dealSizeByService: dealSizes,
    })
    : null;
  const closedLines = new Map((closedEstimate?.lines || []).map(l => [l.name, l]));
  const closed = rankByPotential(decided.map(row => {
    const lead = closedLines.get(row.name)
      || { name: row.name, priced: false, fee: 0, feeHigh: 0, value: 0, valueHigh: 0 };
    const bundle = { lead, adds: [], totals: bundleTotals({ lead, adds: [] }) };
    return {
      ...bundle.totals,
      name: row.name,
      // The catalogue row and the priced line both, so a table can build a
      // closed row out of exactly what it builds an open one out of.
      row,
      line: lead,
      bundle,
      status: row.status,
      statusBucket: row.statusBucket,
    };
  }));
  return {
    top,
    closed,
    closedEstimate,
    bundles,
    bundleOf,
    // What each percentage service turned out to be a cut of, so a caller
    // pricing a subset of these services - the ticked scope, say - prices
    // them against the same deal this page ranked them on rather than
    // against nothing.
    dealSizes,
    // The services that are only ever shown inside somebody else's bundle.
    // The table drops them as rows of their own: they are counted in the
    // lead's figure, and a second row for them would count them twice.
    bundledNames: new Set(bundles.flatMap(b => b.adds.filter(a => a.open).map(a => a.name))),
    open,
    decided,
    decidedCounts: decidedCounts(decided),
    // The open services counted the same way, so a page can say how many of
    // them are already being worked on rather than only how many there are.
    // The two buckets that can show up here are inProgress and none.
    openCounts: decidedCounts(open),
    estimate,
    ranked,
    rank,
    // The services the card has answered, by name, so a caller can say which
    // rather than only how many - and so a table can tell in one lookup
    // whether a row is one of the greyed ones.
    decidedNames: new Set(decided.map(d => d.name)),
    // The effective status behind every service on the page, answered or
    // not, so a row can say what it is without going back to the client
    // record and working the opportunities out a second time. Empty for a
    // service nobody has touched.
    statusOf: new Map([...open, ...decided].filter(r => r.status).map(r => [r.name, r.status])),
  };
}
