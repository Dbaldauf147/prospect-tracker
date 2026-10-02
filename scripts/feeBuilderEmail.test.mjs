// Assertion tests for the Fee Builder's Outlook draft email.
// Plain Node - no test framework. Run:
//   node scripts/feeBuilderEmail.test.mjs
import { feeEmailFigures, feeEmailOption, buildFeeEmail, feeBuilderEmailEml } from '../src/utils/feeBuilderEmail.js';

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

const o = feeEmailOption(plan, { termMonths: 24, annualEscalator: 0.03 });
check('option services', o.services, ['Strategic Sourcing', 'Bill Payment']);
check('option margin is the deal margin, whole percent', o.margin, '48%');
check('option term', o.term, 'Recurring 2 year term');
check('option escalator', o.escalator, '3%');
check('no escalator reads N/A', feeEmailOption(plan, { annualEscalator: 0 }).escalator, 'N/A');
check('odd term in months', feeEmailOption(plan, { termMonths: 18 }).term, 'Recurring 18 month term');
check('fee line', o.feeLines[0], 'Electric sourcing: $0.00152 Per kWh (Recurring (monthly))');
check('pass-through fee line', o.feeLines[2], 'Postage: $10.00 Per Account (Recurring (monthly), pass-through)');

const { subject, html } = buildFeeEmail(plan, { dealLabel: 'Acme & Co', termMonths: 24, annualEscalator: 0.03, optionSlot: 2 });
check('subject', subject, 'MARGIN APPROVAL: Acme & Co Strategic Sourcing, Bill Payment');
has('greeting', html, '<p>Hi Keith,</p>');
has('opening line', html, 'Please let me know if you need any additional information on this opportunity.');
has('sign-off', html, '<p>Thanks,</p>');
has('template banner', html, 'Margin Request Template');
has('options banner', html, 'SIA Options Seeking Approval');
has('customer escaped', html, '>Acme &amp; Co<');
has('SIA link row', html, 'Sales Investment Analyzer (SIA) Link');
has('RFP row', html, 'Is this an RFP?');
check('five option blocks', (html.match(/Option<br>\d/g) || []).length, 5);
has('kWh rate keeps its places', html, '$0.00152');
has('services listed', html, 'Strategic Sourcing<br>Bill Payment');
has('margin', html, '>48%<');
has('term', html, 'Recurring 2 year term');
has('escalator', html, '>3%<');
check('filled into Option 2, not Option 1', html.indexOf('Strategic Sourcing<br>') > html.indexOf('Option<br>2') && html.indexOf('Strategic Sourcing<br>') < html.indexOf('Option<br>3'), true);
check('no em dash', /—/.test(html), false);

check('no deal name', buildFeeEmail(plan).subject, 'MARGIN APPROVAL: Client Name Strategic Sourcing, Bill Payment');
check('out-of-range slot falls back to Option 1', buildFeeEmail(plan, { optionSlot: 0 }).html.indexOf('Strategic Sourcing<br>') < buildFeeEmail(plan, { optionSlot: 0 }).html.indexOf('Option<br>2'), true);

const eml = feeBuilderEmailEml(plan, { dealLabel: 'Acme', termMonths: 24, signature: '<b>Sig</b>' });
has('unsent draft', eml, 'X-Unsent: 1');
has('subject header', eml, 'Subject: MARGIN APPROVAL: Acme Strategic Sourcing, Bill Payment');
has('to Keith', eml, '\r\nTo: Keith McHugh <keith.mchugh@se.com>\r\n');
has('cc Gabe', eml, '\r\nCc: Gabe Smith <gabe.smith@se.com>\r\n');
has('bcc HubSpot', eml, '\r\nBcc: HubSpot logging <244957983@bcc.na2.hubspot.com>\r\n');
has('signature', eml, '<b>Sig</b>');

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
