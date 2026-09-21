// Assertion tests for one account's standing on a service. Plain Node - no
// test framework (the project has none). Run:
//   node scripts/scopeServiceStatus.test.mjs
//
// The rules worth pinning: the three layers rank manual > another opp's
// stage > an N/A implied by a sale, a status nobody picked is marked
// derived so a board can paint it in italic, the opp being edited never
// votes on its own scope, a name spelled differently on the card still
// finds its status, and a sale recorded on the card outside this scope
// still retires what it retires.
import {
  scopeServiceStatuses, buildAutoStatuses, scopeStatusTitle,
} from '../src/utils/scopeServiceStatus.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.log(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}

const SERVICES = ['Bill payment', 'Budgets', 'GHG', 'Strategic sourcing'];

// Two other opps on the same account, plus the one being edited and one
// belonging to somebody else.
const oppRows = [
  { _id: 'a', Account: 'Park Hotels & Resorts', Stage: 'Quoted', Scope: 'Bill payment' },
  { _id: 'b', Account: 'Park Hotels & Resorts, Inc.', Stage: 'Sold', Scope: 'GHG; Budgets' },
  { _id: 'me', Account: 'Park Hotels & Resorts', Stage: 'Lead', Scope: 'Strategic sourcing' },
  { _id: 'z', Account: 'Hilton', Stage: 'Sold', Scope: 'Strategic sourcing' },
];

const read = (map, name) => {
  const v = map.get(name);
  return v ? [v.status, v.derived] : null;
};

// ── the automatic layer ──────────────────────────────────────────────────
const auto = buildAutoStatuses({
  account: 'Park Hotels & Resorts', oppRows, items: SERVICES, currentOppId: 'me',
});
check('another opp lends its stage', auto.get('Bill payment'), 'Quoted');
// companiesMatch is the same fuzzy rule the company card uses, so the opp
// filed under the legal name answers for the account without it.
check('a near-matching account counts', auto.get('GHG'), 'Sold');
// The opp being edited is the one whose scope is on screen: counting it
// would echo the current selection back as though it were history.
check('the current opp does not vote', auto.get('Strategic sourcing'), undefined);
// A different account's deal says nothing about this one.
check('another account does not vote', auto.has('Strategic sourcing'), false);
check('no account, no automatic status', buildAutoStatuses({ account: '', oppRows, items: SERVICES }).size, 0);

// ── the three layers together ────────────────────────────────────────────
const statuses = scopeServiceStatuses({
  services: SERVICES,
  account: 'Park Hotels & Resorts',
  oppRows,
  currentOppId: 'me',
  // Spelled in the card's own casing, which is not always the board's.
  manualStatuses: { 'bill payment': 'Not Sold', 'Strategic sourcing': '-' },
  serviceOverrides: { 'GHG': { autoNa: 'Budgets' } },
});
// A picked status outranks the opp that would otherwise have said Quoted.
check('manual wins, and is not derived', read(statuses, 'Bill payment'), ['Not Sold', false]);
// Nobody picked this one: the sold opp did.
check('an opp stage is derived', read(statuses, 'GHG'), ['Sold', true]);
// GHG is sold and retires Budgets - but Budgets has a stage of its own from
// the same opp, and the stage layer outranks the N/A one.
check('a stage outranks an implied N/A', read(statuses, 'Budgets'), ['Sold', true]);
// Nothing has an opinion: a '-' on the card is not a status.
check('a dash is no status', read(statuses, 'Strategic sourcing'), ['', false]);

// The N/A layer on its own: no opp names Budgets, so the sale that retires
// it is the only thing left with an opinion.
const naOnly = scopeServiceStatuses({
  services: ['Budgets'],
  account: 'Park Hotels & Resorts',
  oppRows: [],
  manualStatuses: { 'GHG': 'Sold' },
  serviceOverrides: { 'GHG': { autoNa: 'Budgets' } },
});
// The sale is on the card but outside the scope being priced, which is
// exactly where an account's history usually sits.
check('a sale outside the scope still retires', read(naOnly, 'Budgets'), ['N/A', true]);
check('and says which sale did it', naOnly.get('Budgets').autoNa, ['GHG']);
check('unless the caller says not to look', read(scopeServiceStatuses({
  services: ['Budgets'],
  account: 'Park Hotels & Resorts',
  oppRows: [],
  manualStatuses: { 'GHG': 'Sold' },
  serviceOverrides: { 'GHG': { autoNa: 'Budgets' } },
  soldElsewhere: false,
}), 'Budgets'), ['', false]);

// No services in, nothing out - and no account is not a crash.
check('an empty scope reads empty', scopeServiceStatuses({ services: [] }).size, 0);
check('no account still reads the card', read(scopeServiceStatuses({
  services: ['Bill payment'], manualStatuses: { 'Bill payment': 'Sold' },
}), 'Bill payment'), ['Sold', false]);

// ── what the control says about itself ───────────────────────────────────
check('a read-only control says why', scopeStatusTitle({
  item: 'GHG', manual: 'Sold', disabledReason: 'No company record.',
}), 'No company record.');
check('a picked status names the one it overrode', scopeStatusTitle({
  item: 'GHG', manual: 'Not Sold', auto: 'Quoted',
}), 'Manual override: Not Sold. Automatic status from another opp: Quoted. Pick "- (auto)" to revert.');
check('a derived one names where it came from', scopeStatusTitle({ item: 'GHG', auto: 'Quoted' }),
  'Automatic status from another opp on this account: Quoted. Pick a status to set a manual override.');
check('an implied N/A explains the sale', scopeStatusTitle({ item: 'Budgets', autoNa: ['GHG'] }).startsWith('N/A automatically: GHG is sold'), true);
check('and a blank one invites a pick', scopeStatusTitle({ item: 'GHG' }),
  'No status yet. Pick one to set it on the company card.');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
