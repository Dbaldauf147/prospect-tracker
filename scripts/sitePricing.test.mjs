// Assertion tests for the pasted renewal comparison - the Excel block on the
// Savings subtab that carries a row per site, a previous deal and an updated
// one.
// Plain Node - no test framework (the project has none). Run:
//   node scripts/sitePricing.test.mjs
//
// The thing to pin hardest here is the reading of the sheet, because every
// figure downstream is only as good as the cell it came out of and the
// failures are silent. Three in particular:
//
//   - Parentheses are a minus sign. ($0.276) read as +0.276 flips a discount
//     into a premium and nothing on the page would look wrong.
//   - An empty cell is a question, not a zero. The NYMEX Price column in the
//     sheet this was built for is entirely blank; read as zeroes it would
//     price every term at the adder alone.
//   - "Dec-25" is December 2025, and the term runs THROUGH its end month.
//     Dec-25 to Nov-26 is twelve months, not eleven and not thirteen.
import {
  parseMoney, parseMonthCell, termLength, readHeader, parseSitePricing,
  normalizeSitePricing, getSitePricing, priceTerm, priceSitePricing,
  SITE_PRICING_KEY,
} from '../src/utils/sitePricing.js';
import {
  SHIPPED_SETTLES, SHIPPED_FORWARD, monthlySeries, forwardSeries, priceLookup, normalizeSettles,
} from '../src/utils/nymexSavings.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a === b) { passed++; } else { failed++; console.error(`FAIL  ${name}\n        expected ${b}\n        got      ${a}`); }
}
function ok(cond, name) { eq(!!cond, true, name); }
function near(actual, expected, tol, name) {
  if (Number.isFinite(actual) && Math.abs(actual - expected) <= tol) { passed++; }
  else { failed++; console.error(`FAIL  ${name}\n        expected ${expected} ±${tol}\n        got      ${actual}`); }
}

// The sheet this was built for, tabs and blank cells exactly as Excel writes
// them. The header typo is the real one and is left in on purpose: nothing
// in the parser may depend on the word "Updated" being spelled right.
const SHEET = [
  '\tPrevious Pricing\t\t\t\t\tUdpated Pricing\t\t\t',
  '\tStart Date\tEnd Date\tNYMEX Price\t$/Dth\tTotal Price (NYMEX minus $Dth)\tStart Date\tEnd Date\tNYMEX Price\tTotal Price (NYMEX minus $Dth)\tTotal Price',
  'Syracuse Main (SYR)\tDec-25\tNov-26\t\t($0.276)\t\tDec-26\tNov-28\t\t($0.092)\t',
  'Syracuse SMM\tDec-21\tNov-26\t\t($0.162)\t\tDec-26\tNov-28\t\t($0.351)',
].join('\n');

// ── money out of a spreadsheet cell ──────────────────────────────────────
{
  eq(parseMoney('($0.276)'), -0.276, 'accounting parentheses are a minus sign');
  eq(parseMoney('$0.276'), 0.276, 'and without them it is positive');
  eq(parseMoney('-0.276'), -0.276, 'a written minus works too');
  eq(parseMoney('(0.276)'), -0.276, 'parentheses without a dollar sign still negate');
  eq(parseMoney('$1,234.50'), 1234.5, 'thousands separators are stripped');
  eq(parseMoney('  $3.40  '), 3.4, 'and so is the whitespace Excel leaves behind');

  eq(parseMoney(''), null, 'an empty cell is a question, not a zero');
  eq(parseMoney('   '), null, 'and so is a cell of spaces');
  eq(parseMoney('-'), null, 'a dash means the same thing');
  eq(parseMoney(null), null, 'a missing cell reads as empty');
  eq(parseMoney('n/a'), null, 'and so does text with no number in it');
  eq(parseMoney(0), 0, 'a real zero is kept, because somebody typing 0 meant 0');
}

// ── a month out of a spreadsheet cell ────────────────────────────────────
{
  eq(parseMonthCell('Dec-25'), { year: 2025, month: 12 }, 'the format the sheet uses');
  eq(parseMonthCell('Nov-26'), { year: 2026, month: 11 }, 'and the one beside it');
  eq(parseMonthCell('Dec 2025'), { year: 2025, month: 12 }, 'a four-digit year reads');
  eq(parseMonthCell('December 2025'), { year: 2025, month: 12 }, 'a spelled-out month reads');
  eq(parseMonthCell('DEC-25'), { year: 2025, month: 12 }, 'shouting reads');
  eq(parseMonthCell('12/25'), { year: 2025, month: 12 }, 'month-slash-year reads');
  eq(parseMonthCell('2025-12'), { year: 2025, month: 12 }, 'and year-first reads');
  eq(parseMonthCell(''), null, 'an empty cell is no month');
  eq(parseMonthCell('Smarch-25'), null, 'and neither is a month that does not exist');
  eq(parseMonthCell('Total'), null, 'nor a word in the wrong column');
}

// ── a term runs through its end month ────────────────────────────────────
{
  eq(termLength({ year: 2025, month: 12 }, { year: 2026, month: 11 }), 12, 'Dec-25 to Nov-26 is twelve months');
  eq(termLength({ year: 2026, month: 12 }, { year: 2028, month: 11 }), 24, 'Dec-26 to Nov-28 is twenty-four');
  eq(termLength({ year: 2021, month: 12 }, { year: 2026, month: 11 }), 60, 'Dec-21 to Nov-26 is sixty');
  eq(termLength({ year: 2026, month: 3 }, { year: 2026, month: 3 }), 1, 'a single month is a term of one');
  eq(termLength({ year: 2026, month: 11 }, { year: 2026, month: 3 }), 0, 'an end before its start is no term at all');
  eq(termLength(null, { year: 2026, month: 3 }), 0, 'and neither is a term with an end and no start');
}

// ── reading the header ───────────────────────────────────────────────────
{
  const rows = SHEET.split('\n').map(l => l.split('\t'));
  const header = readHeader(rows);
  eq(header.headerRow, 1, 'the header is the row carrying "Start Date", not the banner above it');
  eq(header.blocks.length, 2, 'and there is one block per "Start Date" on it');

  const [prev, upd] = header.blocks;
  eq([prev.cols.start, prev.cols.end, prev.cols.nymex, prev.cols.adder, prev.cols.total], [1, 2, 3, 4, 5],
    'the previous block maps every column it has');
  eq([upd.cols.start, upd.cols.end, upd.cols.nymex], [6, 7, 8], 'so does the updated one');
  // The column the sheet labels "Total Price (NYMEX minus $Dth)" holds the
  // adder, not a total: the label is spelling out a formula. The plain
  // "Total Price" at the end is the total.
  eq(upd.cols.adder, 9, 'a header naming an arithmetic relationship is read as the adder it describes');
  eq(upd.cols.total, 10, 'and the plain Total Price at the end is the total');

  eq(readHeader([['Site', 'Thing']]), null, 'a paste with no Start Date anywhere has no header to read');
  eq(readHeader([['', 'Start Date']]), null, 'and a block with a start but no end is not a block');
}

// ── reading the sheet ────────────────────────────────────────────────────
{
  const { sites, blocks, skipped } = parseSitePricing(SHEET);
  eq(blocks, 2, 'two blocks');
  eq(sites.length, 2, 'two sites');
  eq(skipped, [], 'and nothing it could not read');
  eq(sites.map(s => s.name), ['Syracuse Main (SYR)', 'Syracuse SMM'], 'the names come off the first column, brackets and all');

  const syr = sites[0];
  eq(syr.terms[0].start, { year: 2025, month: 12 }, 'the previous term starts Dec 2025');
  eq(syr.terms[0].end, { year: 2026, month: 11 }, 'and ends Nov 2026');
  eq(syr.terms[0].adder, -0.276, 'with the adder read as negative');
  eq(syr.terms[0].nymex, null, 'the blank NYMEX column stays blank rather than becoming zero');
  eq(syr.terms[0].total, null, 'and so does the blank total');
  eq(syr.terms[1].start, { year: 2026, month: 12 }, 'the updated term starts Dec 2026');
  eq(syr.terms[1].end, { year: 2028, month: 11 }, 'and ends Nov 2028');
  eq(syr.terms[1].adder, -0.092, 'with its own adder, out of the column whose header describes a formula');

  // The second row is one cell shorter than the first, which is what Excel
  // does when the last cell of a row is empty.
  eq(sites[1].terms[1].adder, -0.351, 'a row with its trailing empty cell dropped still reads');
  eq(sites[1].terms[0].start, { year: 2021, month: 12 }, 'and a term that starts years back reads');

  eq(parseSitePricing('').error, 'no-header', 'an empty paste is refused rather than guessed at');
  eq(parseSitePricing('just some text').error, 'no-header', 'and so is one with no header in it');
}

// ── rows that are not sites ──────────────────────────────────────────────
{
  const withJunk = parseSitePricing([
    '\tStart Date\tEnd Date\t$/Dth',
    'Real Site\tDec-25\tNov-26\t(0.1)',
    'Note: renewal pending\t\t\t',
    '\tDec-25\tNov-26\t(0.2)',
    'Subtotal\tnot a date\tnope\t(0.3)',
  ].join('\n'));
  eq(withJunk.sites.map(s => s.name), ['Real Site'], 'only the row with a name and a real term is a site');
  eq(withJunk.skipped.length, 3, 'and the other three are reported rather than dropped quietly');
  eq(withJunk.skipped.includes('Note: renewal pending'), true, 'a note is named');
}

// ── a comma-separated paste ──────────────────────────────────────────────
{
  const csv = parseSitePricing([
    'Site,Start Date,End Date,$/Dth',
    'Plant A,Dec-25,Nov-26,($0.30)',
  ].join('\n'));
  eq(csv.sites.length, 1, 'a paste with no tabs falls back to commas');
  eq(csv.sites[0].terms[0].adder, -0.3, 'and reads the same way');
}

// ── what gets stored ─────────────────────────────────────────────────────
{
  const parsed = parseSitePricing(SHEET);
  const table = normalizeSitePricing(parsed);
  eq(table.sites.length, 2, 'a parsed sheet normalizes to a table');
  eq(normalizeSitePricing({ sites: [] }), null, 'an empty one is no table at all');
  eq(normalizeSitePricing(null), null, 'and neither is nothing');
  eq(normalizeSitePricing({ sites: [{ name: '', terms: [{}] }] }), null, 'a site with no name is dropped');
  eq(normalizeSitePricing({ sites: [{ name: 'X', terms: [{ start: { year: 2025, month: 99 } }] }] })
    .sites[0].terms[0].start, null, 'a month that is not a month is dropped rather than priced');
  eq(normalizeSitePricing({ sites: [{ name: 'X', terms: [{ volume: -5 }] }] }).sites[0].terms[0].volume, null,
    'and a negative volume is not a volume');
  eq(getSitePricing({}), null, 'a settings document with nothing in it has no table');
  eq(getSitePricing({ [SITE_PRICING_KEY]: parsed }).sites.length, 2, 'and one with a table has it');
}

// ── pricing a term off the settles and the curve ─────────────────────────
{
  // A settle table and a curve small enough to check by hand: 2026 settles
  // at 2, the curve quotes 2027 at 6, and anything else is the flat 10.
  const series = monthlySeries(normalizeSettles([[2026, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2]]));
  const curve = forwardSeries(Array.from({ length: 12 }, (_, i) => [2027, i + 1, 6]));
  const priceOf = priceLookup(series, curve, 10);

  const settled = priceTerm({ start: { year: 2026, month: 1 }, end: { year: 2026, month: 12 }, adder: -0.5 }, priceOf);
  eq(settled.months, 12, 'a year of settles is twelve months');
  eq(settled.computedNymex, 2, 'averaging to the settle');
  eq(settled.nymex, 2, 'which is the NYMEX the empty column wanted');
  eq(settled.nymexGiven, false, 'and the page says it worked it out rather than being told');
  eq(settled.total, 1.5, 'the adder comes off it, so a negative $/Dth is a discount');
  eq(settled.counts, { settled: 12, forward: 0, assumed: 0 }, 'every month of it measured');

  const quoted = priceTerm({ start: { year: 2027, month: 1 }, end: { year: 2027, month: 12 }, adder: 0.5 }, priceOf);
  eq(quoted.nymex, 6, 'a term inside the curve prices off the curve');
  eq(quoted.total, 6.5, 'and a positive $/Dth is a premium');
  eq(quoted.counts, { settled: 0, forward: 12, assumed: 0 }, 'all of it quoted rather than measured');

  const straddles = priceTerm({ start: { year: 2026, month: 12 }, end: { year: 2027, month: 1 }, adder: 0 }, priceOf);
  eq(straddles.counts, { settled: 1, forward: 1, assumed: 0 }, 'a term across the handover counts both sides');
  eq(straddles.nymex, 4, 'and averages them');

  const past = priceTerm({ start: { year: 2030, month: 1 }, end: { year: 2030, month: 2 }, adder: 0 }, priceOf);
  eq(past.counts, { settled: 0, forward: 0, assumed: 2 }, 'a term past both tables is all assumption');
  eq(past.nymex, 10, 'priced at the flat number');
  eq(past.priced, 0, 'with nothing behind it from the market');

  // A figure somebody typed in beats one worked out here.
  const given = priceTerm({ start: { year: 2026, month: 1 }, end: { year: 2026, month: 12 }, nymex: 7, adder: -0.5 }, priceOf);
  eq(given.nymex, 7, 'a NYMEX price filled into the sheet is used instead of the computed one');
  eq(given.nymexGiven, true, 'and is marked as theirs');
  eq(given.computedNymex, 2, 'while what the page would have said is kept, so the two can be compared');
  eq(given.total, 6.5, 'the total follows their number');

  const givenTotal = priceTerm({ start: { year: 2026, month: 1 }, end: { year: 2026, month: 12 }, adder: -0.5, total: 99 }, priceOf);
  eq(givenTotal.total, 99, 'a total filled in is used as written rather than recomputed');
  eq(givenTotal.totalGiven, true, 'and marked');

  eq(priceTerm({ start: null, end: null }, priceOf), null, 'a row with no term prices to nothing rather than to zero');
  eq(priceTerm({ start: { year: 2026, month: 1 }, end: { year: 2026, month: 12 } }, priceOf).adder, 0,
    'a missing adder is no adder, which is the one place a blank IS a zero');
}

// ── what the renewal changed, and why ────────────────────────────────────
{
  const series = monthlySeries(normalizeSettles([[2026, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2]]));
  const curve = forwardSeries(Array.from({ length: 12 }, (_, i) => [2027, i + 1, 6]));
  const table = normalizeSitePricing({
    sites: [{
      name: 'Plant A',
      terms: [
        { start: { year: 2026, month: 1 }, end: { year: 2026, month: 12 }, adder: -0.5 },
        { start: { year: 2027, month: 1 }, end: { year: 2027, month: 12 }, adder: -0.9 },
      ],
    }],
  });
  const out = priceSitePricing(table, series, curve, 10);
  const row = out.rows[0];
  eq(row.previous.total, 1.5, 'the old deal priced at 1.5');
  eq(row.updated.total, 5.1, 'the new one at 5.1');
  near(row.savingPerDth, -3.6, 1e-9, 'so it costs 3.60 a Dth MORE, and the saving is negative rather than hidden');
  eq(row.nymexChange, 4, 'the market moved 4.00 against it');
  eq(row.adderChange, -0.4, 'while the deal itself improved by 0.40');
  near(-(row.nymexChange + row.adderChange), row.savingPerDth, 1e-9,
    'and the two halves add back up to the whole, which is the point of splitting them');

  eq(out.totals.sites, 1, 'one site');
  eq(out.totals.comparable, 1, 'with two terms to compare');
  eq(out.totals.worse, 1, 'and it came out worse');
  eq(out.totals.better, 0, 'not better');
  eq(out.totals.annualSaving, null, 'no volume in the sheet, so no dollar figure is invented');
  eq(out.counts, { settled: 12, forward: 12, assumed: 0 }, 'the source counts cover every month priced');

  // A site with only one term has nothing to compare against.
  const lone = priceSitePricing(normalizeSitePricing({
    sites: [{ name: 'Solo', terms: [{ start: { year: 2026, month: 1 }, end: { year: 2026, month: 6 }, adder: 0 }] }],
  }), series, curve, 10);
  eq(lone.rows[0].savingPerDth, null, 'a site with one term has no change to report');
  eq(lone.totals.comparable, 0, 'and is not counted as compared');
  eq(lone.totals.avgSavingPerDth, null, 'so the average is nothing rather than zero');
}

// ── a volume column turns $/Dth into dollars ─────────────────────────────
{
  const series = monthlySeries(normalizeSettles([[2026, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2]]));
  const table = normalizeSitePricing({
    sites: [{
      name: 'Plant A',
      terms: [
        { start: { year: 2026, month: 1 }, end: { year: 2026, month: 12 }, adder: 0, volume: 100000 },
        { start: { year: 2026, month: 1 }, end: { year: 2026, month: 12 }, adder: -0.25, volume: 100000 },
      ],
    }],
  });
  const row = priceSitePricing(table, series, [], 10).rows[0];
  eq(row.savingPerDth, 0.25, 'a quarter off the adder is a quarter a Dth');
  eq(row.annualSaving, 25000, 'which on 100,000 Dth a year is $25,000');
  eq(row.termSaving, 25000, 'and over a twelve-month term, the same');

  const twoYear = normalizeSitePricing({
    sites: [{
      name: 'Plant A',
      terms: [
        { start: { year: 2026, month: 1 }, end: { year: 2026, month: 12 }, adder: 0, volume: 100000 },
        { start: { year: 2026, month: 1 }, end: { year: 2027, month: 12 }, adder: -0.25, volume: 100000 },
      ],
    }],
  });
  const long = priceSitePricing(twoYear, series, [], 2).rows[0];
  eq(long.termSaving, 50000, 'a two-year term saves it twice');
  eq(long.annualSaving, 25000, 'while the annual figure stays annual');
}

// ── the sheet this was built for, priced end to end ──────────────────────
{
  const table = normalizeSitePricing(parseSitePricing(SHEET));
  const out = priceSitePricing(
    table,
    monthlySeries(SHIPPED_SETTLES),
    forwardSeries(SHIPPED_FORWARD),
    3.67,
  );
  eq(out.rows.length, 2, 'both sites price');
  eq(out.rows.every(r => r.savingPerDth != null), true, 'and both have two terms to compare');
  eq(out.rows[0].previous.months, 12, 'Syracuse Main was on a twelve-month deal');
  eq(out.rows[0].updated.months, 24, 'and renewed into a twenty-four-month one');
  eq(out.rows[1].previous.months, 60, 'Syracuse SMM was on a five-year deal');

  // Every NYMEX figure is filled in by the page, because the sheet left the
  // column blank. That is the feature, so it is pinned.
  eq(out.rows.every(r => r.previous.nymexGiven === false && r.updated.nymexGiven === false), true,
    'no NYMEX price was given, so every one of them is worked out here');
  eq(out.rows.every(r => r.previous.nymex > 0 && r.updated.nymex > 0), true, 'and all of them came back a real price');
  eq(out.rows[0].adderChange > 0, true, 'Syracuse Main renewed at a worse adder');
  eq(out.rows[1].adderChange < 0, true, 'and Syracuse SMM at a better one');
  ok(out.totals.avgSavingPerDth != null, 'the table averages across the sites it could compare');
  eq(out.totals.annualSaving, null, 'and quotes no dollar saving, because the sheet carries no volume');
}

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
