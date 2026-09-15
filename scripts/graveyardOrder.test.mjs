// Assertion tests for where retired services and their box end up.
// Plain Node — no test framework (the project has none). Run:
//   node scripts/graveyardOrder.test.mjs
//
// The rule is one sentence: what nobody sells any more reads greyed and
// sits at the bottom. These pin the half of it that is ordering, plus the
// `muted` set every menu greys from — the half a screenshot would have to
// answer for otherwise.
//
// Two things put a service in the graveyard and they mean the same thing:
// the box it is filed in (any box named for the graveyard, which is the
// user's own box) and the seed catalog's own flag, which marks the handful
// that died before boxes existed.
import {
  getServiceCategories, buildServiceBoard, graveyardTest, graveyardNamesLast,
} from '../src/utils/serviceCategoriesStore.js';
import { getEffectiveDropdownLists, mergeBoardServices } from '../src/utils/dropdownListsStore.js';
import { isGraveyardBucket } from '../src/utils/servicePricing.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.log(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}

// A board with the graveyard filed in the middle, where a user who made the
// box after the others would have it.
const LAYOUT = [
  { name: 'DATA', items: ['Bill payment', 'API/ETL'] },
  { name: 'Old Graveyard', items: ['Zombie service', 'Abandoned tool'] },
  { name: 'Efficiency', items: ['Audits'] },
];
const settings = { customServiceCategories: LAYOUT };

// ── the box ───────────────────────────────────────────────────────────
{
  check('the graveyard box goes last',
    getServiceCategories(settings).map(c => c.name),
    ['DATA', 'Efficiency', 'Old Graveyard']);

  // Box order groups the business and is the user's own; only the
  // graveyard moves.
  check('the live boxes keep the order they were in',
    getServiceCategories({
      customServiceCategories: [
        { name: 'Zeta', items: [] }, { name: 'Alpha', items: [] },
      ],
    }).map(c => c.name),
    ['Zeta', 'Alpha']);

  // Whatever the user called it. The box is theirs to name.
  check('any box named for the graveyard sinks',
    ['Graveyard', 'Old Graveyard', 'graveyard (2024)', 'DATA', '', null].map(isGraveyardBucket),
    [true, true, true, false, false, false]);

  // "Other services" is live work nobody has filed yet, so it belongs
  // above the dead rather than under them.
  check('the catch-all card still sits above the graveyard',
    buildServiceBoard(settings, ['Bill payment', 'Unfiled thing']).map(c => c.name),
    ['DATA', 'Efficiency', 'Other services', 'Old Graveyard']);
}

// ── the services ──────────────────────────────────────────────────────
{
  const isDead = graveyardTest(settings);
  check('a service in the box is dead', isDead('Zombie service'), true);
  check('a service in a live box is not', isDead('Bill payment'), false);
  // Matched the way every other reader of these names matches them.
  check('case and padding do not decide it', isDead('  zOMBIE SERVICE '), true);
  check('nothing is not a service', [isDead(''), isDead(null)], [false, false]);
  // The seed's own flag, on a service this board files nowhere.
  check('the seed catalog can say so too', isDead('WELL'), true);

  check('retired names go last, each half in the order it arrived',
    graveyardNamesLast(['Audits', 'Zombie service', 'Bill payment', 'Abandoned tool'], isDead),
    ['Audits', 'Bill payment', 'Zombie service', 'Abandoned tool']);
  check('a list with nothing retired is left alone',
    graveyardNamesLast(['Audits', 'Bill payment'], isDead),
    ['Audits', 'Bill payment']);
}

// ── the Solutions list ────────────────────────────────────────────────
{
  const list = mergeBoardServices(['Audits', 'Zombie service', 'Bill payment'], settings);
  check('the live half is alphabetical and first',
    list.slice(0, 3), ['API/ETL', 'Audits', 'Bill payment']);
  check('and the retired half is alphabetical at the end',
    list.slice(3), ['Abandoned tool', 'Zombie service']);

  // What the menus grey from. Named on the list itself so a cell can grey a
  // retired service without knowing what a services board is.
  const solutions = getEffectiveDropdownLists(settings).find(l => l.key === 'solutions');
  const isDead = graveyardTest(settings);
  check('every muted name is a retired one', solutions.muted.every(isDead), true);
  check('and every retired option is muted',
    solutions.options.filter(isDead).length, solutions.muted.length);
  check('the muted ones are the tail of the list',
    solutions.options.slice(-solutions.muted.length), solutions.muted);

  // Only Solutions has a graveyard. Every other list serves an empty set
  // rather than nothing, so a consumer never has to guard.
  const others = getEffectiveDropdownLists(settings).filter(l => l.key !== 'solutions');
  check('no other list mutes anything',
    others.every(l => Array.isArray(l.muted) && l.muted.length === 0), true);
}

// ── a board with no graveyard at all ──────────────────────────────────
{
  const plain = { customServiceCategories: [{ name: 'DATA', items: ['Bill payment'] }] };
  check('nothing is reordered when no box is one',
    getServiceCategories(plain).map(c => c.name), ['DATA']);
  const solutions = getEffectiveDropdownLists(plain).find(l => l.key === 'solutions');
  // The seed's six still are, wherever they are filed: that flag is the
  // same statement the box makes.
  check('the seed-flagged ones are still the muted ones',
    solutions.muted, ['Greenstruxure', 'Incentives/taxes', 'IREM', 'KPI', 'SEC Reporting', 'WELL']);
}

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
