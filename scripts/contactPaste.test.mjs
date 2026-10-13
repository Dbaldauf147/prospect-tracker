// Assertion tests for reading pasted text into contacts (the company
// popup's Paste Contacts box). Plain Node, no framework. Run:
//   node scripts/contactPaste.test.mjs
//
// The pastes below are shaped like what actually gets copied: a LinkedIn
// people search, a Sales Navigator list, spreadsheet columns, and lines
// typed by hand. What matters most is that page furniture and locations
// never come out as people.
import {
  parseContactPaste, isLikelyName, splitName, nameFromLinkedinUrl, normalizeLinkedinUrl,
} from '../src/utils/contactPaste.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.log(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}
const row = (firstname, lastname, jobtitle = '', linkedin = '', email = '') => ({ firstname, lastname, jobtitle, linkedin, email });

// --- pieces ---------------------------------------------------------------
check('name', isLikelyName('Jane Doe'), true);
check('name with credentials', isLikelyName('Jane Doe, CFA, LEED AP'), true);
check('name with pronouns', isLikelyName('Jane Doe (She/Her)'), true);
check('title is not a name', isLikelyName('Director of Sustainability'), false);
check('company is not a name', isLikelyName('Acme Corp'), false);
check('one word is not a name', isLikelyName('Jane'), false);
check('location is not a name', isLikelyName('Greater Boston Area'), false);
check('split particles', splitName('Jan van der Berg'), { firstname: 'Jan', lastname: 'van der Berg' });
check('split middle initial', splitName('Jane A. Doe'), { firstname: 'Jane', lastname: 'Doe' });
check('split suffix', splitName('John Smith Jr.'), { firstname: 'John', lastname: 'Smith' });
check('slug name', nameFromLinkedinUrl('https://www.linkedin.com/in/jane-doe-4b1a2c3/'), 'Jane Doe');
check('slug without a name', nameFromLinkedinUrl('https://www.linkedin.com/in/jdoe123'), '');
check('normalize url', normalizeLinkedinUrl('linkedin.com/in/janedoe/?trk=abc'), 'https://www.linkedin.com/in/janedoe');
check('normalize country url', normalizeLinkedinUrl('https://uk.linkedin.com/in/janedoe'), 'https://www.linkedin.com/in/janedoe');

// --- one contact per line -------------------------------------------------
check('dash separated', parseContactPaste(
  'Jane Doe - Director of Sustainability - linkedin.com/in/janedoe\nJohn Smith - VP, Energy & Utilities - https://www.linkedin.com/in/john-smith-12ab',
), [
  row('Jane', 'Doe', 'Director of Sustainability', 'https://www.linkedin.com/in/janedoe'),
  row('John', 'Smith', 'VP, Energy & Utilities', 'https://www.linkedin.com/in/john-smith-12ab'),
]);
check('comma separated', parseContactPaste('Jane Doe, Head of ESG, https://linkedin.com/in/janedoe'), [
  row('Jane', 'Doe', 'Head of ESG', 'https://www.linkedin.com/in/janedoe'),
]);
check('pipe separated with email', parseContactPaste('Jane Doe | CFO | jane.doe@acme.com'), [
  row('Jane', 'Doe', 'CFO', '', 'jane.doe@acme.com'),
]);
check('en dash and em dash separators', parseContactPaste('Jane Doe – CFO\nJohn Smith — COO'), [
  row('Jane', 'Doe', 'CFO'), row('John', 'Smith', 'COO'),
]);
check('names only', parseContactPaste('Jane Doe\nJohn Smith\n\nMaria Garcia'), [
  row('Jane', 'Doe'), row('John', 'Smith'), row('Maria', 'Garcia'),
]);

// --- blocks ---------------------------------------------------------------
check('blocks with url on its own line', parseContactPaste(
  'Jane Doe\nDirector of Sustainability at Acme Corp\nhttps://www.linkedin.com/in/janedoe\n\nJohn Smith\nEnergy Manager\nlinkedin.com/in/jsmith',
  { company: 'Acme Corporation' },
), [
  row('Jane', 'Doe', 'Director of Sustainability', 'https://www.linkedin.com/in/janedoe'),
  row('John', 'Smith', 'Energy Manager', 'https://www.linkedin.com/in/jsmith'),
]);
check('"at" another company stays', parseContactPaste('Jane Doe\nCFO at Globex', { company: 'Acme' }), [
  row('Jane', 'Doe', 'CFO at Globex'),
]);

// LinkedIn people search, copied straight off the page.
check('linkedin search copy', parseContactPaste(`Jane Doe
View Jane Doe’s profile
Jane Doe
 • 2nd
2nd degree connection
Director of Sustainability at Acme | Speaker | Mentor
Greater Boston Area
Current: Director of Sustainability at Acme
Connect
John Smith, CFA
View John Smith’s profile
 • 3rd+
Senior Vice President, Energy Procurement
New York, New York
12 mutual connections
Message`, { company: 'Acme' }), [
  row('Jane', 'Doe', 'Director of Sustainability'),
  row('John', 'Smith', 'Senior Vice President, Energy Procurement'),
]);

// Sales Navigator: title, then the company, then where they are.
check('sales navigator copy', parseContactPaste(`Maria Garcia
2nd
VP, Real Estate Operations
Hines Interests
Houston, Texas, United States
3 years 2 months in role
Save
Alex Chen
Sustainability Analyst
Hines Interests
Remote`, { company: 'Hines Interests' }), [
  row('Maria', 'Garcia', 'VP, Real Estate Operations'),
  row('Alex', 'Chen', 'Sustainability Analyst'),
]);

check('url with no name takes the slug', parseContactPaste('https://www.linkedin.com/in/maria-garcia-9a8b7c'), [
  row('Maria', 'Garcia', '', 'https://www.linkedin.com/in/maria-garcia-9a8b7c'),
]);
check('two urls in a row are two people', parseContactPaste('linkedin.com/in/jane-doe\nlinkedin.com/in/john-smith'), [
  row('Jane', 'Doe', '', 'https://www.linkedin.com/in/jane-doe'),
  row('John', 'Smith', '', 'https://www.linkedin.com/in/john-smith'),
]);
check('duplicates collapse', parseContactPaste('Jane Doe - CFO\nJane Doe - CFO'), [row('Jane', 'Doe', 'CFO')]);
check('nothing', parseContactPaste('   \n\n'), []);
check('noise only', parseContactPaste('Connect\nMessage\n500+ connections'), []);

// --- spreadsheet ---------------------------------------------------------
check('table with header', parseContactPaste(
  'Name\tTitle\tLinkedIn\nJane Doe\tCFO\thttps://www.linkedin.com/in/janedoe\nJohn Smith\tCOO\t',
), [
  row('Jane', 'Doe', 'CFO', 'https://www.linkedin.com/in/janedoe'),
  row('John', 'Smith', 'COO'),
]);
check('table with first/last header', parseContactPaste(
  'First Name\tLast Name\tJob Title\tEmail\nJane\tDoe\tCFO\tjane@acme.com',
), [row('Jane', 'Doe', 'CFO', '', 'jane@acme.com')]);
check('table without header', parseContactPaste(
  'Jane Doe\tDirector of Sustainability\tlinkedin.com/in/janedoe\nJohn Smith\tEnergy Manager\t',
), [
  row('Jane', 'Doe', 'Director of Sustainability', 'https://www.linkedin.com/in/janedoe'),
  row('John', 'Smith', 'Energy Manager'),
]);
check('table first and last in own columns', parseContactPaste('Jane\tDoe\tCFO\nJohn\tSmith\tCOO'), [
  row('Jane', 'Doe', 'CFO'), row('John', 'Smith', 'COO'),
]);

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
