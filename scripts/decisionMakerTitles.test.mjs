// Assertion tests for src/utils/decisionMakerTitles.js, the list behind the
// Titles page's Decision Makers tab. Plain Node, no framework. Run:
//   node scripts/decisionMakerTitles.test.mjs

import { decisionMakerTitles } from '../src/utils/decisionMakerTitles.js';

let failed = 0;
function check(name, cond) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`);
  if (!cond) failed += 1;
}

const contacts = [
  { id: 1, firstname: 'Zed', lastname: 'Z', jobtitle: 'VP Sustainability', company: 'A', dans_tags: 'Decision Maker' },
  { id: 2, firstname: 'Amy', lastname: 'A', jobtitle: 'vp  sustainability ', company: 'B', dans_tags: 'ESG;Decision Maker' },
  { id: 3, firstname: 'Bob', lastname: 'B', jobtitle: 'Chief Financial Officer', company: 'C', dans_tags: 'Decision Maker' },
  { id: 4, firstname: 'Cat', lastname: 'C', jobtitle: 'Analyst', company: 'D', dans_tags: 'ESG' },
  { id: 5, firstname: 'Dee', lastname: 'D', jobtitle: 'Director', company: 'E', dans_tags: 'Decision Maker;Hide' },
  { id: 6, firstname: 'Eve', lastname: 'E', jobtitle: 'Director', company: 'F', dans_tags: 'Decision Maker;Left' },
  { id: 7, firstname: 'Fay', lastname: 'F', jobtitle: '', company: 'G', dans_tags: 'Decision Maker' },
  { id: 8, firstname: 'Gus', lastname: 'G', jobtitle: 'Energy Manager', company: 'H', dans_tags: 'decision maker' },
];

const { titles, untitled } = decisionMakerTitles(contacts);

check('only Decision Maker contacts, Hide and Left left out',
  titles.reduce((n, t) => n + t.count, 0) === 4);
check('alphabetical order',
  JSON.stringify(titles.map(t => t.title)) === JSON.stringify(['Chief Financial Officer', 'Energy Manager', 'VP Sustainability']));
check('case and spacing variants share one row', titles[2].count === 2);
check('people under a title sorted by name',
  titles[2].contacts.map(c => c.name).join(',') === 'Amy A,Zed Z');
check('blank titles counted, not listed', untitled === 1);
check('empty input is empty', decisionMakerTitles(null).titles.length === 0);

if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log('\nall passed');
