// Assertion tests for the rule that a new company must carry an HQ Region.
// Plain Node — no test framework (the project has none). Run:
//   node scripts/hqRegionRequired.test.mjs
//
// The rules worth pinning: "missing" here means exactly what My Accounts and
// the Issues tab mean by it, so a company that passes on the way in is not
// flagged the moment it lands; a value the field's dropdown cannot show is
// missing rather than present; and a pasted HQ column of locations is read
// as the region it names, without guessing at one it cannot place.
import {
  HQ_REGION_OPTIONS, hqRegionMissing, resolveHqRegion, normalizeHqRegion,
  NORTH_AMERICA, OUTSIDE_NORTH_AMERICA,
} from '../src/utils/hqRegion.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.log(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}

// --- the vocabulary ----------------------------------------------------
// One list, so a region offered by the popup that creates a company is one
// the bulk add and the new-opp flow can read back.
check('the two values, in the order the dropdowns show them',
  HQ_REGION_OPTIONS, [NORTH_AMERICA, OUTSIDE_NORTH_AMERICA]);

// --- what counts as missing --------------------------------------------
check('a blank is missing', hqRegionMissing(''), true);
check('so is nothing at all', [hqRegionMissing(null), hqRegionMissing(undefined)], [true, true]);
check('and whitespace', hqRegionMissing('   '), true);
// '-' is the app's blank sentinel, written by several import paths.
check('the blank sentinel is blank', hqRegionMissing('-'), true);
check('North America is not missing', hqRegionMissing(NORTH_AMERICA), false);
check('nor is the other one', hqRegionMissing(OUTSIDE_NORTH_AMERICA), false);
// The field renders as a select of two values. Anything else in it shows as
// an empty box, so treating it as present would let a company through that
// looks blank on every screen that reads it.
check('a region the dropdown cannot show is missing', hqRegionMissing('EMEA'), true);
check('and so is a near miss', hqRegionMissing('N. America'), true);
// Case and spacing are not the point: normalizeHqRegion already accepts
// these, and the two calls have to agree or a value would save and then
// read back as missing.
check('case does not make it missing', hqRegionMissing('north america'), false);
check('nor does padding', hqRegionMissing('  Outside of North America  '), false);
check('and the value stored is the canonical one',
  normalizeHqRegion('north america'), NORTH_AMERICA);

// --- a cell that is meant to be a region --------------------------------
// The single-company popup can only produce one of the two. A pasted
// column is a location, which is what classifyHqRegion exists to place.
check('a region passes through as itself', resolveHqRegion(NORTH_AMERICA), NORTH_AMERICA);
check('a location is placed', resolveHqRegion('Toronto, Ontario, Canada'), NORTH_AMERICA);
check('a foreign one too', resolveHqRegion('Zug, Switzerland'), OUTSIDE_NORTH_AMERICA);
check('a bare US state still places it', resolveHqRegion('Dallas, Texas'), NORTH_AMERICA);
// A wrong region is worse than a blank somebody is asked to fill, so a
// location that cannot be placed comes back empty and the row is held.
check('a lone city is not placed', resolveHqRegion('Houston'), '');
check('nor is an empty cell', resolveHqRegion(''), '');
check('a cell that cannot be placed still reads as missing',
  hqRegionMissing(resolveHqRegion('Houston')), true);
check('one that can does not',
  hqRegionMissing(resolveHqRegion('Toronto, Ontario, Canada')), false);

// --- the shape the two gates use ---------------------------------------
// The popup's gate: a record being created is blocked until the field is
// one of the two. An existing record is not this rule's business, which is
// why the check takes a value rather than a record.
{
  const blocked = (v) => hqRegionMissing(v);
  check('a company being added with nothing picked is held', blocked(''), true);
  check('and goes through once it is', blocked(OUTSIDE_NORTH_AMERICA), false);
}
// The bulk gate: every row about to be created, its own value over the
// shared one, resolved the same way.
{
  const sharedRecord = { hqRegion: NORTH_AMERICA };
  const rows = [
    { company: 'Acme' },
    { company: 'Globex', hqRegion: 'Zug, Switzerland' },
    { company: 'Initech', hqRegion: 'Houston' },
  ];
  const resolved = rows.map(r => resolveHqRegion(r.hqRegion) || resolveHqRegion(sharedRecord.hqRegion));
  check('the shared value covers a row that brings none', resolved[0], NORTH_AMERICA);
  check('a row with its own location wins', resolved[1], OUTSIDE_NORTH_AMERICA);
  // A cell nobody can place has not answered, so the shared pick covers it
  // too. Anything else would leave "pick one above to cover them" beside a
  // button that stays grey after you did.
  check('an unplaceable cell falls back to the shared pick', resolved[2], NORTH_AMERICA);
  check('so nothing holds the batch', resolved.filter(v => hqRegionMissing(v)).length, 0);
}
// With no shared pick, the unplaceable row is the one holding the batch,
// and it is the row the preview marks.
{
  const rows = [
    { company: 'Acme', hqRegion: 'Zug, Switzerland' },
    { company: 'Initech', hqRegion: 'Houston' },
  ];
  const resolved = rows.map(r => resolveHqRegion(r.hqRegion) || resolveHqRegion(''));
  check('one of two needs a region', resolved.filter(v => hqRegionMissing(v)).length, 1);
  check('and it is the one nobody could place', hqRegionMissing(resolved[1]), true);
}

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
