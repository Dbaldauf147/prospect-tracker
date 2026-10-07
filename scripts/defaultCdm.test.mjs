// Assertion tests for the CDM a new company starts with. Run:
//   node scripts/defaultCdm.test.mjs
import { withDefaultCdm } from '../src/utils/defaultCdm.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.error(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}

check('blank CDM gets the user\'s', withDefaultCdm({ company: 'Acme', cdm: '' }, 'Dan Baldauf'), { company: 'Acme', cdm: 'Dan Baldauf' });
check('missing CDM gets the user\'s', withDefaultCdm({ company: 'Acme' }, ' Dan Baldauf ').cdm, 'Dan Baldauf');
check('a CDM it brings is kept', withDefaultCdm({ cdm: 'Sara Rahme' }, 'Dan Baldauf').cdm, 'Sara Rahme');
check('no CDM name, nothing set', withDefaultCdm({ cdm: '' }, ''), { cdm: '' });
const rec = { cdm: '' };
withDefaultCdm(rec, 'Dan Baldauf');
check('input untouched', rec.cdm, '');

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
