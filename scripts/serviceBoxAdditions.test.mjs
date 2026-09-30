// Assertion tests for carrying a new services-board box onto a saved layout.
// Plain Node, no test framework. Run:
//   node scripts/serviceBoxAdditions.test.mjs
import { planServiceBoxAddition, SERVICE_BOX_ADDITIONS } from '../src/utils/serviceBoxAdditions.js';
import { SERVICE_CATEGORIES } from '../src/data/enums.js';

let failures = 0;
function check(name, cond, detail) {
  if (cond) return;
  failures += 1;
  console.error(`FAIL ${name}${detail ? `\n     ${detail}` : ''}`);
}
function eq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  check(name, a === e, `expected ${e}\n     got      ${a}`);
}

const COMMS = SERVICE_BOX_ADDITIONS.find(a => a.box === 'Communication Services');
check('the Communication Services addition ships', !!COMMS);

// --- the seed ----------------------------------------------------------------
const seedBox = SERVICE_CATEGORIES.find(c => c.name === 'Communication Services');
eq('seed box holds the fourteen services', seedBox?.items.length, 14);
check('seed no longer files Communication Services as a service',
  !SERVICE_CATEGORIES.some(c => c.items.includes('Communication Services')));
const names = SERVICE_CATEGORIES.map(c => c.name);
eq('seed box sits after Consulting Services',
  names.indexOf('Communication Services'), names.indexOf('Consulting Services') + 1);
for (const a of SERVICE_BOX_ADDITIONS) {
  check(`seed carries every shipped box (${a.box})`, names.includes(a.box));
}

// --- nothing to do -----------------------------------------------------------
eq('an unsaved layout is the seed, which has the box already',
  planServiceBoxAddition(COMMS, {}), null);
eq('a saved layout that already has the box is left alone',
  planServiceBoxAddition(COMMS, { customServiceCategories: [{ name: 'Communication Services', items: ['X'] }] }), null);

// --- a saved layout ------------------------------------------------------------
const saved = {
  customServiceCategories: [
    { name: 'DATA', items: ['IDM', 'Video Storytelling'] },
    { name: 'Consulting Services', items: ['ESG report', 'communication services'] },
    { name: 'Graveyard', items: ['Old thing'] },
  ],
  dropdownLists: { solutions: ['IDM', 'Communication Services', 'ESG report'], industries: ['A'] },
};
const patch = planServiceBoxAddition(COMMS, saved);
const cats = patch.customServiceCategories;
eq('box lands after Consulting Services',
  cats.map(c => c.name), ['DATA', 'Consulting Services', 'Communication Services', 'Graveyard']);
eq('box holds the seed services', cats[2].items, seedBox.items);
eq('a service filed elsewhere moves into the box', cats[0].items, ['IDM']);
eq('the old single service is retired from its box', cats[1].items, ['ESG report']);
eq('the old single service leaves the Solutions list',
  patch.dropdownLists.solutions, ['IDM', 'ESG report']);
eq('other dropdown lists are untouched', patch.dropdownLists.industries, ['A']);
eq('the saved layout is not mutated', saved.customServiceCategories[0].items, ['IDM', 'Video Storytelling']);

const noAnchor = planServiceBoxAddition(COMMS, { customServiceCategories: [{ name: 'DATA', items: [] }] });
eq('box goes on the end when its neighbour is gone',
  noAnchor.customServiceCategories.map(c => c.name), ['DATA', 'Communication Services']);
eq('no Solutions write when the list never had the old name', noAnchor.dropdownLists, undefined);

if (failures) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log('PASS serviceBoxAdditions');
