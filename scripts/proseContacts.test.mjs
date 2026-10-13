// Assertion tests for src/utils/proseContacts.js, the Bulk Add Contacts
// reader for pasted text that names people without email addresses.
// Plain Node. Run:
//   node scripts/proseContacts.test.mjs
import { parseProseContacts, splitProseName } from '../src/utils/proseContacts.js';

let failed = 0;
function eq(actual, expected, name) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n        expected ${JSON.stringify(expected)}\n        got      ${JSON.stringify(actual)}`}`);
  if (!ok) failed += 1;
}
const brief = (rows) => rows.map(r => [r.firstname, r.lastname, r.jobtitle, r.linkedinUrl]);

const plan = `. The Operations & Asset Management Track

Focus: Property management efficiency, procurement logistics, utility/fleet management, and physical property rehabilitation.
• Timothy J. Lobner (Executive Vice President & Chief Operating Officer). He leads the field teams and directly oversees strategic initiatives for procurement, utility management, and vehicle fleet programs across their portfolio of over 110,000 single-family rental homes.
• Peter DiLello (Executive Vice President, Investment Management Group). He manages disciplined capital allocation, portfolio optimization, and transaction metrics to ensure property assets meet long-term performance standards.

2. The Corporate Finance & FP&A Track

Focus: Budget approvals, capital expenditure (CapEx) ROI modeling, enterprise financial tech (like Anaplan), and corporate development.
• Jonathan S. Olsen (Executive Vice President & Chief Financial Officer). He holds the ultimate sign-off on the macro-level corporate budget and financing structure.
• Chris Story (Vice President of FP&A and Corporate Development). He manages the 17-member team that handles day-to-day annual budgeting and the complex corporate strategy models.`;
eq(brief(parseProseContacts(plan)), [
  ['Timothy', 'Lobner', 'Executive Vice President & Chief Operating Officer', ''],
  ['Peter', 'DiLello', 'Executive Vice President, Investment Management Group', ''],
  ['Jonathan', 'Olsen', 'Executive Vice President & Chief Financial Officer', ''],
  ['Chris', 'Story', 'Vice President of FP&A and Corporate Development', ''],
], 'account-plan bullets: four people, headings and Focus lines skipped');

eq(brief(parseProseContacts([
  'Jane Doe - Director of Energy Procurement',
  '- Sam O\'Brien, VP Sustainability (linkedin.com/in/sam-obrien)',
  'Maria de la Cruz – Head of Facilities. She runs the sites.',
  'Corporate Development - our plan for next year',
].join('\n'))), [
  ['Jane', 'Doe', 'Director of Energy Procurement', ''],
  ['Sam', "O'Brien", 'VP Sustainability', 'https://linkedin.com/in/sam-obrien'],
  ['Maria', 'de la Cruz', 'Head of Facilities', ''],
], 'dash, comma and en dash separators; a non-title after a dash is skipped');

eq(brief(parseProseContacts([
  'Alex Rivera',
  'Chief Sustainability Officer at Acme',
  'https://www.linkedin.com/in/alexrivera/',
  '',
  'Operations Track',
  'Focus: procurement, energy and operations',
].join('\n'))), [
  ['Alex', 'Rivera', 'Chief Sustainability Officer at Acme', 'https://www.linkedin.com/in/alexrivera/'],
], 'name line then title line, LinkedIn on the line after; a heading over a Focus line is not a person');

eq(parseProseContacts('Jane Doe (jane@acme.com)\nBob Smith <bob@acme.com>'), [], 'lines with emails are left to the email reader');
eq(parseProseContacts('Jane Doe (CFO)\nJane Doe (Chief Financial Officer)').length, 1, 'same person twice is one row');
eq(splitProseName('Timothy J. Lobner'), { firstname: 'Timothy', lastname: 'Lobner' }, 'middle initial dropped');
eq(parseProseContacts(''), [], 'empty text');

if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log('\nall passed');
