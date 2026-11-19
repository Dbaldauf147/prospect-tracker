// Plain Node, no framework. Run:
//   node scripts/competitorConsultants.test.mjs
import { normalizeConsultants, saveConsultant, removeConsultant, consultantFirms, consultantIsEmpty, blankConsultant } from '../src/utils/competitorConsultants.js';

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n      got:  ${JSON.stringify(actual)}\n      want: ${JSON.stringify(expected)}`}`);
}
const full = (o) => ({ id: o.id, name: '', firm: '', title: '', email: '', phone: '', linkedin: '', service: '', notes: '', ...o });

check('normalize: not a list', normalizeConsultants(null), []);
check('normalize: trims, fills blanks, drops unnamed and junk',
  normalizeConsultants([{ id: 'a', name: ' Ann Lee ', firm: 'CBRE' }, null, 'x', { id: 'b', email: 'x@y.com' }, { id: 'a', name: 'Dupe' }]),
  [full({ id: 'a', name: 'Ann Lee', firm: 'CBRE' })]);
check('normalize: a firm alone is enough', normalizeConsultants([{ id: 'f', firm: 'JLL' }]).length, 1);
check('normalize: gives a missing id', /^cc-/.test(normalizeConsultants([{ name: 'No Id' }])[0].id), true);
check('blank: empty until named', [consultantIsEmpty(blankConsultant()), consultantIsEmpty({ name: 'A' })], [true, false]);

let list = saveConsultant([], { id: 'a', name: 'Ann Lee', firm: 'CBRE' });
list = saveConsultant(list, { id: 'b', name: 'Bo Ray', firm: 'JLL', email: 'bo@jll.com' });
check('save: adds', list.map(c => c.id), ['a', 'b']);
list = saveConsultant(list, { id: 'a', name: 'Ann Lee', firm: 'CBRE', title: 'Director' });
check('save: replaces by id, in place', list.map(c => [c.id, c.title]), [['a', 'Director'], ['b', '']]);
check('save: an empty entry changes nothing', saveConsultant(list, { id: 'c', email: 'x@y.com' }).length, 2);
check('remove', removeConsultant(list, 'a').map(c => c.id), ['b']);
check('firms: across companies, once each, sorted',
  consultantFirms([{ competitorConsultants: list }, { competitorConsultants: [{ id: 'z', name: 'Zed', firm: 'cbre' }, { id: 'y', firm: 'Aon' }] }, {}]),
  ['Aon', 'CBRE', 'JLL']);

if (failures) { console.error(`\n${failures} failed`); process.exit(1); }
console.log('\nAll passed');
