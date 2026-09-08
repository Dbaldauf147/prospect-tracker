// Assertion tests for the two rules that keep the Pipeline dashboard — and
// with it the tracked Service Exploration Coverage services — from being
// destroyed by its own page. Plain Node — no test framework (the project
// has none). Run:
//   node scripts/pipelineDashboardRestore.test.mjs
//
// The failure these encode: a browser whose data was cleared signs in, the
// Firestore mirror starts pulling the dashboard back down, and meanwhile
// the Pipeline page reads the (empty) IndexedDB, renders defaults, and
// saves them — which the mirror pushes up, stamped now, over the copy it
// was fetching. The backup is overwritten by defaults seconds after the
// clear.
import {
  pipelineNeedsSave,
  pipelineShouldAdopt,
  coverageServicesOf,
} from '../src/utils/pipelineDashboardStore.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}

const DEFAULTS = JSON.stringify({ coverageServices: [], coverageGoal: 3.21 });
const TRACKED = JSON.stringify({ coverageServices: ['bill-pay', 'utility-data'], coverageGoal: 3.21 });
const EDITED = JSON.stringify({ coverageServices: ['bill-pay'], coverageGoal: 4 });

// --- when the dashboard may be written ----------------------------------
{
  // The one that mattered: page loads on an empty store, state is the
  // defaults, baseline is the defaults. Writing here is what overwrote the
  // cloud copy.
  eq(pipelineNeedsSave(DEFAULTS, DEFAULTS), false, 'an untouched default is never written');

  // A page that loaded a record and hasn't been touched is equally silent —
  // re-saving what storage just handed us buys nothing and re-stamps the
  // mirror for no reason.
  eq(pipelineNeedsSave(TRACKED, TRACKED), false, 'an untouched loaded record is never re-written');

  // But a real edit always writes, from either starting point.
  eq(pipelineNeedsSave(EDITED, TRACKED), true, 'an edit to a loaded record writes');
  eq(pipelineNeedsSave(TRACKED, DEFAULTS), true, 'a first service added on a fresh install writes');

  eq(pipelineNeedsSave('', DEFAULTS), false, 'no state is not a write');
  eq(pipelineNeedsSave(undefined, DEFAULTS), false, 'nor is a missing one');
}

// --- when a stored record may replace what is on screen -----------------
{
  // The restore: the mirror lands the cloud copy in IndexedDB while the page
  // is still showing defaults nobody has touched.
  eq(pipelineShouldAdopt({ stateJson: DEFAULTS, baselineJson: DEFAULTS, incomingJson: TRACKED }), true,
    'a restored record replaces untouched defaults');

  // Mid-edit, it must not: the edit is both newer and the user's.
  eq(pipelineShouldAdopt({ stateJson: EDITED, baselineJson: TRACKED, incomingJson: TRACKED }), false,
    'a hydration mid-edit does not take the edit with it');
  eq(pipelineShouldAdopt({ stateJson: EDITED, baselineJson: DEFAULTS, incomingJson: TRACKED }), false,
    'nor when the edit was made before anything had loaded');

  // Our own save fires the same event; the record coming back is what is
  // already on screen, so there is nothing to adopt and no render to cause.
  eq(pipelineShouldAdopt({ stateJson: TRACKED, baselineJson: TRACKED, incomingJson: TRACKED }), false,
    'the echo of our own save is not adopted');

  eq(pipelineShouldAdopt({ stateJson: DEFAULTS, baselineJson: DEFAULTS, incomingJson: '' }), false,
    'an empty record is not adopted');
  eq(pipelineShouldAdopt({ stateJson: DEFAULTS, baselineJson: DEFAULTS, incomingJson: undefined }), false,
    'nor a missing one');
}

// --- the services the Issues tab reads off the same record --------------
{
  eq(coverageServicesOf({ coverageServices: ['a', 'b'] }), ['a', 'b'], 'tracked services read back');
  eq(coverageServicesOf({ coverageServices: ['a', '', null, 7] }), ['a'], 'junk entries are dropped');
  eq(coverageServicesOf({}), [], 'a record with none reports none');
  eq(coverageServicesOf(null), [], 'and so does no record at all');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
