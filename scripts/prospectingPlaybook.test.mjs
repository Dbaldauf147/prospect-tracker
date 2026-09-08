// Assertion tests for the editable Prospecting ladder. Plain Node — no test
// framework (the project has none). Run:
//   node scripts/prospectingPlaybook.test.mjs
//
// The risky part isn't the reordering, it's the merge. Four of the steps
// have behaviour bolted to their `key` — the overdue-opps count, the
// renewals count, the service-coverage and Top-PC lists — and the user's
// stored copy carries text only. Two ways that goes wrong quietly:
//
//   - a retitled built-in loses its count, so the row silently stops
//     answering for itself and starts asking to be ticked by hand;
//   - a step the user added picks up a built-in's key and inherits a count
//     that isn't about it at all.
//
// Both are covered below, along with the round trip (what's stored is only
// what the user changed, so untouched copy keeps tracking the default).
import {
  DEFAULT_STEPS,
  isCustomStep,
  moveStep,
  newStepKey,
  PROSPECTING_STEPS_SETTING,
  readSteps,
  serializeSteps,
  isCustomized,
  viewLabelFor,
} from '../src/utils/prospectingPlaybook.js';

let failures = 0;
function check(label, actual, expected) {
  const ok = Object.is(actual, expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`}`);
}
function checkDeep(label, actual, expected) {
  check(label, JSON.stringify(actual), JSON.stringify(expected));
}

const withSteps = (v) => ({ [PROSPECTING_STEPS_SETTING]: v });
const keys = (steps) => steps.map(s => s.key);
const byKey = (steps, k) => steps.find(s => s.key === k);

// --- untouched settings ---------------------------------------------------
check('no settings → defaults', readSteps(null).length, DEFAULT_STEPS.length);
check('unrelated settings → defaults', readSteps({ cdmName: 'x' })[0].key, 'opps');
check('not customized before the first edit', isCustomized({ cdmName: 'x' }), false);
check('customized once an array is stored', isCustomized(withSteps([])), true);
check('an emptied ladder stays empty', readSteps(withSteps([])).length, 0);

// --- the merge: behaviour survives an edit --------------------------------
const renamed = readSteps(withSteps([
  { key: 'opps', title: 'Chase the deals I already have' },
  { key: 'cold' },
]));
checkDeep('stored order wins', keys(renamed), ['opps', 'cold']);
check('the new title is used', byKey(renamed, 'opps').title, 'Chase the deals I already have');
check('a retitled built-in keeps its count', typeof byKey(renamed, 'opps').workLabel, 'function');
check('and its work tooltip', typeof byKey(renamed, 'opps').workTitle, 'function');
check('untouched copy still tracks the default', byKey(renamed, 'opps').detail, DEFAULT_STEPS[0].detail);
check('an untracked step stays untracked', byKey(renamed, 'cold').workLabel, undefined);

// A step the user added is hand-marked: nothing counts it.
const custom = readSteps(withSteps([{ key: 'ps_abc', title: 'Conference follow-ups', view: 'contacts' }]));
check('a custom step renders', custom[0].title, 'Conference follow-ups');
check('a custom step is not counted', custom[0].workLabel, undefined);
check('its button is named for its tab', custom[0].viewLabel, 'Contacts');
check('new keys are recognisably custom', isCustomStep(newStepKey()), true);
check('built-in keys are not', isCustomStep('opps'), false);

// --- re-pointing a step at another tab ------------------------------------
const repointed = readSteps(withSteps([{ key: 'opps', view: 'clients' }]));
check('the view is taken from settings', repointed[0].view, 'clients');
check('and the label follows it', repointed[0].viewLabel, 'Clients');
const untargeted = readSteps(withSteps([{ key: 'opps', view: '' }]));
check('a cleared tab survives the round trip', untargeted[0].view, '');
check('and leaves no label behind', untargeted[0].viewLabel, '');
check('viewLabelFor falls back when a tab is unknown', viewLabelFor('nope', 'Fallback'), 'Fallback');

// --- malformed input ------------------------------------------------------
const messy = readSteps(withSteps([
  null,
  'nope',
  { title: 'no key' },
  { key: 'opps' },
  { key: 'opps', title: 'duplicate' },   // first one wins
  { key: 'ps_x' },                       // custom with no title: nothing to show
]));
checkDeep('junk is dropped, not thrown on', keys(messy), ['opps']);
check('the duplicate did not overwrite', messy[0].title, DEFAULT_STEPS[0].title);

// --- serialize: store only what changed -----------------------------------
const asIs = serializeSteps(DEFAULT_STEPS);
check('an unedited ladder stores keys only', JSON.stringify(asIs[0]), JSON.stringify({ key: 'opps' }));
check('every step is still listed', asIs.length, DEFAULT_STEPS.length);

// Looked up by key, not by index: a step inserted into the shipped ladder
// (the market-updates split added one) must not silently retarget these.
const stepByKey = (key) => DEFAULT_STEPS.find(s => s.key === key);
const edited = serializeSteps([{ ...stepByKey('opps'), title: 'Mine' }, stepByKey('cold')]);
checkDeep('an edited title is stored', edited[0], { key: 'opps', title: 'Mine' });
checkDeep('an unedited neighbour is not', edited[1], { key: 'cold' });

// Round trip: what comes back out is what went in.
const roundTrip = readSteps(withSteps(serializeSteps([
  { ...stepByKey('cold') },
  { ...stepByKey('opps'), detail: 'my own words' },
  { key: 'ps_new', title: 'Added step', detail: '', view: 'pe' },
])));
checkDeep('order round-trips', keys(roundTrip), ['cold', 'opps', 'ps_new']);
check('edited detail round-trips', byKey(roundTrip, 'opps').detail, 'my own words');
check('the count survives the round trip', typeof byKey(roundTrip, 'opps').workLabel, 'function');
check('the added step round-trips', byKey(roundTrip, 'ps_new').viewLabel, 'PE Portfolio');

// --- the market-updates split --------------------------------------------
// Tagging the book and writing to it were one step; they are two now. A
// stored ladder IS the ladder, so a default it doesn't carry is one the
// user deleted and stays deleted — except this one, which they never had
// the chance to delete. It goes back exactly where its work used to be
// shown: immediately above the step it was split out of.
checkDeep('the shipped ladder maps before it writes',
  keys(DEFAULT_STEPS).slice(0, 3), ['opps', 'contact-mapping', 'market-updates']);
check('the campaigns step opens the campaigns tab',
  stepByKey('market-updates').view, 'campaigns');
check('both halves go red once the ladder reaches them',
  !!stepByKey('contact-mapping').dueWhenReached && !!stepByKey('market-updates').dueWhenReached, true);

const preSplit = readSteps(withSteps([{ key: 'opps' }, { key: 'market-updates' }, { key: 'cold' }]));
checkDeep('a ladder stored before the split gains the mapping step',
  keys(preSplit), ['opps', 'contact-mapping', 'market-updates', 'cold']);
check('and it arrives whole, not as a bare key',
  byKey(preSplit, 'contact-mapping').title, stepByKey('contact-mapping').title);
check('an edit to the step it split from is untouched',
  readSteps(withSteps([{ key: 'market-updates', title: 'Mine' }]))
    .find(s => s.key === 'market-updates').title, 'Mine');
checkDeep('a ladder that already has both is left alone',
  keys(readSteps(withSteps([{ key: 'contact-mapping' }, { key: 'market-updates' }]))),
  ['contact-mapping', 'market-updates']);
checkDeep('a ladder with neither gets neither: that step was deleted',
  keys(readSteps(withSteps([{ key: 'opps' }, { key: 'cold' }]))), ['opps', 'cold']);
checkDeep('an emptied ladder stays empty', keys(readSteps(withSteps([]))), []);

// --- moving --------------------------------------------------------------
const three = [{ key: 'a' }, { key: 'b' }, { key: 'c' }];
checkDeep('move down swaps with the next', keys(moveStep(three, 0, 1)), ['b', 'a', 'c']);
checkDeep('move up swaps with the previous', keys(moveStep(three, 2, -1)), ['a', 'c', 'b']);
check('off the top is a no-op', moveStep(three, 0, -1), three);
check('off the bottom is a no-op', moveStep(three, 2, 1), three);
check('an out-of-range index is a no-op', moveStep(three, 9, -1), three);
checkDeep('the original is not mutated', keys(three), ['a', 'b', 'c']);

console.log(failures === 0 ? '\nAll passed.' : `\n${failures} failed.`);
process.exit(failures === 0 ? 0 : 1);
