// Assertion tests for the Prospecting page's Top PC intro list. Plain
// Node — no test framework (the project has none). Run:
//   node scripts/topPcOutreach.test.mjs
//
// The list tells the user which PE partners to ask for an intro, so the
// failure modes that matter are the ones that quietly change the work:
//
//   - a Top PC already at Qualifying still being listed (asking again for
//     an intro that's already happening);
//   - a Top PC dropping off because it has no prospect record of its own
//     — blank status is the coldest name on the list, not a done one;
//   - naming a different company than the PE Portfolio page's Top PC
//     column, which is the same picker underneath.
import { collectTopPcIntros, isTopPcWorked } from '../src/utils/topPcOutreach.js';
import { pickTopPortfolioCompany, buildStatusIndex } from '../src/utils/topPortfolioCompany.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}

// A portfolio company row as the PE tab stores it. US HQ so it survives
// the picker's North America filter; energy drives the score.
function pc(companyName, energyGwh, extra = {}) {
  return { companyName, energyGwh, siteCount: 10, hqCity: 'Chicago', hqCountry: 'United States', ...extra };
}
function firm(company, portfolioCompanies, extra = {}) {
  return { id: `pe-${company}`, company, type: 'Private Equity', portfolioCompanies, ...extra };
}

// ---- what counts as already worked ------------------------------------------

eq(isTopPcWorked('Qualifying'), true, 'Qualifying means the intro is already in motion');
eq(isTopPcWorked('  qualifying '), true, 'the status match ignores case and padding');
eq(isTopPcWorked('Inside Sales'), false, 'another status is still work');
eq(isTopPcWorked(''), false, 'no status at all is still work');

// ---- the list itself --------------------------------------------------------

const PROSPECTS = [
  firm('Blue Owl Capital', [pc('KPS Capital Partners', 90), pc('Smaller Co', 10)]),
  firm('Platinum Equity', [pc('Solenis', 80)]),
  firm('Blackstone', [pc('QTS Data Centers', 70)]),
  // Not a PE firm — its portfolio must not contribute a row.
  { id: 'acct-1', company: 'Some Operating Co', type: 'Direct', portfolioCompanies: [pc('Ignore Me', 99)] },
  // Status records for the portfolio companies above.
  { id: 'p1', company: 'KPS Capital Partners', status: 'Inside Sales' },
  { id: 'p2', company: 'Solenis', status: 'Qualifying' },
  // QTS Data Centers has no record at all — the PE page shows it blank.
];

const rows = collectTopPcIntros(PROSPECTS);
eq(rows.map(r => r.company), ['KPS Capital Partners', 'QTS Data Centers'],
  'a Qualifying Top PC drops off; an untracked one stays, ranked by score');
eq(rows.map(r => r.firm), ['Blue Owl Capital', 'Blackstone'], 'each row names the firm to ask');
eq(rows.map(r => r.status), ['Inside Sales', ''], 'the status travels with the row, blank when untracked');
eq(rows.map(r => r.companyId), ['p1', null], 'a tracked Top PC carries its record id for click-through');
eq(rows.map(r => r.firmId), ['pe-Blue Owl Capital', 'pe-Blackstone'], 'and the firm carries its own');
eq(rows[0].score >= rows[1].score, true, 'rows come back warmest first');

eq(collectTopPcIntros([]), [], 'no prospects at all means nothing to ask for');
eq(collectTopPcIntros(null), null, 'prospects not loaded yet stay unknown');
eq(collectTopPcIntros(undefined), null, 'a missing prospects prop stays unknown');
eq(collectTopPcIntros([firm('Empty Capital', [])]), [], 'a firm with no portfolio contributes nothing');
eq(collectTopPcIntros([firm('No Portfolio Field')]), [], 'a firm with no portfolio field at all is skipped');

// A firm whose every Top PC candidate is excluded by the picker (closed
// off / parked / already a client) contributes nothing rather than
// falling back to a second choice the PE page wouldn't show.
eq(collectTopPcIntros([
  firm('Settled Capital', [pc('Old Deal', 50)]),
  { id: 'p3', company: 'Old Deal', status: 'Lost - Not Sold' },
]), [], 'a firm whose only candidate is closed off contributes nothing');

// ---- a status set on the firm's own portfolio list --------------------------

// A PC row carries its own Status column, and it wins over the tracker
// record (see topPortfolioCompany.js). Qualifying set there has to take
// the intro off this list too, whether or not the company is tracked.
eq(collectTopPcIntros([firm('Row Status Capital', [pc('Rowco', 50, { status: 'Qualifying' })])]), [],
  'Qualifying on the firm\'s own portfolio row drops the intro');
{
  const rows2 = collectTopPcIntros([
    firm('Row Status Capital', [pc('Rowco', 50, { status: 'Inside Sales' })]),
    { id: 'p-row', company: 'Rowco', status: 'Qualifying' },
  ]);
  eq(rows2.map(r => [r.company, r.status, r.statusFromRow]), [['Rowco', 'Inside Sales', true]],
    'the row\'s own status wins over the tracker record, and says so');
}

// ---- same answer as the PE Portfolio column ---------------------------------

// The one thing that must never drift: the company named here is the
// company that page's Top PC column names, from the same picker.
{
  const index = buildStatusIndex(PROSPECTS);
  const blueOwl = PROSPECTS.find(p => p.company === 'Blue Owl Capital');
  const top = pickTopPortfolioCompany(blueOwl.portfolioCompanies, index);
  eq(rows[0].company, top.companyName, 'the listed company is the PE page\'s Top PC');
  eq(rows[0].score, top.score, 'and carries that column\'s score');
}

// ---- one row per firm, not per company --------------------------------------

// Two firms can top out on the same company: that's two intros to ask
// for, through two different relationships, so both rows stay.
{
  const shared = collectTopPcIntros([
    firm('Firm A', [pc('Shared Co', 60)]),
    firm('Firm B', [pc('Shared Co', 60)]),
  ]);
  eq(shared.map(r => `${r.firm}/${r.company}`), ['Firm A/Shared Co', 'Firm B/Shared Co'],
    'a company topping two portfolios is two intros to ask for');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
