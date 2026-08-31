// Assertion tests for the Close Not Solds detector. Plain Node — no test
// framework (the project has none). Run:
//   node scripts/closeNotSoldOpps.test.mjs
//
// This list makes a claim about the outside world: "Not Sold on Opps, but
// STILL OPEN in BFO." The second half is only knowable from the rows pasted
// on the BFO Activity tab, so the case worth pinning hardest is the one
// where that paste can't answer — no data, no Opportunity Name column, or a
// column of blanks. The detector used to read an empty index as "no opinion"
// and return every Not-Sold opp carrying a BFO Link, which handed the AI
// assistant a list of opps to close out that were closed already. It now
// fails closed, and hasBfoOppNameIndex is what lets the page say why the
// list is empty instead of implying the work is done.
//
// The column choice is the other trap: a paste can carry more than one
// header matching /opportunity name/, and taking whichever sorts first can
// index a column of blanks — which looks identical to having no data.
import {
  computeCloseNotSoldOpps, computeCloseNotSoldMissingData, hasBfoOppNameIndex, bfoOppNameIndex,
} from '../src/utils/closeNotSoldOpps.js';

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n      got:  ${JSON.stringify(actual)}\n      want: ${JSON.stringify(expected)}`}`);
}

// Two Not-Sold opps with BFO Links, one mapped and one not, plus rows that
// must never qualify (a live stage, and a placeholder BFO Link).
const RECORDS = [
  {
    _id: 1, Stage: 'Not Sold', Account: 'Alexandria', 'BFO Link': 'ESS.CRE>SOLUTIONS - NYCFO ARE',
    'BFO Address': 'https://se.lightning.force.com/opp/1', Competition: 'Only SE', 'Reason Not Sold': 'Never Connected',
  },
  {
    _id: 2, Stage: 'Not Sold', Account: 'Beta Corp', 'BFO Link': 'BETA - RETRO',
    'BFO Address': 'https://se.lightning.force.com/opp/2', Competition: '', 'Reason Not Sold': 'Price Pain',
  },
  { _id: 3, Stage: 'Quoted', Account: 'Gamma', 'BFO Link': 'GAMMA - LIVE', 'BFO Address': 'https://se.lightning.force.com/opp/3' },
  { _id: 4, Stage: 'Not Sold', Account: 'Delta', 'BFO Link': '#N/A' },
];
const oppsCache = { records: RECORDS };

const names = (rows) => rows.map(r => r.name);

// ---- Fails closed when the paste can't answer ----------------------------
// Each of these used to return both Not-Sold opps.
check('no BFO Activity at all → nothing',
  names(computeCloseNotSoldOpps({ oppsCache, bfoActivity: null })), []);
check('BFO Activity with no Opportunity Name column → nothing',
  names(computeCloseNotSoldOpps({
    oppsCache,
    bfoActivity: { headers: ['Account Name', 'Amount'], rows: [{ 'Account Name': 'Alexandria', Amount: '1' }] },
  })), []);
check('Opportunity Name column present but every cell blank → nothing',
  names(computeCloseNotSoldOpps({
    oppsCache,
    bfoActivity: { headers: ['Opportunity Name'], rows: [{ 'Opportunity Name': '' }, { 'Opportunity Name': '   ' }] },
  })), []);
check('empty rows array → nothing',
  names(computeCloseNotSoldOpps({ oppsCache, bfoActivity: { headers: ['Opportunity Name'], rows: [] } })), []);

check('hasBfoOppNameIndex(null) is false', hasBfoOppNameIndex(null), false);
check('hasBfoOppNameIndex with no name column is false',
  hasBfoOppNameIndex({ headers: ['Account Name'], rows: [{ 'Account Name': 'x' }] }), false);
check('hasBfoOppNameIndex with names is true',
  hasBfoOppNameIndex({ headers: ['Opportunity Name'], rows: [{ 'Opportunity Name': 'BETA - RETRO' }] }), true);

// ---- Includes only what the paste actually lists --------------------------
const ACTIVITY = {
  headers: ['Opportunity Name', 'Sales Stage'],
  rows: [
    // Deliberately not byte-identical to the Opps cell: normalizeName trims,
    // lower-cases and collapses runs of whitespace, so this must still match.
    { 'Opportunity Name': '  ess.cre>solutions  -  NYCFO ARE ', 'Sales Stage': '5 - Prepare & Bid' },
    { 'Opportunity Name': 'SOMETHING ELSE', 'Sales Stage': '4 - Influence and Develop' },
  ],
};
check('only opps present in the paste are listed',
  names(computeCloseNotSoldOpps({ oppsCache, bfoActivity: ACTIVITY })), ['ESS.CRE>SOLUTIONS - NYCFO ARE']);

const listed = computeCloseNotSoldOpps({ oppsCache, bfoActivity: ACTIVITY })[0];
check('mapped pair resolves the BFO Status + Reason',
  [listed.status, listed.reason, listed.unmapped],
  ['Cancelled by Customer', 'No acceptable Offer from SE', false]);

// The unmapped opp (blank Competition) qualifies only once BFO lists it.
const WITH_BETA = {
  headers: ['Opportunity Name'],
  rows: [...ACTIVITY.rows, { 'Opportunity Name': 'BETA - RETRO' }],
};
const both = computeCloseNotSoldOpps({ oppsCache, bfoActivity: WITH_BETA });
check('a blank Competition surfaces as unmapped rather than being dropped',
  both.map(r => [r.name, r.unmapped]),
  [['ESS.CRE>SOLUTIONS - NYCFO ARE', false], ['BETA - RETRO', true]]);
check('the unmapped row is what the Issues tab reports as missing',
  computeCloseNotSoldMissingData(both).map(m => [m.name, m.missing]),
  [['BETA - RETRO', ['Competition', 'Status + Reason (no mapping for this Reason Not Sold + Competition)']]]);

// ---- Column choice --------------------------------------------------------
// "Local Opportunity Name" sorts first and is empty. Taking the first loose
// regex match indexes it, yielding an empty index that then swallows the
// whole list — the failure this preference exists to prevent.
const DECOY = {
  headers: ['Local Opportunity Name', 'Opportunity Name'],
  rows: [{ 'Local Opportunity Name': '', 'Opportunity Name': 'BETA - RETRO' }],
};
check('exact "Opportunity Name" wins over a decoy column that sorts first',
  [...bfoOppNameIndex(DECOY).keys()], ['beta - retro']);
check('…so the opp it names is listed',
  names(computeCloseNotSoldOpps({ oppsCache, bfoActivity: DECOY })), ['BETA - RETRO']);

// With no exact header the loose match is still the fallback, so a renamed
// column ("BFO Opportunity Name") keeps working.
check('falls back to a loose match when there is no exact header',
  [...bfoOppNameIndex({ headers: ['BFO Opportunity Name'], rows: [{ 'BFO Opportunity Name': 'BETA - RETRO' }] }).keys()],
  ['beta - retro']);

// ---- Guards that predate this change -------------------------------------
check('an empty Opps cache short-circuits',
  names(computeCloseNotSoldOpps({ oppsCache: { records: [] }, bfoActivity: WITH_BETA })), []);

console.log(failures === 0 ? '\nAll close-not-sold detector tests passed.' : `\n${failures} test(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
