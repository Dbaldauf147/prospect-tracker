// Assertion tests for the campaign pickers' ordering and type-ahead.
// Run: node scripts/campaignPicker.test.mjs
import { campaignRecency, campaignsByRecency, matchPickerOptions, campaignPickerDetail } from '../src/utils/campaignPicker.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.error(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}

// Stored newest first, as the app saves them.
const list = [
  { subject: 'New, nothing sent', savedAt: '2026-10-01T00:00:00Z', contacts: [] },
  { subject: 'Old but still sending', savedAt: '2026-03-01T00:00:00Z', contacts: [{ sentDate: '2026-10-05' }, { sentDate: '' }] },
  { subject: 'Undated A' },
  { subject: 'Mid', savedAt: '2026-07-01T00:00:00Z' },
  { subject: 'Undated B' },
];
check('recency is the latest send', campaignRecency(list[1]), Date.parse('2026-10-05'));
check('no dates is 0', campaignRecency({}), 0);
check('bad dates ignored', campaignRecency({ savedAt: 'nope', contacts: [{ sentDate: 'x' }] }), 0);
check('most recent first, undated keep stored order',
  campaignsByRecency(list).map(e => e.campaign.subject),
  ['Old but still sending', 'New, nothing sent', 'Mid', 'Undated A', 'Undated B']);
check('index is the stored position', campaignsByRecency(list).map(e => e.index), [1, 0, 3, 2, 4]);
check('not an array', campaignsByRecency(null), []);

const opts = [
  { label: 'Market update Q3' },
  { label: 'Q3 update: ERCOT', text: 'Texas power' },
  { label: 'Quarterly review' },
  { label: 'Solar webinar invite', text: 'Q3 solar' },
];
const labels = (q) => matchPickerOptions(opts, q).map(o => o.label);
check('blank shows all in order', labels(' '), opts.map(o => o.label));
check('prefix first, then word starts', labels('q'), ['Q3 update: ERCOT', 'Quarterly review', 'Market update Q3', 'Solar webinar invite']);
check('several word starts', labels('q3 erc'), ['Q3 update: ERCOT']);
check('words in any order', labels('upd mark'), ['Market update Q3']);
check('other subject lines match', labels('texas'), ['Q3 update: ERCOT']);
check('mid-word falls back to anywhere', labels('rcot'), ['Q3 update: ERCOT']);
check('case-insensitive', labels('SOLAR'), ['Solar webinar invite']);
check('no match', labels('zzz'), []);

check('detail', campaignPickerDetail({ savedAt: '2026-10-01T12:00:00Z', contacts: [{}, {}] }), '2 contacts · last activity Oct 1, 2026');
check('detail, no dates', campaignPickerDetail({ totalContacts: 1 }), '1 contact');

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
