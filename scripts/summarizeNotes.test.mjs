// The Notes summary on the New Opps and PE Opps subtabs.
//
// The rules worth pinning: an answer can only land on an opp that was asked
// about, each summary stays a handful of em-dash-free bullets, notes that are
// already one short line never cost a call, and the cache key follows the
// exact text (Waiting On included) so an edit gets a fresh summary.
//
// Run: node scripts/summarizeNotes.test.mjs
import { MAX_BULLETS, MAX_ITEMS, buildRequest, cleanItems, readSummaries } from '../api/_lib/summarizeNotes.js';
import { needsSummary, oppNotesText, summaryKey, chunk } from '../src/utils/notesSummary.js';

let passed = 0, failed = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n  expected ${e}\n  actual   ${a}`); }
}

const items = cleanItems([{ id: 'a', text: ' notes A ' }, { id: 'a', text: 'dup' }, { id: '', text: 'x' }, { id: 'b', text: '' }, { id: 'c', text: 'notes C' }]);
check('items are trimmed, de-duplicated, blanks dropped', items, [{ id: 'a', text: 'notes A' }, { id: 'c', text: 'notes C' }]);

const answer = JSON.stringify({ summaries: [
  { id: 'a', bullets: ['- Waiting on Keith — for pricing', '', '2. Call Friday', 'x', 'y', 'z'] },
  { id: 'zzz', bullets: ['stray'] },
  { id: 'c', bullets: [] },
] });
const read = readSummaries(answer, items);
check('only asked ids, markers stripped, em dashes swapped, capped', read, { a: ['Waiting on Keith - for pricing', 'Call Friday', 'x', 'y'] });
check('cap is MAX_BULLETS', read.a.length, MAX_BULLETS);
check('unreadable answer is null', readSummaries('nope', items), null);

const req = buildRequest(items);
check('request asks for structured JSON at low effort', [req.output_config.effort, req.output_config.format.type], ['low', 'json_schema']);
check('prompt carries each opp under its id', req.messages[0].content.includes('<opp id="c">\nnotes C\n</opp>'), true);
check('system prompt has no em dash', req.system.includes('—'), false);
check('batch size is 25', MAX_ITEMS, 25);

const opp = { 'Next Steps': 'Send proposal\n- Follow up with CFO', _nextStepsWaiting: ['', 'Keith'] };
check('notes text carries Waiting On', oppNotesText(opp), '- Send proposal\n- Follow up with CFO [waiting on: Keith]');
check('one short line needs no summary', needsSummary(oppNotesText({ 'Next Steps': 'Call Monday' })), false);
check('several lines do', needsSummary(oppNotesText(opp)), true);
check('empty needs nothing', needsSummary(oppNotesText({})), false);
check('key follows the exact text', summaryKey('a') === summaryKey('a') && summaryKey('a') !== summaryKey('b'), true);
check('chunking', chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
