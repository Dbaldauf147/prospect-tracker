// The Scope summary on the New Opps subtab and in its email.
//
// The rules worth pinning: an answer only lands on an opp that was asked
// about, each summary is one em-dash-free line, a short scope never costs
// a call, and the email prints the summary when there is one and the
// stored scope when there isn't.
//
// Run: node scripts/summarizeScope.test.mjs
import { MAX_ITEMS, MAX_SUMMARY_CHARS, buildScopeRequest, cleanItems, readScopeSummaries } from '../api/_lib/summarizeScope.js';
import { addScopeSummaries } from '../api/_lib/newOpps.js';
import { needsScopeSummary, oppScopeText } from '../src/utils/scopeSummary.js';
import { NEW_OPPS_DIGEST_COLUMNS, buildNewOppsDigestTableHtml, withScopeSummaries } from '../src/utils/newOppsDigestEmail.js';

let passed = 0, failed = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n  expected ${e}\n  actual   ${a}`); }
}

const items = cleanItems([{ id: 'a', text: 'GHG, CDP, CSRD' }, { id: 'b', text: 'Bill pay, Procurement, Budgets' }]);
const answer = JSON.stringify({ summaries: [
  { id: 'a', summary: '- GHG inventory — CDP and CSRD reporting.' },
  { id: 'zzz', summary: 'stray' },
  { id: 'b', summary: '   ' },
] });
check('only asked ids, marker and period dropped, em dash swapped, blanks left out',
  readScopeSummaries(answer, items), { a: ['GHG inventory - CDP and CSRD reporting'] });
check('unreadable answer is null', readScopeSummaries('nope', items), null);
const long = readScopeSummaries(JSON.stringify({ summaries: [{ id: 'a', summary: 'x'.repeat(400) }] }), items).a[0];
check('a runaway line is capped', long.length <= MAX_SUMMARY_CHARS, true);

const req = buildScopeRequest(items);
check('request asks for structured JSON at low effort', [req.output_config.effort, req.output_config.format.type], ['low', 'json_schema']);
check('server-side fallback is on', [req.fallbacks, req.betas], ['default', ['server-side-fallback-2026-07-01']]);
check('prompt carries each scope under its id', req.messages[0].content.includes('<opp id="b">\nBill pay, Procurement, Budgets\n</opp>'), true);
check('system prompt has no em dash', req.system.includes('—'), false);
check('batch size matches notes', MAX_ITEMS, 25);

check('two services need no summary', needsScopeSummary('GHG, CDP'), false);
check('three services do', needsScopeSummary('GHG, CDP, CSRD'), true);
check('one long name does', needsScopeSummary('x'.repeat(61)), true);
check('blank needs none', needsScopeSummary(''), false);
check('scope text is tidied', oppScopeText({ Scope: '  GHG,\n CDP ' }), 'GHG, CDP');

// The email: the summary when attached, the stored scope otherwise.
const col = NEW_OPPS_DIGEST_COLUMNS.find(c => c.key === 'Scope');
check('email prints the summary', col.value({ Scope: 'GHG, CDP, CSRD', _scopeSummary: 'Carbon reporting' }), 'Carbon reporting');
check('email falls back to the scope', col.value({ Scope: 'GHG, CDP' }), 'GHG, CDP');
const rows = [{ Account: 'Acme', Scope: 'GHG, CDP, CSRD' }, { Account: 'Zed', Scope: 'GHG' }];
const lookup = { get: (r) => (r.Account === 'Acme' ? { status: 'ready', bullets: ['Carbon reporting'] } : { status: 'short', bullets: null }) };
const withSum = withScopeSummaries(rows, lookup);
check('only ready summaries attach', withSum.map(r => r._scopeSummary || null), ['Carbon reporting', null]);
const html = buildNewOppsDigestTableHtml(withSum);
check('the downloaded table carries the summary, not the list', [html.includes('Carbon reporting'), html.includes('GHG, CDP, CSRD')], [true, false]);

// The scheduled send: the same summary, asked once per distinct scope.
const calls = [];
const fakeClient = { beta: { messages: { create: async (r) => {
  calls.push(r);
  const ids = [...r.messages[0].content.matchAll(/<opp id="([^"]+)">/g)].map(m => m[1]);
  return { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ summaries: ids.map(id => ({ id, summary: `Line ${id}` })) }) }] };
} } } };
const sent = await addScopeSummaries([
  { Account: 'A', Scope: 'GHG, CDP, CSRD' }, { Account: 'B', Scope: 'GHG, CDP, CSRD' }, { Account: 'C', Scope: 'GHG' },
], { client: fakeClient });
check('scheduled send: identical scopes share one ask, short ones skip', [calls.length, sent.map(r => r._scopeSummary || null)], [1, ['Line 0', 'Line 0', null]]);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
