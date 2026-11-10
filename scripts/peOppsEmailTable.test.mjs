// The PE Opps email shows the opps as a table in the body, not only in
// the attachment.
//   node scripts/peOppsEmailTable.test.mjs
import { buildPeOppsHtmlTable } from '../api/_lib/peOpps.js';

let passed = 0, failed = 0;
function ok(cond, name) {
  if (cond) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}`); }
}

const recs = [
  { Account: 'Acme <Corp>', Stage: 'Proposal', 'Quoted Amount': '$12,000', 'BFO Link': 'https://bfo.example/opp/1' },
  { Account: 'Globex', Stage: 'Discovery' },
];
const html = buildPeOppsHtmlTable(recs, ['Stage', 'Quoted Amount', 'BFO Link']);
ok(html.startsWith('<table'), 'renders a table');
ok((html.match(/<tr>/g) || []).length === 3, 'header row + one row per opp');
ok(html.includes('>Account<') && html.includes('>Stage<') && html.includes('>Quoted Amount<'), 'selected columns plus Account');
ok(!html.includes('>Status<'), 'unselected columns left out');
ok(html.indexOf('>Account<') < html.indexOf('>Stage<'), 'canonical order, Account first');
ok(html.includes('Acme &lt;Corp&gt;'), 'cell text escaped');
ok(html.includes('href="https://bfo.example/opp/1"'), 'URL cells become links');
ok(!html.includes('—'), 'no em dash');
ok(buildPeOppsHtmlTable([], []).includes('No open PE opportunities'), 'empty list message');
ok((buildPeOppsHtmlTable(recs, []).match(/<th /g) || []).length === 14, 'empty column list means all columns');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
