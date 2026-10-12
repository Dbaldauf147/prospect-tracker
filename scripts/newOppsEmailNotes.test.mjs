// The scheduled New Opps email's Notes column carries the same summary
// bullets the subtab shows, and never fails the send over them: no key,
// a failed batch or a refusal each leave that opp's full notes in place.
//
// Run: node scripts/newOppsEmailNotes.test.mjs
import { addNotesSummaries, buildNewOppsTableHtml } from '../api/_lib/newOpps.js';

let passed = 0, failed = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n  expected ${e}\n  actual   ${a}`); }
}

const long = 'Sent proposal to CFO\nFollow up on pricing next week\nWaiting on site list';
const a = { Account: 'A', 'Next Steps': long };
const b = { Account: 'B', 'Next Steps': 'Short note' };
const c = { Account: 'C', 'Next Steps': long }; // same notes as A: one item

// A fake client answering every id it was asked about.
let calls = 0, asked = [];
const client = { beta: { messages: { create: async (req) => {
  calls++;
  const ids = [...req.messages[0].content.matchAll(/<opp id="([^"]+)">/g)].map(m => m[1]);
  asked.push(...ids);
  return { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({
    summaries: ids.map(id => ({ id, bullets: ['Proposal with CFO', 'Waiting on site list'] })),
  }) }] };
} } } };

const out = await addNotesSummaries([a, b, c], { client });
check('one call, identical notes asked once, short notes not asked', [calls, asked.length], [1, 1]);
check('long notes get the bullets', [out[0]._notesSummary, out[2]._notesSummary], [['Proposal with CFO', 'Waiting on site list'], ['Proposal with CFO', 'Waiting on site list']]);
check('short notes untouched', out[1]._notesSummary, undefined);
check('input records not mutated', a._notesSummary, undefined);

const html = buildNewOppsTableHtml(out);
check('table shows bullets, not the full notes', [html.includes('<li style="margin:0">Proposal with CFO</li>'), html.includes('Follow up on pricing')], [true, false]);
check('short notes shown as written', html.includes('>Short note<'), true);

const broken = { beta: { messages: { create: async () => { throw new Error('boom'); } } } };
const err = console.error; console.error = () => {};
const fallback = await addNotesSummaries([a], { client: broken });
console.error = err;
check('a failed call keeps the full notes', [fallback[0]._notesSummary, buildNewOppsTableHtml(fallback).includes('Follow up on pricing')], [undefined, true]);

const refused = { beta: { messages: { create: async () => ({ stop_reason: 'refusal', content: [] }) } } };
check('a refusal keeps the full notes', (await addNotesSummaries([a], { client: refused }))[0]._notesSummary, undefined);

const key = process.env.ANTHROPIC_API_KEY; delete process.env.ANTHROPIC_API_KEY;
check('no API key: records returned as is', (await addNotesSummaries([a]))[0], a);
if (key) process.env.ANTHROPIC_API_KEY = key;

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
