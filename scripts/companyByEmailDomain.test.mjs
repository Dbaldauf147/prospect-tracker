// Plain Node, no framework. Run:
//   node scripts/companyByEmailDomain.test.mjs
import { makeCompanyByEmailDomain } from '../src/utils/companyByEmailDomain.js';

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n      got:  ${JSON.stringify(actual)}\n      want: ${JSON.stringify(expected)}`}`);
}

const of = makeCompanyByEmailDomain([
  { company: 'Schneider Electric', goesBy: 'Schneider', emailDomain: 'firstname.lastname@se.com' },
  { company: 'Blackstone', emailDomain: 'blackstone.com' },
  { company: 'BRE Hotels', emailDomain: 'blackstone.com\nbrehotels.com' },
  { company: 'Acme', website: 'https://www.acme.com/about' },
  { company: 'Freebie', emailDomain: 'gmail.com' },
  { company: '', emailDomain: 'nameless.com' },
  null,
]);
const name = e => of(e)?.company || '';
check('pattern entry: the domain after the @', name('Daniel.Baldauf@SE.com'), 'Schneider Electric');
check('goes by comes with it', of('a@se.com').goesBy, 'Schneider');
check('website domain', name('x@acme.com'), 'Acme');
check('a domain two companies claim says nothing', name('x@blackstone.com'), '');
check('their other domain still does', name('x@brehotels.com'), 'BRE Hotels');
check('free mail never', name('x@gmail.com'), '');
check('unknown, blank, not an address', [name('x@nowhere.com'), name(''), name('nope'), name(null)], ['', '', '', '']);
check('a card with no name is skipped', name('x@nameless.com'), '');

if (failures) { console.error(`\n${failures} failed`); process.exit(1); }
console.log('\nAll passed');
