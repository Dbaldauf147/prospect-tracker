// Taking "Don't Track" clients out of the Weekly Progress charts.
// Plain Node, no test framework (the project has none). Run:
//   node scripts/progressUntracked.test.mjs
//
// The arithmetic is trivial; what is easy to get wrong is which number a
// removed account comes out of.
//
//   1. Both halves. Drop the account from the numerator and forget the
//      denominator and the percentage goes DOWN when you remove an
//      account that had no contacts - the exact opposite of the point.
//
//   2. Only the accounts the week actually recorded. A client ticked
//      today was not necessarily on the book in April, so April's numbers
//      only move if April's own lists name it.
//
//   3. Hand-typed numbers. The Weekly History table lets a week's numbers
//      be typed over. Subtracting what was ticked keeps that edit as the
//      base; recounting the lists would silently throw it away.

import {
  untrackedNameSet,
  excludeUntrackedFromWeek,
  excludeUntrackedFromWeeks,
  untrackedNoteFor,
} from '../src/utils/progressUntracked.js';

let failures = 0;
function check(label, actual, expected) {
  const ok = Object.is(actual, expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n      got:  ${actual}\n      want: ${expected}`}`);
}

// A week shaped like the ones ProgressView saves: four Tier 1 accounts,
// three of them with contacts, one of which (Quiet Co) is ticked.
function week(over = {}) {
  return {
    week: '2026-09-07',
    t1Total: 4, t2Total: 2, t3Total: 9,
    t1WithContacts: 3, t2WithContacts: 1,
    t1WithDM: 2, t2WithDM: 1,
    t1Connected: 2, t2Connected: 0,
    t1Inactive: 1, t2Inactive: 0,
    t1ContactPct: 75, t2ContactPct: 50,
    t1DMPct: 50, t2DMPct: 50,
    t1ConnectedPct: 50, t2ConnectedPct: 0,
    t1InactivePct: 25, t2InactivePct: 0,
    details: {
      t1WithContacts: ['Acme', 'Borden', 'Quiet Co'],
      t1NoContacts: ['Dyne'],
      t1WithDM: ['Acme', 'Quiet Co'],
      t1NoDM: ['Borden', 'Dyne'],
      t1Connected: ['Acme', 'Borden'],
      t1NotConnected: ['Quiet Co', 'Dyne'],
      t1Inactive: [{ company: 'Quiet Co', status: 'Hold Off' }],
      t2WithContacts: ['Eldon'],
      t2NoContacts: ['Fairmont'],
      t2WithDM: ['Eldon'],
      t2NoDM: ['Fairmont'],
      t2Connected: [],
      t2NotConnected: ['Eldon', 'Fairmont'],
      t2Inactive: [],
    },
    ...over,
  };
}

const ticked = untrackedNameSet({ 'quiet co': true });

// ---------------------------------------------------------------- basics
check('the map reads as a set of names', ticked.has('quiet co'), true);
check('an unticked entry is not in the set',
  untrackedNameSet({ 'quiet co': false }).size, 0);
check('names are matched trimmed and lowercased',
  untrackedNameSet({ '  Quiet Co ': true }).has('quiet co'), true);

// -------------------------------------------------- both halves of a pct
const cut = excludeUntrackedFromWeek(week(), ticked);
check('the tier total loses the ticked account', cut.t1Total, 3);
check('a numerator holding it loses it too', cut.t1WithContacts, 2);
check('and the percentage is re-answered over both', cut.t1ContactPct, 67);
check('a tier with nothing ticked is untouched', cut.t2Total, 2);
check('and so is its percentage', cut.t2ContactPct, 50);

// The point of test 1 at the top: Quiet Co is NOT connected, so removing
// it must raise the connected percentage (2 of 3, not 2 of 4).
check('removing a miss raises the percentage it was missing from',
  cut.t1ConnectedPct, 67);
// ...and it IS inactive, so the inactive count falls with the total.
check('the inactive numerator drops', cut.t1Inactive, 0);
check('and its percentage with it', cut.t1InactivePct, 0);

// ------------------------------------------------------- the detail lists
check('the ticked account is gone from the yes list',
  cut.details.t1WithContacts.join(','), 'Acme,Borden');
check('and from the no lists', cut.details.t1NotConnected.join(','), 'Dyne');
check('the object-shaped inactive list is filtered too',
  cut.details.t1Inactive.length, 0);
check('a list with nothing ticked keeps its accounts',
  cut.details.t2NoContacts.join(','), 'Fairmont');

// ------------------------------------------------ weeks that never had it
const april = week({
  week: '2026-04-06',
  details: { t1WithContacts: ['Acme'], t1NoContacts: ['Borden', 'Dyne'] },
});
const aprilCut = excludeUntrackedFromWeek(april, ticked);
check('a week that never recorded the account is returned as it was',
  aprilCut === april, true);
check('an empty tick list changes nothing',
  excludeUntrackedFromWeek(week(), untrackedNameSet({})) !== null, true);
check('...and returns the same object', (() => {
  const w = week();
  return excludeUntrackedFromWeek(w, untrackedNameSet({})) === w;
})(), true);

// --------------------------------------------------------- typed-over week
// Somebody typed 90 into this week's T1 Contacts cell. One ticked account
// comes out of it, so the answer is 90 minus that one, not a recount.
const typed = excludeUntrackedFromWeek(week({ t1WithContacts: 90, t1Total: 100 }), ticked);
check('a hand-typed numerator is corrected, not recounted', typed.t1WithContacts, 89);
check('a hand-typed total is corrected too', typed.t1Total, 99);
check('and the percentage follows the corrected pair', typed.t1ContactPct, 90);

// A number can be edited below what the lists hold; the result clamps at
// zero rather than going negative.
const tiny = excludeUntrackedFromWeek(week({ t1WithContacts: 0 }), ticked);
check('a numerator cannot be pushed below zero', tiny.t1WithContacts, 0);

// --------------------------------------------------------- across a history
const history = [april, week(), week({ week: '2026-09-14' })];
const all = excludeUntrackedFromWeeks(history, { 'quiet co': true });
check('every week that recorded it is adjusted', all.weeksAdjusted, 2);
check('the untouched week is passed through', all.weeks[0] === april, true);
check('the latest week names what was left out', all.names.join(','), 'Quiet Co');
check('nothing ticked means nothing to do',
  excludeUntrackedFromWeeks(history, {}).weeks[1] === history[1], true);
check('and nothing to say',
  untrackedNoteFor(excludeUntrackedFromWeeks(history, {})), '');

// The note is the only thing the user reads about any of this.
const note = untrackedNoteFor(all);
check('the note counts the clients', note.includes('1 client'), true);
check('the note names the tab the tick lives on', note.includes('Clients tab'), true);
check('the note carries no em dash', note.includes('—'), false);

// A client ticked long after it left the book is not announced as missing
// from a chart it was never on.
const gone = excludeUntrackedFromWeeks([april], { 'quiet co': true });
check('a name absent from the latest week is not named', gone.names.length, 0);
check('and no week is adjusted', gone.weeksAdjusted, 0);

console.log(failures === 0 ? '\nAll passed' : `\n${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
