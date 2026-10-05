// Assertion tests for the Scope board's PRW (Pricing Request Workbook)
// Outlook draft. Plain Node - no test framework. Run:
//   node scripts/prwRequestEmail.test.mjs
import { buildPrwEmail, prwEmailEml, prwSubject, PRW_OPTION_SLOTS } from '../src/utils/prwRequestEmail.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.log(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}
const has = (label, text, part) => check(label, String(text).includes(part), true);

const date = new Date(2026, 9, 5);
check('subject names the customer and date', prwSubject('Brookfield (Self Storage)', date), 'PRICING REQUEST WORKBOOK - Brookfield (Self Storage) - 10/5/2026');
check('subject keeps the placeholder with no customer', prwSubject('', date), 'PRICING REQUEST WORKBOOK - [Customer Name] - 10/5/2026');

const { html } = buildPrwEmail({ customerName: 'A & B <Co>', date });
has('customer is escaped into the table', html, 'A &amp; B &lt;Co&gt;');
has('S2C ticket line', html, 'complete the S2C ticket here for those:');
has('S2C link', html, 'href="https://servicedesk.ems.schneider-electric.com/projects/STC/queues/custom/4199"');
has('CC the CM line', html, '<p>CC the CM.</p>');
has('greeting', html, '<p>Team,</p>');
has('intro', html, 'Please see the pricing request information below for your review.');
has('sign-off', html, 'Thank you very much!');
for (const label of ['Requested Data', 'CDM Answer', 'Customer Name', 'Requested SIA Return Date', 'Is this an RFP?', 'Pricing Request Link', 'SIA Requested Breakout', 'If Client is Existing Customer', 'Current Payment Terms', 'Current Escalator %', 'Expiration Term of Current Contract']) {
  has(`table row ${label}`, html, `>${label}</td>`);
}
has('currency defaults to USD', html, '>USD</td>');
for (let i = 1; i <= PRW_OPTION_SLOTS; i += 1) has(`Option ${i}`, html, `>Option ${i}</td>`);
check('order of the sections', html.indexOf('SIA Requested Breakout') < html.indexOf('If Client is Existing Customer'), true);

const eml = prwEmailEml({ customerName: 'Brookfield', date, signature: '<b>SIG</b>' });
has('To the Price and Tendering desk', eml, 'To: "SM SB Price and Tendering Support" <SB.PriceTender@support.se.com>');
has('Cc Keith', eml, 'Cc: "Keith McHugh" <keith.mchugh@se.com>');
has('Bcc HubSpot', eml, '244957983@bcc.na2.hubspot.com>');
has('opens as a draft', eml, 'X-Unsent: 1');
has('subject header', eml, 'Subject: PRICING REQUEST WORKBOOK - Brookfield - 10/5/2026');
has('signature appended', eml, '<b>SIG</b>');

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
