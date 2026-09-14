// Take the clients ticked "Don't Track" on the Clients tab out of the
// Weekly Progress charts.
//
// The flag already removes a client from service coverage and from Deal
// Sizing (see serviceCoverage.js). Progress was the page still counting
// them: an account nobody is working drags every percentage down, and a
// chart whose job is "is the book getting warmer" should not be measuring
// accounts that were deliberately set aside.
//
// This works on the SAVED WEEKS rather than on the account list, for one
// reason: it has to change the whole line, not just today's point. Each
// week's snapshot stores the accounts behind every number (snapshot
// `details`), so a week from April can be re-answered today with a client
// that was ticked yesterday left out, and the trend stays comparable.
// That also makes the flag reversible: nothing is rewritten in Firestore,
// so unticking a client puts it back on every point at once.
//
// Two numbers it cannot re-answer, both because the week never recorded
// the accounts behind them:
//
//   • Tier 3 totals. `details` carries Tier 1 and Tier 2 by name; Tier 3
//     is only ever a count.
//   • The No-Opps Activity chart, which stores summed activity events
//     rather than a per-account breakdown.
//
// Those keep the number the week was saved with. Callers that show a
// "left out" note should say so rather than imply the whole page is
// filtered (untrackedNoteFor builds that line).

// Clients-tab maps are keyed by the company name trimmed + lowercased,
// the same normalization clientManagerStore writes with.
function key(company) {
  return String(company || '').trim().toLowerCase();
}

// The ticked companies as a Set, so a week's lists can be scanned without
// re-reading the map per name. Only truthy entries count: unticking writes
// a delete, but an older mirror can still carry `false`.
export function untrackedNameSet(untrackedMap) {
  const out = new Set();
  for (const [k, v] of Object.entries(untrackedMap || {})) {
    if (v) out.add(key(k));
  }
  return out;
}

// A detail list holds either company names or {company, status} objects
// (the Inactive lists). One reader for both.
function nameOf(entry) {
  return key(typeof entry === 'string' ? entry : entry?.company);
}

// Every metric a saved week records by name, as [yes list, no list, count
// field, percent field]. The count field is the numerator; the percent is
// that numerator over the tier's total, which is what the cards and the
// four percentage charts plot.
const METRICS = [
  { tier: 't1', yes: 't1WithContacts', no: 't1NoContacts', count: 't1WithContacts', pct: 't1ContactPct' },
  { tier: 't2', yes: 't2WithContacts', no: 't2NoContacts', count: 't2WithContacts', pct: 't2ContactPct' },
  { tier: 't1', yes: 't1WithDM', no: 't1NoDM', count: 't1WithDM', pct: 't1DMPct' },
  { tier: 't2', yes: 't2WithDM', no: 't2NoDM', count: 't2WithDM', pct: 't2DMPct' },
  { tier: 't1', yes: 't1Connected', no: 't1NotConnected', count: 't1Connected', pct: 't1ConnectedPct' },
  { tier: 't2', yes: 't2Connected', no: 't2NotConnected', count: 't2Connected', pct: 't2ConnectedPct' },
  // Inactive stores only its numerator: the accounts that ARE inactive.
  // Its denominator is the tier total, same as the rest.
  { tier: 't1', yes: 't1Inactive', no: null, count: 't1Inactive', pct: 't1InactivePct' },
  { tier: 't2', yes: 't2Inactive', no: null, count: 't2Inactive', pct: 't2InactivePct' },
];

const TIER_TOTAL = { t1: 't1Total', t2: 't2Total' };

function listOf(details, listKey) {
  const v = listKey ? details?.[listKey] : null;
  return Array.isArray(v) ? v : [];
}

/**
 * Which ticked companies a saved week holds, per tier.
 *
 * Every yes/no pair covers the whole tier, so the union across the
 * metrics is the tier's roster for that week - taking the union rather
 * than one pair means a week saved before a metric existed still finds
 * its ticked accounts through the metrics it does have.
 *
 * Returns { t1: Set, t2: Set } of normalized names.
 */
function untrackedByTier(details, nameSet) {
  const out = { t1: new Set(), t2: new Set() };
  if (!details || nameSet.size === 0) return out;
  for (const m of METRICS) {
    for (const listKey of [m.yes, m.no]) {
      for (const entry of listOf(details, listKey)) {
        const n = nameOf(entry);
        if (n && nameSet.has(n)) out[m.tier].add(n);
      }
    }
  }
  return out;
}

function pctOf(count, total) {
  return total > 0 ? Math.round((count / total) * 100) : 0;
}

/**
 * One saved week with the ticked clients taken out.
 *
 * Numbers are adjusted by SUBTRACTING what the week's own lists say was
 * ticked, rather than recounted from those lists. A number on this page
 * can have been typed by hand (the Weekly History table's cells are
 * editable), and subtracting keeps a hand-typed number as the thing being
 * corrected instead of quietly replacing it with a recount.
 *
 * Returns the week untouched when it holds nothing ticked, so a week with
 * no exclusions is byte-for-byte what was saved.
 */
export function excludeUntrackedFromWeek(week, nameSet) {
  if (!week || !nameSet || nameSet.size === 0) return week;
  const dropped = untrackedByTier(week.details, nameSet);
  if (dropped.t1.size === 0 && dropped.t2.size === 0) return week;

  const next = { ...week };
  const details = { ...(week.details || {}) };

  // Denominators first: the percentages below divide by them.
  for (const [tier, totalField] of Object.entries(TIER_TOTAL)) {
    if (typeof week[totalField] === 'number') {
      next[totalField] = Math.max(0, week[totalField] - dropped[tier].size);
    }
  }

  for (const m of METRICS) {
    for (const listKey of [m.yes, m.no]) {
      if (!listKey) continue;
      const list = listOf(week.details, listKey);
      if (!list.length) continue;
      details[listKey] = list.filter(e => !nameSet.has(nameOf(e)));
    }
    const removed = listOf(week.details, m.yes).length - listOf(details, m.yes).length;
    if (typeof week[m.count] !== 'number') continue;
    next[m.count] = Math.max(0, week[m.count] - removed);
    // The percentage is only re-answered when both halves of it are known.
    // A week missing its tier total keeps the percentage it was saved with
    // rather than being handed a 0 that would read as a collapse.
    if (typeof week[m.pct] === 'number' && typeof next[TIER_TOTAL[m.tier]] === 'number') {
      next[m.pct] = pctOf(next[m.count], next[TIER_TOTAL[m.tier]]);
    }
  }

  next.details = details;
  return next;
}

/**
 * Every saved week with the ticked clients taken out, plus what was left
 * out so the page can say so.
 *
 * `names` is the ticked companies actually found on the most recent week,
 * spelled as that week spelled them - the list worth naming in a tooltip,
 * since a client ticked years after it left the book would otherwise be
 * announced as missing from a chart it was never on.
 */
export function excludeUntrackedFromWeeks(weeks, untrackedMap) {
  const list = Array.isArray(weeks) ? weeks : [];
  const nameSet = untrackedNameSet(untrackedMap);
  if (nameSet.size === 0) return { weeks: list, names: [], weeksAdjusted: 0 };

  let weeksAdjusted = 0;
  const out = list.map(w => {
    const next = excludeUntrackedFromWeek(w, nameSet);
    if (next !== w) weeksAdjusted += 1;
    return next;
  });

  const latest = list.length ? list[list.length - 1] : null;
  const names = [];
  const seen = new Set();
  for (const m of METRICS) {
    for (const listKey of [m.yes, m.no]) {
      for (const entry of listOf(latest?.details, listKey)) {
        const n = nameOf(entry);
        if (!n || !nameSet.has(n) || seen.has(n)) continue;
        seen.add(n);
        names.push(typeof entry === 'string' ? entry : entry.company);
      }
    }
  }
  names.sort((a, b) => String(a).localeCompare(String(b)));
  return { weeks: out, names, weeksAdjusted };
}

/**
 * The line the page prints above the charts, or '' when there is nothing
 * to say. Kept here so the wording and the arithmetic stay together.
 */
export function untrackedNoteFor({ names = [], weeksAdjusted = 0 } = {}) {
  if (!names.length && !weeksAdjusted) return '';
  if (!names.length) {
    return 'Clients ticked "Don\'t Track" on the Clients tab are left out of these charts.';
  }
  const n = names.length;
  return `Leaves out ${n} client${n === 1 ? '' : 's'} ticked "Don't Track" on the Clients tab`
    + `${weeksAdjusted > 0 ? `, on every week that recorded ${n === 1 ? 'it' : 'them'}` : ''}.`;
}
