// Assertion tests for running a Titles-page search over the contacts.
// Run: node scripts/titleSearchMatch.test.mjs
import { matchTitleSearch, termPattern } from '../src/utils/titleSearchMatch.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.error(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}

const t = (term, title) => termPattern(term).test(title);
check('whole word', t('ESG', 'Head of ESG'), true);
check('any case', t('esg', 'ESG Lead'), true);
check('not inside a word: Intern', t('Intern', 'VP International Sales'), false);
check('not inside a word: Tax', t('Tax', 'Taxonomy Lead'), false);
check('plural s', t('Director', 'Directors of Energy'), true);
check('plural es', t('Business', 'Businesses'), true);
check('phrase', t('Net Zero', 'Net  Zero Programme Lead'), true);
check('phrase, punctuation around', t('Net Zero', 'Director, Net Zero.'), true);
check('trailing ? dropped', t('Power?', 'Power Procurement'), true);
check('slash boundary', t('ESG', 'Sustainability/ESG'), true);
check('empty term', termPattern(' ? '), null);

const search = {
  groups: [
    { kind: 'exclude', terms: ['Analyst', 'Intern'] },
    { kind: 'include', terms: ['Sustainability', 'ESG', 'Net Zero'] },
  ],
};
const contacts = [
  { id: 1, jobtitle: 'Director of Sustainability' },
  { id: 2, jobtitle: 'ESG Analyst' },
  { id: 3, jobtitle: 'VP International Sustainability' },
  { id: 4, jobtitle: 'CFO' },
  { id: 5, jobtitle: 'Sustainability Lead', dans_tags: 'Hide' },
  { id: 6, jobtitle: 'Sustainability Lead', dans_tags: 'Left;Decision Maker' },
  { id: 7, jobtitle: 'ESG Lead', email: 'x@se.com' },
  { id: 8, jobtitle: '' },
  { id: 9, jobtitle: 'Head of Sustainability�and ESG' },
  { id: 10, jobtitle: 'Sustainability Manager - Europe' },
];
const r = matchTitleSearch(contacts, search, ['Europe', 'analyst']);
check('matched ids', r.matched.map(m => m.contact.id), [1, 3, 9]);
check('hits listed', r.matched[2].hits, ['Sustainability', 'ESG']);
check('title cleaned', r.matched[2].title, 'Head of Sustainability and ESG');
check('excluded ids', r.excluded.map(m => m.contact.id), [2, 10]);
check('not hits, own and general', [r.excluded[0].notHits, r.excluded[1].notHits], [['Analyst'], ['Europe']]);
check('term counts, general deduped', [r.includeCount, r.excludeCount], [3, 3]);
check('no include terms: nobody', matchTitleSearch(contacts, { groups: [{ kind: 'exclude', terms: ['x'] }] }).matched.length, 0);
check('no search', matchTitleSearch(contacts, null).matched.length, 0);

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
