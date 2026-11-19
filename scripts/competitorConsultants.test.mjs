// Plain Node, no framework. Run:
//   node scripts/competitorConsultants.test.mjs
import { normalizeConsultants, saveConsultant, removeConsultant, consultantFirms, consultantIsEmpty, blankConsultant, firmFromEmail, setContactCompetitor, contactIsCompetitor } from '../src/utils/competitorConsultants.js';

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

// Marking a HubSpot contact as a competitor.
check('firm guess', [firmFromEmail('jloeper@verdani.com'), firmFromEmail('a@gmail.com'), firmFromEmail('a@cwp.com', ['CWP.com']), firmFromEmail('')], ['Verdani', '', '', '']);
{
  const jess = { id: 77, firstname: 'Jessica', lastname: 'Loepe', email: 'jloeper@verdani.com', jobtitle: 'COO', mobilephone: '555' };
  let l = setContactCompetitor([{ id: 'a', name: 'Ann' }], jess, true);
  check('mark: adds a linked entry', [l.length, l[1].contactId, l[1].name, l[1].firm, l[1].title, l[1].phone], [2, '77', 'Jessica Loepe', 'Verdani', 'COO', '555']);
  check('mark: twice is once', setContactCompetitor(l, jess, true).length, 2);
  check('mark: is marked', [contactIsCompetitor(l, 77), contactIsCompetitor(l, 78), contactIsCompetitor(l, '')], [true, false, false]);
  check('mark: the link survives a later edit', normalizeConsultants([{ ...l[1], notes: 'x' }])[0].contactId, '77');
  l = setContactCompetitor(l, jess, false);
  check('unmark: removes only theirs', l.map(c => c.id), ['a']);
  check('mark: no id, nothing happens', setContactCompetitor([], { email: 'x@y.com' }, true), []);
  check('mark: nameless contact goes by its address', setContactCompetitor([], { id: 1, email: 'x@gmail.com' }, true)[0].name, 'x@gmail.com');
}

if (failures) { console.error(`\n${failures} failed`); process.exit(1); }
console.log('\nAll passed');
