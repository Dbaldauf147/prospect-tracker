// Assertion tests for how the two layers of mandate corrections stack.
// Plain Node — no test framework (the project has none). Run:
//   node scripts/ordinanceOverrideLayers.test.mjs
//
// A correction lives in the SHARED reference (everyone screening that
// jurisdiction) and, only when that write is refused, in the user's own
// settings. Which layer wins decides whether somebody's screening quietly
// reverts under them, so it is pinned here rather than left to the caller.
import { mergeOverrideLayers } from '../src/utils/ordinanceOverrides.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}

const SHARED = { columbus: { bbs: { maxPenalty: 4000 } } };
const MINE = { columbus: { bbs: { maxPenalty: 9000 } } };

// --- one layer, or neither ----------------------------------------------
{
  eq(mergeOverrideLayers(null, null), null, 'nothing on either layer is nothing');
  eq(mergeOverrideLayers(SHARED, null), SHARED, 'the shared layer alone passes through');
  eq(mergeOverrideLayers(null, MINE), MINE, 'and so does a personal one');
  eq(mergeOverrideLayers({}, MINE), MINE, 'an empty shared layer is the same as none');
}

// --- a personal correction wins for the person who made it --------------
// It is usually there BECAUSE the shared write was refused. Demoting it
// under the shared copy would quietly undo what they typed.
{
  const out = mergeOverrideLayers(SHARED, MINE);
  eq(out.columbus.bbs.maxPenalty, 9000, 'the personal figure is what that user screens against');
}

// --- the layers combine per category, not per jurisdiction --------------
// Someone correcting the BPS row must not lose the shared BBS correction
// for the same city.
{
  const out = mergeOverrideLayers(
    { columbus: { bbs: { maxPenalty: 4000 }, audits: { deadline: '2026-12-31' } } },
    { columbus: { bps: { active: true } } },
  );
  eq(Object.keys(out.columbus).sort(), ['audits', 'bbs', 'bps'], 'all three categories survive the merge');
  eq(out.columbus.bbs.maxPenalty, 4000, 'the shared correction is untouched');
  eq(out.columbus.bps.active, true, 'and the personal one is added beside it');
}

// --- jurisdictions don't bleed into each other --------------------------
{
  const out = mergeOverrideLayers(
    { columbus: { bbs: { maxPenalty: 4000 } } },
    { denver: { bps: { maxPenalty: 10 } } },
  );
  eq(Object.keys(out).sort(), ['columbus', 'denver'], 'both jurisdictions are carried');
  eq(out.columbus.bbs.maxPenalty, 4000, 'each keeping its own corrections');
  eq(out.denver.bps.maxPenalty, 10, 'from whichever layer they came from');
}

// --- the inputs are not mutated -----------------------------------------
// The shared map is React state; writing through it would change what is
// on screen without a render.
{
  const shared = { columbus: { bbs: { maxPenalty: 4000 } } };
  const mine = { columbus: { bps: { active: true } } };
  mergeOverrideLayers(shared, mine);
  eq(Object.keys(shared.columbus), ['bbs'], 'the shared layer is left alone');
  eq(Object.keys(mine.columbus), ['bps'], 'and so is the personal one');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
