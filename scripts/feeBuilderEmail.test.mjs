// Assertion tests for the Fee Builder's Outlook draft email.
// Plain Node - no test framework. Run:
//   node scripts/feeBuilderEmail.test.mjs
import { feeEmailFigures, buildFeeEmail, feeBuilderEmailEml } from '../src/utils/feeBuilderEmail.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.log(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}
const has = (label, text, part) => check(label, String(text).includes(part), true);

const plan = {
  optionName: 'Option 1',
  numYears: 2,
  rows: [
    { name: 'Electric sourcing', service: 'Strategic Sourcing', type: 'Recurring (monthly)', feePerUnit: 0.00152, unit: 'Per kWh', unitCount: 1250000, startMonth: 1, years: [22800, 22800], term: 45600, cost: 22800, margin: 0.5 },
    { name: 'Bill pay setup', service: 'Bill Payment', type: 'Setup', feePerUnit: 150, unit: 'Per Site', unitCount: 40, startMonth: 1, years: [6000, 0], term: 6000, cost: 3000, margin: 0.5 },
    { name: 'Postage', service: 'Bill Payment', type: 'Recurring (monthly)', feePerUnit: 10, unit: 'Per Account', unitCount: 10, startMonth: 1, years: [1200, 1200], term: 2400, cost: 2400, margin: 0, passThrough: true },
    { name: '', years: [], term: 0 },
  ],
  perService: [
    { service: 'Strategic Sourcing', structureName: 'Per kWh / Dth' },
    { service: 'Bill Payment', structureName: 'Standard' },
    { service: 'Bill Payment', structureName: 'Standard' },
  ],
  after: { feeByYear: [30000, 24000], costByYear: [15000, 13200], margin: { finalMargin: 0.482 } },
};

const f = feeEmailFigures(plan, { termMonths: 24 });
check('blank rows left out', f.rows.length, 3);
check('term months', f.termMonths, 24);
check('term fees', f.termFees, 54000);
check('term cost', f.termCost, 28200);
check('deal margin', f.dealMargin, 0.482);
check('fee margin leaves out pass-through', f.feeMargin, (51600 - 25800) / 51600);
check('services once each', f.services.map(s => s.name), ['Strategic Sourcing', 'Bill Payment']);
check('term from years when not given', feeEmailFigures(plan).termMonths, 24);

const { subject, html } = buildFeeEmail(plan, { dealLabel: 'Acme & Co', termMonths: 24 });
check('subject', subject, 'Pricing: Acme & Co, Option 1');
has('deal escaped in body', html, 'Acme &amp; Co (Option 1) over a 24-month term');
has('kWh rate keeps its places', html, '$0.00152');
has('per site fee', html, '$150.00');
has('pass-through marked', html, 'Pass-through');
has('deal margin', html, '48.2%');
has('fee margin', html, '50.0%');
has('term fees', html, '$54,000.00');
has('service with its structure', html, 'Strategic Sourcing <span style="color:#64748b;">(Per kWh / Dth)</span>');
has('year columns', html, '>Y2<');
check('no em dash', /—/.test(html), false);

check('no deal name', buildFeeEmail(plan).subject, 'Pricing: Option 1');

const eml = feeBuilderEmailEml(plan, { dealLabel: 'Acme', termMonths: 24, signature: '<b>Sig</b>' });
has('unsent draft', eml, 'X-Unsent: 1');
has('subject header', eml, 'Subject: Pricing: Acme, Option 1');
check('no To header', /\r\nTo:/.test(eml), false);
has('signature', eml, '<b>Sig</b>');

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
