// Assertion tests for the company Type vocabulary. Plain Node — no test
// framework (the project has none). Run:
//   node scripts/typeOptions.test.mjs
//
// Type used to be a hard-coded enum on the company card while the Dropdowns
// tab carried its own editable "Type" list that only My Accounts read. The
// two disagreed, and nothing the user did on the Dropdowns tab reached the
// card. Now every Type picker builds its options here, so what's guarded is
// the merge: the managed list leads, a Type already on a company is never
// dropped, and an emptied list still leaves something to pick.
import { buildTypeOptions, getTypeListOptions, persistCustomOption, TYPE_LIST_KEY } from '../src/utils/prospectOptions.js';
import { TYPES } from '../src/data/enums.js';
import { DROPDOWN_LISTS } from '../src/data/dropdownLists.js';

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

const SEED_TYPE_LIST = DROPDOWN_LISTS.find(l => l.key === TYPE_LIST_KEY)?.options || [];

// --- the seed list covers what the card used to offer -----------------------
// The card read TYPES before this; anything in there that the managed list
// lacks is a Type the user could set yesterday and can't today.
for (const t of TYPES) {
  check(`the seed Type list carries the built-in "${t}"`,
    SEED_TYPE_LIST.some(o => o.toLowerCase() === t.toLowerCase()));
}
check('the seed Type list has no duplicates',
  new Set(SEED_TYPE_LIST.map(o => o.toLowerCase())).size === SEED_TYPE_LIST.length);

// --- a fresh account reads the seed list ------------------------------------
eq('no settings: the seed list, in its own order', buildTypeOptions([], {}), SEED_TYPE_LIST);
eq('no settings: getTypeListOptions agrees', getTypeListOptions({}), SEED_TYPE_LIST);

// --- the managed list leads, in the order it was arranged -------------------
{
  const settings = { dropdownLists: { [TYPE_LIST_KEY]: ['Zebra', 'Alpha', 'Owner Operator'] } };
  eq('managed list wins, unsorted',
    buildTypeOptions([], settings), ['Zebra', 'Alpha', 'Owner Operator']);
  eq('a built-in the user removed is gone',
    buildTypeOptions([], settings).includes('Private Equity'), false);
}

// --- a Type in use is never dropped off the picker --------------------------
{
  const settings = { dropdownLists: { [TYPE_LIST_KEY]: ['Alpha'] } };
  const prospects = [{ type: 'Retired Type' }, { type: 'Alpha' }, { type: '' }, null];
  eq('a value still on a company stays offered',
    buildTypeOptions(prospects, settings), ['Alpha', 'Retired Type']);
}

// --- de-dupe is case-insensitive, first spelling wins ------------------------
{
  const settings = { dropdownLists: { [TYPE_LIST_KEY]: ['Alpha'] }, customTypes: ['ALPHA', 'Beta'] };
  eq('casing drift collapses to the list\'s spelling',
    buildTypeOptions([{ type: 'alpha' }], settings), ['Alpha', 'Beta']);
}

// --- an emptied or hidden list falls back to the built-ins -------------------
eq('emptied list: built-in TYPES rather than an empty picker',
  buildTypeOptions([], { dropdownLists: { [TYPE_LIST_KEY]: [] } }), TYPES);
eq('hidden list: same fallback',
  buildTypeOptions([], { dropdownListsHidden: [TYPE_LIST_KEY] }), TYPES);
eq('hidden list: an in-use value still comes through',
  buildTypeOptions([{ type: 'Retired Type' }], { dropdownListsHidden: [TYPE_LIST_KEY] }),
  [...TYPES, 'Retired Type']);

// --- malformed settings don't throw -----------------------------------------
eq('no arguments at all', buildTypeOptions(undefined, undefined), SEED_TYPE_LIST);
eq('a non-array list override is ignored',
  buildTypeOptions([], { dropdownLists: { [TYPE_LIST_KEY]: 'nope' } }), SEED_TYPE_LIST);

// --- "+ Add new Type…" lands on the managed list ----------------------------
{
  let written = null;
  const settings = { dropdownLists: { [TYPE_LIST_KEY]: ['Alpha'], stage: ['3'] } };
  persistCustomOption('type', 'Beta', settings, (patch) => { written = patch; });
  eq('a new Type joins the Dropdowns list', written.dropdownLists[TYPE_LIST_KEY], ['Alpha', 'Beta']);
  eq('other lists are left alone', written.dropdownLists.stage, ['3']);
  check('it does not go to customTypes', written.customTypes === undefined);

  written = null;
  persistCustomOption('type', 'alpha', settings, (patch) => { written = patch; });
  check('a Type already on the list is a no-op', written === null);

  written = null;
  persistCustomOption('type', '   ', settings, (patch) => { written = patch; });
  check('a blank name is a no-op', written === null);
}

// --- with no managed list, the legacy setting still catches it ---------------
{
  let written = null;
  const settings = { dropdownLists: { [TYPE_LIST_KEY]: [] }, customTypes: [] };
  persistCustomOption('type', 'Beta', settings, (patch) => { written = patch; });
  eq('falls back to customTypes', written.customTypes, ['Beta']);

  written = null;
  persistCustomOption('type', 'Private Equity', settings, (patch) => { written = patch; });
  check('a built-in name is not re-added as a custom', written === null);
}

if (failures) {
  console.error(`\n${failures} assertion(s) failed.`);
  process.exit(1);
}
console.log('typeOptions: all assertions passed.');
