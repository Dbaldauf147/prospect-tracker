// Assertion tests for the Scope a deal pulls off its opp. Plain Node - no
// test framework (the project has none). Run:
//   node scripts/dealOppScope.test.mjs
//
// The failures worth guarding are the ones that would put the wrong scope
// against a deal: matching on the '-' / '#N/A' placeholders both sides use
// for "no BFO opp yet", or losing half a pooled scope when two opps share
// one BFO opportunity name.
import {
  indexOppScopeByBfo, oppScopeForDeal, oppScopeText, OPP_BFO_KEY,
} from '../src/utils/dealOppScope.js';
import { DEAL_BFO_KEY } from '../src/utils/dealCommissions.js';

let pass = 0, fail = 0;
const ok = (c, n) => (c ? (pass += 1, console.log('PASS ', n)) : (fail += 1, console.log('FAIL ', n)));
const eq = (a, b, n) => ok(JSON.stringify(a) === JSON.stringify(b), `${n} (got ${JSON.stringify(a)})`);

const opp = (bfo, scope, over = {}) => ({ [OPP_BFO_KEY]: bfo, Account: 'Acme', Scope: scope, ...over });
const deal = (bfo, over = {}) => ({ 'Client Name': 'Acme', [DEAL_BFO_KEY]: bfo, ...over });

// --- the index ---------------------------------------------------------------
{
  const map = indexOppScopeByBfo([
    opp('Acme - SUSUP - 2026', 'Comp GHG; Budgets, Invoice collection'),
    opp('-', 'Never matched'),
    opp('#N/A', 'Never matched'),
    opp('', 'Never matched'),
    { Account: 'No BFO key', Scope: 'Never matched' },
  ]);
  eq([...map.keys()], ['acme - susup - 2026'], 'only real BFO names are indexed');
  const hit = map.get('acme - susup - 2026');
  eq(hit.items, ['Comp GHG', 'Budgets', 'Invoice collection'], 'Scope splits on commas and semicolons');
  eq(hit.oppCount, 1, 'one opp behind this name');
  eq(hit.accounts, ['Acme'], 'the account the scope came from');
}

// --- two opps under one BFO name ---------------------------------------------
{
  const map = indexOppScopeByBfo([
    opp('Acme - SUSUP - 2026', 'Comp GHG, Budgets'),
    opp('ACME - SUSUP - 2026 ', 'comp ghg / UPRs', { Account: 'Acme Corp' }),
  ]);
  eq(map.size, 1, 'the name matches loosely, so the two pool into one entry');
  const hit = map.get('acme - susup - 2026');
  eq(hit.items, ['Comp GHG', 'Budgets', 'UPRs'], 'scopes pool, and a repeat keeps the first spelling');
  eq(hit.oppCount, 2, 'the entry says how many opps it came from');
  eq(hit.accounts, ['Acme', 'Acme Corp'], 'both accounts, deduped, in order');
}

// --- an opp with nothing in Scope --------------------------------------------
{
  const map = indexOppScopeByBfo([opp('Acme - SUSUP - 2026', '   ')]);
  const hit = map.get('acme - susup - 2026');
  ok(!!hit, 'an opp with an empty Scope still makes an entry');
  eq(hit.items, [], 'with no items on it');
  // The two read differently on the grid: "its opp has no scope yet" is a
  // cell to go and fill in, "no opp is tied to this deal" is a BFO name to
  // go and set.
  eq(oppScopeForDeal(map, deal('Somebody else - 2026')), null, 'an unmatched deal gets null, not an empty entry');
}

// --- the deal side -----------------------------------------------------------
{
  const map = indexOppScopeByBfo([opp('Acme - SUSUP - 2026', 'Comp GHG, Budgets')]);
  eq(oppScopeText(oppScopeForDeal(map, deal(' acme - SUSUP - 2026 '))), 'Comp GHG, Budgets',
    'a deal finds its opp through trimming and case');
  eq(oppScopeForDeal(map, deal('-')), null, 'the "needs a BFO opp" dash matches nothing');
  eq(oppScopeForDeal(map, deal('#N/A')), null, 'nor does #N/A out of the sheet');
  eq(oppScopeForDeal(map, deal('')), null, 'nor does a blank cell');
  eq(oppScopeForDeal(null, deal('Acme - SUSUP - 2026')), null, 'no index, no scope');
  eq(oppScopeText(null), '', 'nothing to show reads as empty text');
}

// --- nothing to index --------------------------------------------------------
{
  eq(indexOppScopeByBfo().size, 0, 'no records, no entries');
  eq(indexOppScopeByBfo([]).size, 0, 'an empty roster, likewise');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
