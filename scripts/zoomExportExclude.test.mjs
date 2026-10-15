// Assertion tests for keeping companies out of the ZoomInfo exports.
//   node scripts/zoomExportExclude.test.mjs
import { buildZoomExcludedMatcher, buildZoomExclusionExplainer, normZoomCompany, isZoomExcluded } from '../src/utils/zoomExportExclude.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.log(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}

const prospects = [
  { id: 'p1', company: 'Acme, Inc.', excludeFromZoomExports: true, zoomCompanyId: '12345' },
  { id: 'p2', company: 'Globex', excludeFromZoomExports: false },
  { id: 'p3', company: 'Initech' },
];
const isExcluded = buildZoomExcludedMatcher(prospects);

check('flag read', [isZoomExcluded(prospects[0]), isZoomExcluded(prospects[1]), isZoomExcluded(null)], [true, false, false]);
check('suffixes and punctuation set aside', normZoomCompany('Acme, Inc.'), 'acme');
check('by id', isExcluded({ id: 'p1', company: 'Something else' }), true);
check('by name, any spelling of the suffix', isExcluded({ company: 'ACME Corporation' }), true);
check('by Zoom Company ID', isExcluded({ company: 'Renamed', zoomId: '12345' }), true);
check('by an alternate name', isExcluded({ company: 'Typo Co', names: ['', 'Acme'] }), true);
check('a longer name is a different company', isExcluded({ company: 'Acme Industrial' }), false);
check('not excluded', isExcluded({ id: 'p2', company: 'Globex' }), false);
check('never flagged', isExcluded({ id: 'p3', company: 'Initech' }), false);
check('nothing excluded, nothing matches', buildZoomExcludedMatcher([{ id: 'x', company: 'Acme' }])({ company: 'Acme' }), false);
check('no prospects', buildZoomExcludedMatcher(undefined)({ company: 'Acme' }), false);

// The explainer says why, so an export can name what it left out.
const why = buildZoomExclusionExplainer(prospects);
check('why: its own flag', why({ id: 'p1', company: 'Acme, Inc.' }), 'set to Exclude from ZoomInfo');
check('why: another company\'s Zoom ID', why({ company: 'Griffis Residential', zoomId: '12345' }),
  'shares Zoom Company ID 12345 with Acme, Inc., which is set to Exclude from ZoomInfo');
check('why: another company by name', why({ company: 'ACME Corporation' }),
  'matches Acme, Inc. by name, which is set to Exclude from ZoomInfo');
check('why: not excluded', why({ id: 'p2', company: 'Globex' }), null);
check('why: nothing excluded', buildZoomExclusionExplainer([])({ company: 'Acme' }), null);

// Client status does not override the button: a Client set to Exclude
// from ZoomInfo is left out, as is one caught by another company's flag.
const withClients = [
  { id: 'c1', company: 'Griffis Residential', status: 'Client', excludeFromZoomExports: true, zoomCompanyId: '777' },
  { id: 'c2', company: 'Ettinger', status: 'Client ', zoomCompanyId: '888' },
  { id: 'x1', company: 'Ettinger Holdings', excludeFromZoomExports: true, zoomCompanyId: '888' },
  { id: 'x2', company: 'Prospect Co', status: 'Inside Sales', excludeFromZoomExports: true },
];
const whyC = buildZoomExclusionExplainer(withClients);
const isExC = buildZoomExcludedMatcher(withClients);
check('client: own flag applies', [isZoomExcluded(withClients[0]), whyC({ id: 'c1', company: 'Griffis Residential' })], [true, 'set to Exclude from ZoomInfo']);
check('client: status on the row does not save it', whyC({ company: 'Prospect Co', status: 'client' }), 'set to Exclude from ZoomInfo');
check('client: shared Zoom ID with an excluded company', whyC({ id: 'c3', company: 'Kensing', status: 'Client', zoomId: '888' }),
  'shares Zoom Company ID 888 with Ettinger Holdings, which is set to Exclude from ZoomInfo');
check('client: unflagged client with nothing shared stays in', isExC({ id: 'c3', company: 'Kensing', status: 'Client' }), false);
check('client: found by name without an id', isExC({ company: 'Griffis Residential LLC' }), true);
check('non-client still excluded', isExC({ id: 'x2', company: 'Prospect Co' }), true);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
