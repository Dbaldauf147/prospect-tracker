// Assertion tests for "where did that service go" on Account Potential.
// Plain Node — no test framework (the project has none). Run:
//   node scripts/accountPotentialUnlisted.test.mjs
//
// The rules worth pinning: a service ON the table is never explained away,
// each of the three rules that take a service off is named in its own
// words, the term is matched the way the table's own search matches it, and
// a term too short to mean one service explains nothing rather than
// explaining forty.
import { unlistedMatches, describeUnlisted } from '../src/utils/accountPotentialUnlisted.js';
import { serviceDecision } from '../src/utils/accountPotential.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.log(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}

const BUNDLES = [
  {
    lead: { name: 'Strategic sourcing' },
    adds: [
      { name: 'Bill payment', open: true },
      // Comes with the sale but already sold, so it is named in the bundle
      // and is not new money. It is not on the table either, but the reason
      // is its status rather than the bundle.
      { name: 'Client management', open: false },
    ],
  },
];
const DECIDED = [
  { name: 'Budgets', status: 'Sold', fromOpp: false },
  { name: 'Rate optimization', status: 'Quoted', fromOpp: true },
];
const HIDDEN = ['Water Cost Recovery'];
const base = {
  visibleNames: ['Strategic sourcing', 'Invoice recalculation'],
  hidden: HIDDEN,
  decided: DECIDED,
  bundles: BUNDLES,
};

// --- a row on screen is its own answer --------------------------------
check('a service the table is showing needs no explanation',
  unlistedMatches({ ...base, term: 'Strategic sourcing' }).entries, []);
// It matches a visible row AND nothing else, so there is nothing to say.
check('a term matching only visible rows says nothing',
  unlistedMatches({ ...base, term: 'Invoice recal' }).entries.length, 0);

// --- each rule, in its own words ---------------------------------------
{
  const { entries } = unlistedMatches({ ...base, term: 'Bill payment' });
  check('a bundled service is found', entries.map(e => [e.name, e.reason, e.lead]),
    [['Bill payment', 'bundled', 'Strategic sourcing']]);
  check('and says which row is holding it',
    describeUnlisted(entries[0], 'Acme'),
    'Bill payment comes with Strategic sourcing, so it is priced inside that row.');
}
{
  const { entries } = unlistedMatches({ ...base, term: 'budgets' });
  check('a decided service is found', [entries[0].reason, entries[0].status], ['decided', 'Sold']);
  // Which record is holding the status, because the two are undone in
  // different places.
  check('a status typed on the card says so',
    describeUnlisted(entries[0], 'Acme'),
    'Budgets is not whitespace on Acme: the company card has it as Sold.');
}
{
  const { entries } = unlistedMatches({ ...base, term: 'rate optim' });
  check('a status an opp implies says that instead',
    describeUnlisted(entries[0], 'Acme'),
    'Rate optimization is not whitespace on Acme: an opp has it at Quoted.');
  check('with no company picked it still reads',
    describeUnlisted(entries[0], ''),
    'Rate optimization is not whitespace here: an opp has it at Quoted.');
}
{
  const { entries } = unlistedMatches({ ...base, term: 'water cost' });
  check('a hidden service is found', entries[0].reason, 'hidden');
  check('and points at the tab that hid it',
    describeUnlisted(entries[0], 'Acme'),
    'Water Cost Recovery is hidden on the Services tab, so nothing here prices it.');
}

// A service that comes with the sale but is already sold is off the table
// for its status, not for the bundle - and it is the decided list that is
// read first, so that is the reason it gives.
{
  const { entries } = unlistedMatches({
    ...base,
    term: 'client management',
    decided: [...DECIDED, { name: 'Client management', status: 'Sold', fromOpp: false }],
  });
  check('the status wins over the bundle', entries.map(e => e.reason), ['decided']);
}

// --- matched the way the table matches ---------------------------------
check('case does not matter', unlistedMatches({ ...base, term: 'BILL PAY' }).entries.length, 1);
check('a partial word is enough', unlistedMatches({ ...base, term: 'ill pay' }).entries.length, 1);
// One or two characters is somebody typing, not somebody looking for a
// service, and a panel that fires on "b" is a panel in the way.
check('one character explains nothing', unlistedMatches({ ...base, term: 'b' }).entries, []);
check('two still do not', unlistedMatches({ ...base, term: 'bi' }).entries, []);
check('an empty box is not a search', unlistedMatches({ ...base, term: '   ' }).entries, []);

// --- a term that matches half the catalogue ----------------------------
{
  const many = unlistedMatches({
    ...base,
    term: 'ing',
    decided: [
      { name: 'Reporting', status: 'Sold', fromOpp: false },
      { name: 'Invoicing', status: 'Sold', fromOpp: false },
      { name: 'Sourcing support', status: 'Sold', fromOpp: false },
      { name: 'Metering', status: 'Sold', fromOpp: false },
    ],
  });
  check('capped at three', many.entries.length, 3);
  check('and says how many it left out', many.more, 1);
}

// Nothing matches: the table's own "no services match" message is the
// answer, and a second panel repeating it is noise.
check('a term matching nothing at all', unlistedMatches({ ...base, term: 'zzzz' }),
  { entries: [], more: 0 });
check('no arguments at all', unlistedMatches(), { entries: [], more: 0 });
check('an entry with no name describes nothing', describeUnlisted(null, 'Acme'), '');

// --- the decision knows which record it came from ----------------------
// describeUnlisted leans on this, so it is pinned here rather than only in
// the page that reads it.
{
  const manual = serviceDecision({ servicesExplored: { X: 'Sold' } }, 'X');
  check('a status typed on the card is not from an opp', manual.fromOpp, false);
  const fromOpp = serviceDecision({ servicesExplored: {} }, 'X', new Map([['X', 'Quoted']]));
  check('one an opp implies is', [fromOpp.status, fromOpp.fromOpp], ['Quoted', true]);
  // The card's blank sentinel is not a status, so the opp is still the
  // source when a row carries one.
  const dashed = serviceDecision({ servicesExplored: { X: '-' } }, 'X', new Map([['X', 'Lead']]));
  check('the blank sentinel does not claim it', dashed.fromOpp, true);
  const undecided = serviceDecision({ servicesExplored: {} }, 'X');
  check('nothing decided it, so nothing claims it', undecided.fromOpp, false);
}

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
