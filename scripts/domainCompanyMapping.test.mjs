// Assertion tests for moving an email domain between Table View companies
// from the Bulk Add Contacts "Apply suggestions" popup. Plain Node. Run:
//   node scripts/domainCompanyMapping.test.mjs
import { entryDomain, websiteDomain, remapDomainWrites } from '../src/utils/domainCompanyMapping.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.log(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}
const brief = (writes) => writes.map(w => [w.prospect.id, w.emailDomain]);

check('entryDomain pattern', entryDomain('{first}.{last}@Acme.com'), 'acme.com');
check('entryDomain bare', entryDomain(' acme.com '), 'acme.com');
check('websiteDomain', websiteDomain('https://www.Acme.com/about'), 'acme.com');

const old = { id: 'old', company: 'Old Co', emailDomain: '{first}.{last}@acme.com\nold.com' };
const neu = { id: 'new', company: 'New Co', emailDomain: 'new.com' };
const other = { id: 'other', company: 'Other', emailDomain: '' };

check('moves the format with the domain',
  brief(remapDomainWrites([old, neu, other], 'acme.com', neu, '{f}{last}@acme.com')),
  [['old', 'old.com'], ['new', 'new.com\n{first}.{last}@acme.com']]);

check('unmapped domain gets the learned format',
  brief(remapDomainWrites([old, neu], 'fresh.com', neu, '{first}@fresh.com')),
  [['new', 'new.com\n{first}@fresh.com']]);

check('no format learned: bare domain',
  brief(remapDomainWrites([neu], 'fresh.com', neu, '')),
  [['new', 'new.com\nfresh.com']]);

check('already on the target: nothing to write',
  brief(remapDomainWrites([old, neu], 'new.com', neu, '')), []);

check('unmap strips it from every company',
  brief(remapDomainWrites([old, neu], 'acme.com', null)), [['old', 'old.com']]);

check('bare entry dropped when a format comes along',
  brief(remapDomainWrites([
    { id: 'a', emailDomain: 'x.com' },
    { id: 'b', emailDomain: '{first}@x.com' },
    { id: 't', emailDomain: '' },
  ], 'x.com', { id: 't', emailDomain: '' })),
  [['a', ''], ['b', ''], ['t', '{first}@x.com']]);

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
