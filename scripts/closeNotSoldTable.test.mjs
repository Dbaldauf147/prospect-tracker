// The close-out table, verbatim.
//
// (Competition, Reason Not Sold) decides the BFO Status and Reason
// outright — the AI assistant enters whatever this table says, and Stage 7
// and the close-out popup now promise it to the user before they save. So
// the table itself is the specification, and it is written out here row by
// row exactly as it was given, rather than being re-derived from the
// object under test. A rule quietly edited in data/closeNotSoldRules is a
// promise on screen that BFO doesn't keep; this is what notices.
//
// Run: node scripts/closeNotSoldTable.test.mjs
import { lookupCloseNotSold, hasCloseNotSoldRules, reasonOptionsForCompetition } from '../src/data/closeNotSoldRules.js';

let passed = 0, failed = 0;
function ok(cond, name) {
  if (cond) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}`); }
}

// Reason Not Sold | Competition | BFO Status | BFO Reason
const TABLE = [
  ['Current Service Delivery Issues',        'Competitive non RFP', 'Lost',                  'Relationship Issue with SE'],
  ["Customer Didn't Have Enough Pain",       'Competitive non RFP', 'Lost',                  'No acceptable Offer from SE'],
  ['Ghosted - No Response',                  'Competitive non RFP', 'Lost',                  'Relationship Issue with SE'],
  ['Price Pain',                             'Competitive non RFP', 'Lost',                  'Pricing issue'],
  ["Software or Service Doesn't Meet Need",  'Competitive non RFP', 'Lost',                  'No acceptable Offer from SE'],
  ['Cancelled Internally - No Opp',          'Only SE',             'Cancelled by Schneider', 'No real opportunity / out of SE strategy'],
  ['Cancelled Internally - Not in Targets',  'Only SE',             'Cancelled by Schneider', 'No real opportunity / out of SE strategy'],
  ['Current Service Delivery Issues',        'Only SE',             'Cancelled by Customer',  'Relationship Issue with SE'],
  ["Customer Didn't Have Enough Pain",       'Only SE',             'Cancelled by Customer',  'No acceptable Offer from SE'],
  ['Duplicate Opp',                          'Only SE',             'Cancelled by Schneider', 'No real opportunity / out of SE strategy'],
  ['Free Service',                           'Only SE',             'Cancelled by Schneider', 'No real opportunity / out of SE strategy'],
  ['Ghosted - No Response',                  'Only SE',             'Cancelled by Customer',  'No acceptable Offer from SE'],
  ['Never Connected',                        'Only SE',             'Cancelled by Customer',  'No acceptable Offer from SE'],
  ['Price Pain',                             'Only SE',             'Cancelled by Customer',  'No acceptable Offer from SE'],
  ["Software or Service Doesn't Meet Need",  'Only SE',             'Cancelled by Customer',  'No acceptable Offer from SE'],
  ['Unknown',                                'Only SE',             'Cancelled by Customer',  'No acceptable Offer from SE'],
  ['Current Service Delivery Issues',        'RFP',                 'Lost',                  'Relationship Issue with SE'],
  ["Customer Didn't Have Enough Pain",       'RFP',                 'Lost',                  'No acceptable Offer from SE'],
  ['Ghosted - No Response',                  'RFP',                 'Lost',                  'Relationship Issue with SE'],
  ['Price Pain',                             'RFP',                 'Lost',                  'Pricing issue'],
  ["Software or Service Doesn't Meet Need",  'RFP',                 'Lost',                  'No acceptable Offer from SE'],
];

// ── Every row maps to exactly what the table says ──────────────────────
{
  let wrong = 0;
  for (const [reason, competition, status, bfoReason] of TABLE) {
    const got = lookupCloseNotSold(competition, reason);
    if (got?.status !== status || got?.reason !== bfoReason) {
      wrong++;
      console.log(`      ${competition} + ${reason}`);
      console.log(`        want ${status} / ${bfoReason}`);
      console.log(`        got  ${got ? `${got.status} / ${got.reason}` : '(unmapped)'}`);
    }
  }
  ok(wrong === 0, `all ${TABLE.length} rows of the close-out table map as written`);
}

// ── The table is the whole table ───────────────────────────────────────
//
// A rule ADDED to the file is as much a change to what the screen promises
// as a rule altered, and comparing row by row above would not catch one.
{
  const listed = new Set(TABLE.map(([reason, competition]) => `${competition}|${reason}`.toLowerCase()));
  const REASONS = [...new Set(TABLE.map(([reason]) => reason))];
  const extra = [];
  for (const competition of ['Competitive non RFP', 'Only SE', 'RFP']) {
    for (const reason of REASONS) {
      if (!lookupCloseNotSold(competition, reason)) continue;
      if (!listed.has(`${competition}|${reason}`.toLowerCase())) extra.push(`${competition} + ${reason}`);
    }
  }
  ok(extra.length === 0, 'and no pair outside the table has picked up a rule');
  if (extra.length) console.log(`      unexpected: ${extra.join(', ')}`);
}

// ── Spelling the user's way and the dropdown's way are the same pair ───
//
// The Reason Not Sold dropdown stores "Price pain", "Customer didnt have
// enough pain", "Cancelled internally - No Opp" — different casing and a
// missing apostrophe from the table above. They have to land on the same
// rule, or the preview goes amber on a pair that is actually fine.
{
  const same = (a, b) => {
    const x = lookupCloseNotSold('Only SE', a), y = lookupCloseNotSold('Only SE', b);
    return !!x && !!y && x.status === y.status && x.reason === y.reason;
  };
  ok(same('Price Pain', 'Price pain'), 'casing does not change the pair');
  ok(same("Customer Didn't Have Enough Pain", 'Customer didnt have enough pain'),
    'nor does a missing apostrophe');
  ok(same("Software or Service Doesn't Meet Need", "Software or service doesn't meet need"),
    'nor a curly-quote / casing mix');
  ok(same('Cancelled Internally - No Opp', 'Cancelled internally - No Opp'),
    'nor the dropdown\'s own spelling of the cancelled-internally reasons');
}

// ── What has no rules at all ───────────────────────────────────────────
//
// The preview goes amber and says "no Reason Not Sold maps under X" for
// these, rather than offering reasons that cannot close anything out.
{
  ok(!hasCloseNotSoldRules('N/A'), 'Competition "N/A" has no close-out rules');
  ok(!hasCloseNotSoldRules(''), 'nor does a blank Competition');
  ok(hasCloseNotSoldRules('Only SE') && hasCloseNotSoldRules('RFP') && hasCloseNotSoldRules('Competitive non RFP'),
    'the three real Competitions do');
  // A Sold opp records its kind in Reason Not Sold, which is why Stage 7
  // hides the preview for one: these would read as a broken pair.
  ok(!lookupCloseNotSold('Only SE', 'Sold - New Client'), '"Sold - New Client" maps to nothing');
  ok(!lookupCloseNotSold('Only SE', 'Sold - Current Client'), 'and neither does "Sold - Current Client"');
}

// ── The popups only offer reasons that map ─────────────────────────────
{
  const ALL = ['Unknown', 'Ghosted - No Response', 'Price pain', 'Sold - New Client', 'Never Connected'];
  ok(!reasonOptionsForCompetition('Only SE', ALL).includes('Sold - New Client'),
    'a reason with no rule is filtered out of the Only SE list');
  ok(!reasonOptionsForCompetition('RFP', ALL).includes('Never Connected'),
    'and "Never Connected" is not offered under RFP, where it has no rule');
  ok(reasonOptionsForCompetition('N/A', ALL).length === ALL.length,
    'a Competition with no rules keeps the full list rather than emptying the dropdown');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
