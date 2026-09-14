// Assertion tests for the Scope picker's commodity row - what a scope is
// about, as opposed to the services it lists. Plain Node - no test
// framework (the project has none). Run:
//   node scripts/commodities.test.mjs
//
// The rule worth pinning hardest is that commodities and services never mix.
// Scope is read as a list of service names in several places at once - the
// Pipeline coverage table, the company card's services board, scopeMatch -
// and a commodity that leaked into that string would be carried by all of
// them as a service nobody has ever heard of. So the picks live in their
// own field, and the Deal Sizing scope keeps them in their own array.
//
// The second is that the vocabulary belongs to the user. It is an ordinary
// Dropdowns list, which means it can be renamed, reordered, added to, and
// emptied - and a commodity taken off the list has to stay ticked on the
// opps already carrying it rather than vanishing from records nobody is
// looking at.
import {
  COMMODITY_COLUMN, COMMODITY_LIST_KEY,
  commodityOptions, parseCommodities, formatCommodities,
  toggleCommodity, hasCommodity, splitCommodities,
} from '../src/utils/commodities.js';
import { normalizeClientScope, scopeIsEmpty } from '../src/utils/clientDealSizing.js';

let failures = 0;
function check(label, actual, expected) {
  const ok = Object.is(actual, expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n      got:  ${actual}\n      want: ${expected}`}`);
}

const DEFAULTS = ['Electric', 'Natural Gas', 'Water', 'Waste'];

// ---- the vocabulary -----------------------------------------------------
{
  check('the four standard commodities ship by default',
    commodityOptions({}).join(', '), DEFAULTS.join(', '));
  check('the list is an ordinary Dropdowns list', COMMODITY_LIST_KEY, 'commodities');
  check('and the opp field is its own column', COMMODITY_COLUMN, 'Commodities');

  // Edited on the Dropdowns page like any other list.
  const edited = { dropdownLists: { commodities: ['Electric', 'Steam', 'Compressed Air'] } };
  check('a user-edited list replaces the standard four',
    commodityOptions(edited).join(', '), 'Electric, Steam, Compressed Air');
  // An emptied list is a decision, not a fault. Restoring the defaults
  // behind the user's back would make the row impossible to turn off.
  check('an emptied list stays empty',
    commodityOptions({ dropdownLists: { commodities: [] } }).length, 0);
  check('duplicates and blanks are dropped',
    commodityOptions({ dropdownLists: { commodities: ['Electric', ' electric ', '', 'Water'] } }).join(', '),
    'Electric, Water');
}

// ---- reading and writing a stored value ---------------------------------
// The same picker writes an opp field (comma-separated, like Scope) and a
// Deal Sizing scope (an array), so both have to read back the same.
{
  check('a comma-separated field parses', parseCommodities('Electric, Water').join('|'), 'Electric|Water');
  check('an array parses', parseCommodities(['Electric', 'Water']).join('|'), 'Electric|Water');
  check('blanks and spacing are tidied', parseCommodities(' Electric ,, Water , ').join('|'), 'Electric|Water');
  check('a repeat is dropped', parseCommodities('Water, water').join('|'), 'Water');
  check('nothing reads as nothing', parseCommodities('').length, 0);
  check('and so does a null', parseCommodities(null).length, 0);
  check('the opp field stores them like Scope does',
    formatCommodities(['Electric', 'Water']), 'Electric, Water');
  check('ticking is case-insensitive', hasCommodity('electric', 'Electric'), true);
  check('and says no when it means no', hasCommodity('Electric', 'Water'), false);
}

// ---- toggling -----------------------------------------------------------
{
  check('a tick adds', toggleCommodity([], 'Water', DEFAULTS).join('|'), 'Water');
  check('a second tick takes it off', toggleCommodity(['Water'], 'Water', DEFAULTS).length, 0);
  check('and does so whatever the casing',
    toggleCommodity(['Water'], 'water', DEFAULTS).length, 0);
  // Kept in the list's order rather than click order, so two opps carrying
  // the same commodities read identically side by side.
  check('picks hold the list order, not the click order',
    toggleCommodity(['Waste', 'Electric'], 'Water', DEFAULTS).join('|'),
    'Electric|Water|Waste');
}

// A commodity dropped from the vocabulary stays on the records that carry
// it: it is somebody's answer, and silently deleting it would edit opps
// nobody is looking at.
{
  const narrowed = ['Electric', 'Water'];
  const picks = ['Electric', 'Steam'];
  const split = splitCommodities(picks, narrowed);
  check('a retired commodity is reported apart', split.strays.join('|'), 'Steam');
  check('and the current ones with it', split.known.join('|'), 'Electric');
  check('toggling something else leaves the stray alone',
    toggleCommodity(picks, 'Water', narrowed).join('|'), 'Electric|Water|Steam');
  check('and the stray can still be taken off deliberately',
    toggleCommodity(picks, 'Steam', narrowed).join('|'), 'Electric');
}

// ---- the Deal Sizing scope ----------------------------------------------
// Its own array beside the services, never inside them.
{
  const scope = normalizeClientScope({ services: ['Bill Pay'], commodities: 'Electric, Water' });
  check('a scope carries its commodities', scope.commodities.join('|'), 'Electric|Water');
  check('and its services stay services', scope.services.join('|'), 'Bill Pay');
  check('a scope with none reads as an empty list',
    normalizeClientScope({ services: ['Bill Pay'] }).commodities.length, 0);
  check('an empty scope has the field', normalizeClientScope(null).commodities.length, 0);
  // A scope holding only commodities is worth storing. Without this the
  // store would treat it as empty and drop the answer on the next save.
  check('commodities alone are worth storing',
    scopeIsEmpty({ commodities: ['Electric'] }), false);
  check('and a truly empty scope is still empty', scopeIsEmpty({}), true);
}

console.log(failures ? `\n${failures} FAILED` : '\nAll passed');
process.exit(failures ? 1 : 0);
