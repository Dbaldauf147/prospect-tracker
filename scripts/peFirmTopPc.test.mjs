// Assertion tests for the Top PC named on each row of step 6 of the
// Prospecting ladder. Plain Node - no test framework (the project has
// none). Run:
//   node scripts/peFirmTopPc.test.mjs
//
// The point of the column is that it agrees with the PE Portfolio table's
// own Top PC column, so the things worth pinning down are the ones that
// would let the two drift apart, or would name a company the user has
// already dealt with:
//
//   1. The pick itself - highest Opportunity Score wins, and the score is
//      normalized across the firm's WHOLE portfolio before the filters run
//      (see note 1 in utils/topPortfolioCompany.js).
//   2. The filters - a company headquartered outside North America, or one
//      already settled (Client, Old Client, Hold Off, Lost - Not Sold), is
//      not the answer to "who should I ask for an intro to".
//   3. Which list is read - the firm's own mapped Portfolio Companies,
//      not the prospects that name it as their PE Owner, because only a
//      mapped row carries the energy and sector the score needs. `mapped`
//      is what lets the row tell an unmapped firm from a filtered-out one.
//   4. The click-through - the Top PC opens its tracker record when the
//      company is tracked, under the same alternate-name rules the status
//      lookup uses.
import { collectPeFirmTopPcs, peFirmTopPcKey } from '../src/utils/peFirmTopPcs.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.log(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}

// A mapped Portfolio Companies row, as the firm's pop-up stores them.
const pcRow = (companyName, over = {}) => ({
  companyName,
  hqCity: 'Chicago',
  hqCountry: 'United States',
  industry: 'Industrial / Manufacturing',
  energyGwh: 10,
  siteCount: 5,
  ...over,
});
const firmRow = (firm, firmId) => ({ firm, firmId, stage: 'Discovery', pcCount: 0, closedCount: 0 });
const topFor = (map, row) => map.get(peFirmTopPcKey(row))?.top?.companyName ?? null;

// --- the pick ------------------------------------------------------------
{
  // Same sector and site count, so energy is the only thing separating
  // them: the bigger consumer is the better conversation.
  const firm = {
    id: 'birchwood', company: 'Birchwood Partners', type: 'Private Equity',
    portfolioCompanies: [
      pcRow('Harbor Foods', { energyGwh: 4 }),
      pcRow('Ironworks Mfg', { energyGwh: 40 }),
      pcRow('Kestrel Plastics', { energyGwh: 12 }),
    ],
  };
  const row = firmRow('Birchwood Partners', 'birchwood');
  const map = collectPeFirmTopPcs([row], [firm]);
  check('the strongest company is the one named', topFor(map, row), 'Ironworks Mfg');
  check('and the row counts what it picked from',
    map.get('birchwood').mapped, 3);
  check('the pick carries the counts behind it',
    [map.get('birchwood').top.total, map.get('birchwood').top.eligible], [3, 3]);
}

// --- the filters ---------------------------------------------------------
{
  const firm = {
    id: 'cedar', company: 'Cedar Point Equity', type: 'Private Equity',
    portfolioCompanies: [
      // Biggest by a distance, and in Germany: not who we work.
      pcRow('Rheinwerk GmbH', { energyGwh: 90, hqCity: 'Munich', hqCountry: 'Germany' }),
      // Second biggest, and already a client on this firm's own list.
      pcRow('Harbor Foods', { energyGwh: 50, status: 'Client' }),
      pcRow('Ironworks Mfg', { energyGwh: 20 }),
    ],
  };
  const row = firmRow('Cedar Point Equity', 'cedar');
  const map = collectPeFirmTopPcs([row], [firm]);
  check('a company headquartered abroad is passed over', topFor(map, row), 'Ironworks Mfg');
  check('and the skips are counted for the tooltip',
    [map.get('cedar').top.skippedRegion, map.get('cedar').top.skippedStatus], [1, 1]);

  // The same exclusion, arriving from the tracker record rather than the
  // firm's own list - a company nobody has given a Status on the mapped row.
  const prospects = [
    firm,
    { id: 'harbor', company: 'Harbor Foods', type: 'Prospect', status: 'Hold Off' },
  ];
  const unmarked = {
    ...firm,
    portfolioCompanies: [pcRow('Harbor Foods', { energyGwh: 50 }), pcRow('Ironworks Mfg', { energyGwh: 20 })],
  };
  check('a status on the tracker record excludes it too',
    topFor(collectPeFirmTopPcs([row], [unmarked, prospects[1]]), row), 'Ironworks Mfg');

  // Nothing left standing is a null pick, not a crash - and `mapped` says
  // the firm HAS a portfolio, so the row can say which of the two it is.
  const allExcluded = {
    ...firm,
    portfolioCompanies: [pcRow('Rheinwerk GmbH', { hqCity: 'Munich', hqCountry: 'Germany' })],
  };
  const gone = collectPeFirmTopPcs([row], [allExcluded]);
  check('every company filtered out leaves no pick', topFor(gone, row), null);
  check('and the row still knows the portfolio is mapped', gone.get('cedar').mapped, 1);
}

// --- which list is read --------------------------------------------------
{
  // A firm whose portfolio exists only as PE Owner fields on prospects has
  // nothing scored to rank, so it gets no Top PC - and `mapped: 0` is what
  // tells the row to say "nothing mapped yet" rather than "all filtered".
  const firm = { id: 'dunmore', company: 'Dunmore Holdings', type: 'Private Equity' };
  const owned = { id: 'ironworks', company: 'Ironworks Mfg', type: 'Prospect', peOwner: 'Dunmore Holdings' };
  const row = firmRow('Dunmore Holdings', 'dunmore');
  const map = collectPeFirmTopPcs([row], [firm, owned]);
  check('an unmapped portfolio has no Top PC', topFor(map, row), null);
  check('and says so with a zero', map.get('dunmore').mapped, 0);
}

// --- the click-through ---------------------------------------------------
{
  const firm = {
    id: 'elmridge', company: 'Elmridge Capital', type: 'Private Equity',
    portfolioCompanies: [pcRow('Pursuit Aerospace')],
  };
  const row = firmRow('Elmridge Capital', 'elmridge');
  // The tracker writes the same company with a trailing parenthetical, the
  // way roughly one account name in ten is written.
  const tracked = { id: 'pursuit', company: 'Pursuit Aerospace (a Clayton, Dubilier & Rice co.)', type: 'Prospect' };
  check('the Top PC finds its record through an alternate spelling',
    collectPeFirmTopPcs([row], [firm, tracked]).get('elmridge').prospect?.id, 'pursuit');
  check('and an untracked company simply has none',
    collectPeFirmTopPcs([row], [firm]).get('elmridge').prospect, null);
}

// --- keys and not knowing yet -------------------------------------------
{
  // A firm with no record id is keyed by name, so it still finds its own
  // pick rather than nobody's.
  check('a row with no id keys by name', peFirmTopPcKey({ firm: 'Fernbank Group', firmId: null }), 'Fernbank Group');
  check('and by id when it has one', peFirmTopPcKey({ firm: 'Fernbank Group', firmId: 'fern' }), 'fern');
  check('no firms yet is null, not an empty map', collectPeFirmTopPcs(null, []), null);
  check('no prospects yet is not a crash',
    collectPeFirmTopPcs([firmRow('Fernbank Group', 'fern')], null).get('fern'),
    { top: null, mapped: 0, prospect: null });
}

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
