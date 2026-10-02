// Assertion tests for the Fee Builder's Outlook draft email.
// Plain Node - no test framework. Run:
//   node scripts/feeBuilderEmail.test.mjs
import { feeEmailFigures, feeEmailOption, marginOptionFigures, buildFeeEmail, feeBuilderEmailEml } from '../src/utils/feeBuilderEmail.js';

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
check('fee line', o.feeLines[0], 'Electric sourcing: $0.00152 Per kWh');
check('pass-through fee line', o.feeLines[2], 'Postage: $10.00 Per Account (pass-through)');

const { subject, html } = buildFeeEmail(plan, { dealLabel: 'Acme & Co', termMonths: 24, annualEscalator: 0.03, optionSlot: 2 });
check('subject', subject, 'MARGIN APPROVAL: Acme & Co (Scope)');
has('greeting', html, '<p>Hi Keith,</p>');
has('opening line', html, 'Please let me know if you need any additional information on this opportunity.');
has('sign-off', html, '<p>Thanks,</p>');
has('template banner', html, 'Margin Request Template');
has('options banner', html, 'SIA Options Seeking Approval');
has('customer escaped', html, '>Acme &amp; Co<');
has('SIA link row', html, 'Sales Investment Analyzer (SIA) Link');
has('RFP row', html, 'Is this an RFP?');
check('five option blocks, label on one line', (html.match(/>Option \d</g) || []).length, 5);
has('kWh rate keeps its places', html, '$0.00152');
has('services comma separated', html, 'Strategic Sourcing, Bill Payment');
has('margin', html, '>48%<');
has('term', html, 'Recurring 2 year term');
has('escalator', html, '>3%<');
check('filled into Option 2, not Option 1', html.indexOf('Strategic Sourcing, ') > html.indexOf('Option 2') && html.indexOf('Strategic Sourcing, ') < html.indexOf('Option 3'), true);
check('no em dash', /—/.test(html), false);

check('no deal name', buildFeeEmail(plan).subject, 'MARGIN APPROVAL: Client Name (Scope)');
check('out-of-range slot falls back to Option 1', buildFeeEmail(plan, { optionSlot: 0 }).html.indexOf('Strategic Sourcing, ') < buildFeeEmail(plan, { optionSlot: 0 }).html.indexOf('Option 2'), true);

// Like fee lines fold into the one summary line.
const like = marginOptionFigures({
  services: ['Bill payment', 'GHG', 'Bill payment'],
  rows: [
    { name: 'Per account monthly', type: 'Recurring (monthly)', feePerUnit: 1.96, unit: 'Per Account', unitCount: 100, startMonth: 1 },
    { name: 'Per account monthly', type: 'Recurring (monthly)', feePerUnit: 0.35, unit: 'Per Account', unitCount: 100, startMonth: 1 },
    { name: 'Per account monthly', type: 'Recurring (monthly)', feePerUnit: 0.69, unit: 'Per Account', unitCount: 100, startMonth: 1 },
    { name: 'Per account setup - Cass', type: 'Setup', feePerUnit: 21.22, unit: 'Per Account', unitCount: 100, startMonth: 1, passThrough: true },
  ],
  margin: 0.594,
  termMonths: 36,
});
check('like fees combined', like.feeLines, ['Per account monthly: $3.00 Per Account', 'Per account setup - Cass: $21.22 Per Account (pass-through)']);
check('services once each, in order', like.services, ['Bill payment', 'GHG']);
check('margin whole percent', like.margin, '59%');

// The other options fill their own blocks; the plan keeps its slot.
const all = buildFeeEmail(plan, {
  dealLabel: 'Acme', termMonths: 24, optionSlot: 1,
  otherOptions: [
    { slot: 1, services: ['Ignored'], rows: [], margin: 0.1 },
    { slot: 2, services: ['GHG', 'ESPM link'], rows: [{ name: 'Program monthly', type: 'Recurring (monthly)', feePerUnit: 2963, unit: 'Fixed', unitCount: 1 }], margin: 0.55 },
    { slot: 6, services: ['Out of range'], rows: [] },
  ],
}).html;
check('plan wins its own slot', all.includes('Ignored'), false);
check('six and up dropped', all.includes('Out of range'), false);
has('option 2 services', all, 'GHG, ESPM link');
has('option 2 fee summary', all, 'Program monthly: $2,963.00 Fixed');
has('option 2 margin', all, '>55%<');
check('option 2 lands after its strip', all.indexOf('GHG, ESPM link') > all.indexOf('Option 2') && all.indexOf('GHG, ESPM link') < all.indexOf('Option 3'), true);
has('table spans three quarters of the body', all, '<table width="75%"');

// Services summarized as their buckets; an unfiled one keeps its name.
const BUCKETS = { 'strategic sourcing': 'Traditional Energy Management', 'bill payment': 'DATA', 'invoice recalculation': 'DATA' };
const bucketOf = (n) => BUCKETS[String(n).toLowerCase()] || '';
check('services by bucket', marginOptionFigures({ services: ['Bill payment', 'Strategic sourcing', 'Invoice recalculation', 'Odd one'], bucketOf }).services, ['DATA', 'Traditional Energy Management', 'Odd one']);
has('bucket summary in the email', buildFeeEmail(plan, { bucketOf }).html, '>Traditional Energy Management, DATA<');

const eml = feeBuilderEmailEml(plan, { dealLabel: 'Acme', termMonths: 24, signature: '<b>Sig</b>' });
has('unsent draft', eml, 'X-Unsent: 1');
has('subject header', eml, 'Subject: MARGIN APPROVAL: Acme (Scope)');
has('to Keith', eml, '\r\nTo: Keith McHugh <keith.mchugh@se.com>\r\n');
has('cc Gabe', eml, '\r\nCc: Gabe Smith <gabe.smith@se.com>\r\n');
has('bcc HubSpot', eml, '\r\nBcc: HubSpot logging <244957983@bcc.na2.hubspot.com>\r\n');
has('signature', eml, '<b>Sig</b>');

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
