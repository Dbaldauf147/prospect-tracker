// Assertion tests for turning an opportunity into a Services Pricing
// scenario. Plain Node — no test framework (the project has none). Run:
//   node scripts/oppPricingImport.test.mjs
//
// What this pins is where each number in a deal estimate comes from. The
// order matters: a count on the opp itself beats the company record, which
// beats the company's saved site list — most specific wins, so an opp that
// was scoped for 340 meters isn't re-priced against a portfolio average.
// It also pins that nothing is invented: a unit with no source is absent
// from `counts` rather than defaulting to zero, which is what lets the
// import tell the user what still needs typing in.
import { oppScenario, pickableOpps, siteListKey } from '../src/utils/oppPricingImport.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.error(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}

const SERVICES = ['Bill payment', 'Comp GHG', 'Budgets', 'Audits', 'CSRD readiness', 'Data collection'];

// ── Scope → services, using the shared word-run rule ──────────────────
{
  const s = oppScenario({
    opp: { Account: 'Acme', Scope: 'Bill payment; GHG; widget polishing' },
    prospects: [], siteLists: {}, serviceNames: SERVICES,
  });
  check('scope names its services', s.services, ['Bill payment', 'Comp GHG']);
  check('unmatched scope is reported, not dropped', s.unmatchedTokens, ['widget polishing']);
}

// ── Counts: opp column beats company record beats site list ───────────
{
  const prospects = [{ company: 'Acme', numberOfSites: 58, numberOfAccounts: 210 }];
  const siteLists = { acme: { headers: ['Property Name'], rows: [{}, {}, {}] } };

  const withOppCol = oppScenario({
    opp: { Account: 'Acme', Scope: 'Bill payment', 'Sites': '12', '# of Meters': '340' },
    prospects, siteLists, serviceNames: SERVICES,
  });
  check('an opp column wins over the company record', withOppCol.counts.sites, 12);
  check('a unit only the opp carries is picked up', withOppCol.counts.meters, 340);
  check('the source names the column', withOppCol.countSources.sites, 'the opp’s “Sites” column');

  const noOppCol = oppScenario({
    opp: { Account: 'Acme', Scope: 'Bill payment' },
    prospects, siteLists, serviceNames: SERVICES,
  });
  check('falls back to the company record', noOppCol.counts.sites, 58);
  check('accounts come off the company record', noOppCol.counts.accounts, 210);

  const noProspect = oppScenario({
    opp: { Account: 'Acme', Scope: 'Bill payment' },
    prospects: [], siteLists, serviceNames: SERVICES,
  });
  check('falls back to the saved site list', noProspect.counts.sites, 3);
  check('no account source leaves accounts unset', noProspect.counts.accounts, undefined);
}

// ── The rest of the company record's Scale section ────────────────────
// Meters, equipment and electric MWh are typed on the company card the
// same way sites and accounts are, and each is the unit a per-meter /
// per-equipment / per-MWh service prices against. Before these were on the
// record, the only source for them was a column on the opp itself.
{
  const prospects = [{
    company: 'Acme',
    numberOfSites: 58, numberOfAccounts: 210,
    numberOfMeters: 4200, equipmentCount: 36, annualMwh: 91000,
  }];

  const fromRecord = oppScenario({
    opp: { Account: 'Acme', Scope: 'Bill payment' },
    prospects, siteLists: {}, serviceNames: SERVICES,
  });
  check('meters come off the company record', fromRecord.counts.meters, 4200);
  check('so does an equipment count', fromRecord.counts.equipment, 36);
  check('so does electric MWh', fromRecord.counts.mwh, 91000);
  check('the source names the record', fromRecord.countSources.meters, 'Meters on the Acme record');

  // Same precedence as sites: an opp scoped for its own number is not
  // re-priced against the whole portfolio.
  const oppWins = oppScenario({
    opp: { Account: 'Acme', Scope: 'Bill payment', '# of Meters': '340', 'MWh': '1200' },
    prospects, siteLists: {}, serviceNames: SERVICES,
  });
  check('an opp column still beats the record for meters', oppWins.counts.meters, 340);
  check('...and for MWh', oppWins.counts.mwh, 1200);
  check('a unit the opp omits still falls back', oppWins.counts.equipment, 36);
}

// ── Nothing is invented ───────────────────────────────────────────────
{
  const s = oppScenario({
    opp: { Account: 'Acme', Scope: 'Bill payment' },
    prospects: [{ company: 'Acme', numberOfSites: 0, numberOfAccounts: null }],
    siteLists: {}, serviceNames: SERVICES,
  });
  check('a zero count is not a count', s.counts, {});
  check('no Quoted Amount leaves the deal size blank', s.dealSize, '');
}

// ── Deal size off the Quoted Amount ───────────────────────────────────
{
  const s = oppScenario({
    opp: { Account: 'Acme', Scope: 'Budgets', 'Quoted Amount': 'USD 1,250,000.00' },
    prospects: [], siteLists: {}, serviceNames: SERVICES,
  });
  check('quoted amount parses through its formatting', s.dealSize, 1250000);
}

// ── Site-list lookup survives punctuation drift in the slug ───────────
{
  check('slug keys reduce past separators', siteListKey('acme--inc'), siteListKey('Acme, Inc.'));
  const s = oppScenario({
    opp: { Account: 'Acme, Inc.', Scope: 'Audits' },
    prospects: [], siteLists: { 'acme--inc': { headers: [], rows: [{}, {}] } }, serviceNames: SERVICES,
  });
  check('a differently-punctuated slug still resolves', s.counts.sites, 2);
}

// ── Projects and equipment come off the opp's own columns ─────────────
{
  const s = oppScenario({
    opp: { Account: 'Acme', Scope: '', '# of Projects': 3, 'Equipment': 42 },
    prospects: [], siteLists: {}, serviceNames: SERVICES,
  });
  check('a project count is read off the opp', s.counts.projects, 3);
  check('so is an equipment count', s.counts.equipment, 42);

  // The loose pattern is plural for a reason: "Project #" is an identifier,
  // and reading one as a count would price a deal off an opp number.
  const ident = oppScenario({
    opp: { Account: 'Acme', Scope: '', 'Project #': 4821 },
    prospects: [], siteLists: {}, serviceNames: SERVICES,
  });
  check('an opp number is not a count of projects', ident.counts.projects, undefined);
}

// ── The picker puts open opps first ───────────────────────────────────
{
  const rows = [
    { Account: 'Zeta', Stage: 'Sold' },
    { Account: 'Beta', Stage: 'Quoting' },
    { Account: 'Alpha', Stage: 'Not Sold' },
    { Account: 'Delta', Stage: 'Lead' },
    { Account: '', Stage: 'Lead' },
  ];
  check('open opps sort ahead of closed, alphabetically inside',
    pickableOpps(rows, '').map(r => r.Account), ['Beta', 'Delta', 'Alpha', 'Zeta']);
  check('search matches on account text', pickableOpps(rows, 'zet').map(r => r.Account), ['Zeta']);
}

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
