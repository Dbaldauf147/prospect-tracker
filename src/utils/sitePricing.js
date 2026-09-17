// Pasting a renewal comparison in from Excel: a row per site, a previous
// deal and an updated one, and what changed between them.
//
// The sheet this reads looks like this, and is pasted straight out of Excel
// with its tabs and its blank cells intact:
//
//        | Previous Pricing                                  | Udpated Pricing
//        | Start   End     NYMEX  $/Dth     Total             | Start   End     NYMEX  $/Dth     Total
//   SYR  | Dec-25  Nov-26         ($0.276)                    | Dec-26  Nov-28         ($0.092)
//
// Two things about that shape drive the whole parser.
//
// The first is that the columns REPEAT. "Start Date" appears once per block,
// so the header is read by finding every "Start Date" and treating each as
// the left edge of a block, rather than by counting columns - the blocks are
// not the same width in the sheet above and there is no reason to expect
// they will be in the next one.
//
// The second is that the interesting columns are usually EMPTY. NYMEX Price
// and Total Price are blank here because nobody had filled them in; that is
// the job this page can do, off the settle table and the forward curve it
// already holds. So a blank is not a parse failure, it is the question. A
// value that IS filled in is kept and used in preference, because somebody
// typing a number into a sheet is asserting something and the page should
// not quietly overrule them.
//
// Accounting parentheses mean negative, here as everywhere: ($0.276) is
// -0.276. The $/Dth column is applied to NYMEX the same way the adder is
// applied on the rest of this page - total = NYMEX + $/Dth - so a negative
// reads as a discount off the index and a positive as a premium over it.

import {
  addMonths, monthKey, monthLabel, priceLookup,
} from './nymexSavings.js';

/** Where a pasted comparison lives in the settings document. */
export const SITE_PRICING_KEY = 'deepDiveSitePricing';

const MAX_SITES = 400;
const MAX_TERM_MONTHS = 600;
const MAX_NAME = 120;

const text = (v, max = MAX_NAME) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/**
 * A number out of a spreadsheet cell.
 *
 * Returns null rather than 0 for a cell with nothing in it, which is the
 * distinction the whole table turns on: an empty NYMEX Price means "work it
 * out", and a zero would mean "the gas was free".
 */
export function parseMoney(raw) {
  const cell = String(raw ?? '').trim();
  if (!cell || cell === '-' || cell === '--') return null;
  // Accounting parentheses are a minus sign.
  const negative = /^\(.*\)$/.test(cell);
  const bare = cell.replace(/[()]/g, '').replace(/[$,\s]/g, '');
  if (!bare || !/[0-9]/.test(bare)) return null;
  const n = Number(bare);
  if (!Number.isFinite(n)) return null;
  return negative ? -Math.abs(n) : n;
}

const MONTH_BY_NAME = new Map([
  ['jan', 1], ['feb', 2], ['mar', 3], ['apr', 4], ['may', 5], ['jun', 6],
  ['jul', 7], ['aug', 8], ['sep', 9], ['oct', 10], ['nov', 11], ['dec', 12],
]);

/**
 * A month out of a spreadsheet cell: "Dec-25", "Dec 2025", "12/25",
 * "2025-12", "December 2025".
 *
 * Excel writes a month cell whichever way its column was formatted, and the
 * person pasting has no idea which that was, so all of them read.
 */
export function parseMonthCell(raw) {
  const cell = String(raw ?? '').trim();
  if (!cell) return null;
  const named = cell.match(/^([A-Za-z]{3,9})[\s\-/.]*(\d{2,4})$/);
  if (named) {
    const month = MONTH_BY_NAME.get(named[1].slice(0, 3).toLowerCase());
    if (month) {
      const y = Number(named[2]);
      return { year: y < 100 ? 2000 + y : y, month };
    }
    return null;
  }
  const numeric = cell.match(/^(\d{1,4})[\s\-/.]+(\d{1,4})$/);
  if (numeric) {
    const a = Number(numeric[1]), b = Number(numeric[2]);
    // The four-digit side is the year. With two short numbers it is
    // month-then-year, which is how a gas term is written.
    if (a > 31) return { year: a < 100 ? 2000 + a : a, month: b >= 1 && b <= 12 ? b : 0 };
    if (a >= 1 && a <= 12) return { year: b < 100 ? 2000 + b : b, month: a };
    return null;
  }
  return null;
}

const isMonth = (m) => !!m && m.month >= 1 && m.month <= 12 && m.year >= 1900 && m.year <= 2400;

/** How many months a term covers, counting both ends. Dec-25 to Nov-26 is 12. */
export function termLength(start, end) {
  if (!isMonth(start) || !isMonth(end)) return 0;
  const n = (end.year * 12 + end.month) - (start.year * 12 + start.month) + 1;
  return n > 0 && n <= MAX_TERM_MONTHS ? n : 0;
}

/**
 * Which of the value roles a header could be naming. More than one means
 * the header is ambiguous and position has to settle it.
 *
 * The sheet this was built for is exactly why: "Total Price (NYMEX minus
 * $Dth)" names a total in the previous block and holds the adder in the
 * updated one, because the updated block's headers are shifted by a column.
 * The text alone cannot tell them apart. Where it sits can.
 */
function candidateRoles(header) {
  const h = header.toLowerCase();
  const roles = [];
  if (/nymex|index/.test(h)) roles.push('nymex');
  if (/\$\s*\/?\s*dth|adder|basis|margin/.test(h)) roles.push('adder');
  if (/total|all[\s-]?in/.test(h)) roles.push('total');
  return roles;
}

const VALUE_ROLES = ['nymex', 'adder', 'total'];

/**
 * Work out what each column of one block does.
 *
 * Start and End are read straight off the header, which is reliable. The
 * three value columns after them are resolved in two passes: a header that
 * can only mean one thing takes that role, and a header that could mean
 * several falls back to WHERE IT SITS - first is the index, second the
 * adder, third the total, which is the order every one of these sheets
 * lays them out in.
 */
function mapBlock(cells, from, to) {
  const cols = {};
  const rest = [];
  for (let c = from; c < to; c++) {
    const header = String(cells[c] ?? '');
    const h = header.toLowerCase();
    if (cols.start == null && /start/.test(h)) { cols.start = c; continue; }
    if (cols.end == null && /end/.test(h)) { cols.end = c; continue; }
    if (cols.volume == null && /volume|annual|dth\s*\/|per\s*year|\/\s*yr/.test(h)) { cols.volume = c; continue; }
    if (!header.trim()) continue;
    rest.push({ col: c, roles: candidateRoles(header) });
  }

  // Pass one: a header that can only mean one thing.
  const ambiguous = [];
  rest.forEach((entry, position) => {
    if (entry.roles.length === 1 && cols[entry.roles[0]] == null) {
      cols[entry.roles[0]] = entry.col;
    } else if (entry.roles.length) {
      ambiguous.push({ ...entry, position });
    }
  });

  // Pass two: an ambiguous header takes the role its position implies, and
  // failing that the first role it could be that is still going spare.
  for (const entry of ambiguous) {
    const byPosition = VALUE_ROLES[entry.position];
    if (byPosition && entry.roles.includes(byPosition) && cols[byPosition] == null) {
      cols[byPosition] = entry.col;
      continue;
    }
    const free = entry.roles.find(role => cols[role] == null);
    if (free) cols[free] = entry.col;
  }
  return cols;
}

/**
 * Read the header and work out where each block starts and which column in
 * it does what.
 *
 * Blocks are found by looking for every "Start Date" rather than by counting
 * columns: the blocks in these sheets are not the same width as each other
 * and there is no reason to expect the next sheet's will be either.
 *
 * Returns null when there is no header to read, which is a paste the caller
 * should refuse rather than guess at.
 */
export function readHeader(rows) {
  for (let i = 0; i < rows.length; i++) {
    const cells = rows[i];
    const startCols = cells
      .map((c, idx) => (/start\s*date|^start$/i.test(String(c).trim()) ? idx : -1))
      .filter(idx => idx >= 0);
    if (startCols.length < 1) continue;

    const blocks = startCols.map((from, b) => {
      const to = b + 1 < startCols.length ? startCols[b + 1] : cells.length;
      return { from, to, cols: mapBlock(cells, from, to) };
    }).filter(block => block.cols.start != null && block.cols.end != null);

    if (!blocks.length) continue;
    return { headerRow: i, blocks };
  }
  return null;
}

/**
 * Read a pasted comparison.
 *
 * Returns { sites, blocks, skipped }. `skipped` holds the lines it could not
 * read so the page can say which, rather than dropping them quietly.
 */
export function parseSitePricing(input) {
  const lines = String(input ?? '').split(/\r?\n/);
  const rows = lines.map(line => (line.includes('\t') ? line.split('\t') : line.split(',')));
  const header = readHeader(rows);
  if (!header) return { sites: [], blocks: 0, skipped: [], error: 'no-header' };

  const skipped = [];
  const sites = [];
  for (let i = header.headerRow + 1; i < rows.length; i++) {
    const cells = rows[i];
    const line = lines[i].trim();
    if (!line) continue;
    const name = text(cells[0]);
    const terms = header.blocks.map(block => {
      const at = (role) => (block.cols[role] == null ? null : cells[block.cols[role]]);
      return {
        start: parseMonthCell(at('start')),
        end: parseMonthCell(at('end')),
        nymex: parseMoney(at('nymex')),
        adder: parseMoney(at('adder')),
        total: parseMoney(at('total')),
        volume: parseMoney(at('volume')),
      };
    });
    // A row earns its place by carrying at least one real term. That keeps
    // the "Previous Pricing / Udpated Pricing" banner row and any stray note
    // out without having to recognise them.
    if (!terms.some(t => termLength(t.start, t.end) > 0)) { skipped.push(text(line, 120)); continue; }
    if (!name) { skipped.push(text(line, 120)); continue; }
    sites.push({ name, terms });
    if (sites.length >= MAX_SITES) break;
  }
  return { sites, blocks: header.blocks.length, skipped };
}

/** A parsed comparison from settings, made safe to price. */
export function normalizeSitePricing(raw) {
  const sites = [];
  for (const site of Array.isArray(raw?.sites) ? raw.sites.slice(0, MAX_SITES) : []) {
    const name = text(site?.name);
    if (!name) continue;
    const terms = (Array.isArray(site?.terms) ? site.terms : []).slice(0, 4).map(t => ({
      start: isMonth(t?.start) ? { year: Math.trunc(t.start.year), month: Math.trunc(t.start.month) } : null,
      end: isMonth(t?.end) ? { year: Math.trunc(t.end.year), month: Math.trunc(t.end.month) } : null,
      nymex: Number.isFinite(t?.nymex) ? t.nymex : null,
      adder: Number.isFinite(t?.adder) ? t.adder : null,
      total: Number.isFinite(t?.total) ? t.total : null,
      volume: Number.isFinite(t?.volume) && t.volume > 0 ? t.volume : null,
    }));
    if (!terms.length) continue;
    sites.push({ name, terms });
  }
  if (!sites.length) return null;
  return { sites, loadedAt: text(raw?.loadedAt, 40) || null };
}

/** Read it out of the settings document. */
export function getSitePricing(settings) {
  return normalizeSitePricing(settings?.[SITE_PRICING_KEY]);
}

/**
 * Average the index across a term, and say where those prices came from.
 *
 * The average is the flat NYMEX a term prices at, which is what the sheet's
 * empty "NYMEX Price" column is asking for.
 */
export function priceTerm(term, priceOf) {
  const months = termLength(term?.start, term?.end);
  if (!months) return null;
  let sum = 0;
  const counts = { settled: 0, forward: 0, assumed: 0 };
  for (let i = 0; i < months; i++) {
    const { year, month } = addMonths(term.start.year, term.start.month, i);
    const { price, source } = priceOf(year, month);
    sum += price;
    counts[source] += 1;
  }
  const computed = sum / months;
  // A number somebody typed into the sheet wins over one worked out here.
  // They may be pricing off a strip we do not hold, and a page that silently
  // replaced their figure with its own would be lying about whose it is.
  const given = Number.isFinite(term.nymex) ? term.nymex : null;
  const nymex = given ?? computed;
  const adder = Number.isFinite(term.adder) ? term.adder : 0;
  const givenTotal = Number.isFinite(term.total) ? term.total : null;
  return {
    months,
    startLabel: monthLabel(term.start.year, term.start.month),
    endLabel: monthLabel(term.end.year, term.end.month),
    startKey: monthKey(term.start.year, term.start.month),
    computedNymex: computed,
    nymex,
    nymexGiven: given != null,
    adder,
    hasAdder: Number.isFinite(term.adder),
    total: givenTotal ?? (nymex + adder),
    totalGiven: givenTotal != null,
    volume: term.volume ?? null,
    counts,
    priced: counts.settled + counts.forward,
  };
}

/**
 * Price every site's terms and work out what the renewal changed.
 *
 * The comparison is deliberately the LAST block against the FIRST: the sheet
 * is laid out left to right in time, and a sheet with three blocks is
 * comparing where it ended up with where it started.
 */
export function priceSitePricing(table, series, forward = [], flat = 0) {
  const priceOf = priceLookup(series, forward, flat);
  const rows = (table?.sites || []).map((site, i) => {
    const terms = site.terms.map(t => priceTerm(t, priceOf));
    const first = terms.find(Boolean) || null;
    const last = [...terms].reverse().find(Boolean) || null;
    const both = first && last && first !== last;
    // Down is a saving: the renewal costs less per Dth than the deal it
    // replaced. Reported per Dth because that is all the sheet carries,
    // unless it also carries a volume.
    const savingPerDth = both ? first.total - last.total : null;
    // The two halves of that saving, which the sheet cannot separate on its
    // own and which are the whole conversation: the market moved, and so did
    // the deal. A renewal can price better than the one before it purely
    // because gas got cheaper, and a negotiator who takes credit for that is
    // going to be embarrassed the year it goes the other way.
    const nymexChange = both ? last.nymex - first.nymex : null;
    const adderChange = both ? last.adder - first.adder : null;
    const volume = last?.volume ?? first?.volume ?? null;
    return {
      id: `${i}-${site.name}`,
      name: site.name,
      terms,
      previous: first,
      updated: last,
      savingPerDth,
      nymexChange,
      adderChange,
      volume,
      annualSaving: savingPerDth != null && volume ? savingPerDth * volume : null,
      termSaving: savingPerDth != null && volume && last
        ? savingPerDth * volume * (last.months / 12)
        : null,
    };
  });

  const comparable = rows.filter(r => r.savingPerDth != null);
  const withVolume = comparable.filter(r => r.annualSaving != null);
  const counts = { settled: 0, forward: 0, assumed: 0 };
  for (const row of rows) {
    for (const term of row.terms) {
      if (!term) continue;
      counts.settled += term.counts.settled;
      counts.forward += term.counts.forward;
      counts.assumed += term.counts.assumed;
    }
  }

  return {
    rows,
    counts,
    totals: {
      sites: rows.length,
      comparable: comparable.length,
      better: comparable.filter(r => r.savingPerDth > 0).length,
      worse: comparable.filter(r => r.savingPerDth < 0).length,
      // An unweighted mean across sites. Weighting it by volume would be
      // better and is not available unless the sheet carried one, so the
      // page says which of the two it is showing.
      avgSavingPerDth: comparable.length
        ? comparable.reduce((n, r) => n + r.savingPerDth, 0) / comparable.length
        : null,
      // Split the same way as a row: how much of the average move was the
      // market, and how much was the deal.
      avgNymexChange: comparable.length
        ? comparable.reduce((n, r) => n + r.nymexChange, 0) / comparable.length
        : null,
      avgAdderChange: comparable.length
        ? comparable.reduce((n, r) => n + r.adderChange, 0) / comparable.length
        : null,
      volumeSites: withVolume.length,
      annualSaving: withVolume.length
        ? withVolume.reduce((n, r) => n + r.annualSaving, 0)
        : null,
      termSaving: withVolume.length
        ? withVolume.reduce((n, r) => n + (r.termSaving || 0), 0)
        : null,
    },
  };
}
