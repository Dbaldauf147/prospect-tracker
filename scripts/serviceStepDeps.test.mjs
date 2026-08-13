// Assertion tests for step-refined Dependent Rollout Services. Plain Node —
// no test framework (the project has none). Run:
//   node scripts/serviceStepDeps.test.mjs
//
// The reference format is the part worth pinning down. Steps are stored by ID
// rather than by name for one concrete reason: the list is comma-separated and
// real step names contain commas ("Provision of Capstone, Invoices, and
// Contracts"), so a name in there would split into three dependencies. The
// tests below hold that, and hold that editing the list by service name can't
// silently drop somebody's step refinement.
import {
  parseServiceRef, formatServiceRef, parseServiceRefs,
  findTemplateStepIndex, stepLabel, describeServiceRef, setRefStep, refStepFor,
} from '../src/utils/serviceStepDeps.js';

let failures = 0;
function check(label, actual, expected) {
  const ok = Object.is(actual, expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n      got:  ${JSON.stringify(actual)}\n      want: ${JSON.stringify(expected)}`}`);
}
function same(label, actual, expected) {
  check(label, JSON.stringify(actual), JSON.stringify(expected));
}

// --- one reference ---------------------------------------------------------

same('a plain service name has no step', parseServiceRef('Bill payment'), { service: 'Bill payment', step: '' });
same('a refined entry splits on the first >', parseServiceRef('Bill payment > st-12'), { service: 'Bill payment', step: 'st-12' });
same('spacing around the separator is optional', parseServiceRef('Bill payment>st-12'), { service: 'Bill payment', step: 'st-12' });
same('surrounding whitespace goes', parseServiceRef('  Bill payment  >  st-12  '), { service: 'Bill payment', step: 'st-12' });
same('a blank entry is empty', parseServiceRef('   '), { service: '', step: '' });
same('a nullish entry is empty', parseServiceRef(null), { service: '', step: '' });
// Only the first ">" separates, so a stray one can't lose the step.
same('a second > belongs to the step', parseServiceRef('A > b > c'), { service: 'A', step: 'b > c' });

check('formatting a plain dependency omits the separator', formatServiceRef('Bill payment', ''), 'Bill payment');
check('and includes it for a step', formatServiceRef('Bill payment', 'st-12'), 'Bill payment > st-12');
check('a service with no name formats to nothing', formatServiceRef('  ', 'st-1'), '');
// Round trip.
same('a formatted reference parses back', parseServiceRef(formatServiceRef('Bill payment', 'st-12')), { service: 'Bill payment', step: 'st-12' });

// --- a whole list ----------------------------------------------------------

same('a mixed list parses entry by entry',
  parseServiceRefs('Bill payment > st-12, Invoice collection,  , Meters > st-3'),
  [{ service: 'Bill payment', step: 'st-12' },
   { service: 'Invoice collection', step: '' },
   { service: 'Meters', step: 'st-3' }]);
same('an array is accepted as readily as a string',
  parseServiceRefs(['A > st-1', 'B']), [{ service: 'A', step: 'st-1' }, { service: 'B', step: '' }]);
same('an empty list parses to nothing', parseServiceRefs(''), []);

// THE reason steps are stored by ID. A step name with commas in it would be
// torn into separate dependencies by the list separator; an ID never is.
same('a comma in a step NAME would break the list',
  parseServiceRefs('Bill payment > Provision of Capstone, Invoices, and Contracts').map(r => r.service),
  ['Bill payment', 'Invoices', 'and Contracts']);
same('which is why the stored form uses the ID',
  parseServiceRefs('Bill payment > st-4').map(r => [r.service, r.step]),
  [['Bill payment', 'st-4']]);

// --- resolving against a template -----------------------------------------

const tpl = { stages: [
  { id: 'st-1', name: 'Project Kickoff' },
  { id: 'st-4', name: 'Provision of Capstone, Invoices, and Contracts' },
  { id: 'st-12', name: 'Bill Redirection & Go Live' },
] };

check('a step resolves by id', findTemplateStepIndex(tpl, 'st-12'), 2);
check('ids match case-insensitively', findTemplateStepIndex(tpl, 'ST-12'), 2);
// Name matching is the courtesy for a hand-typed value; it only works when the
// name has no comma, which is exactly why it isn't the stored form.
check('a step also resolves by exact name', findTemplateStepIndex(tpl, 'Bill Redirection & Go Live'), 2);
check('an unknown step resolves to nothing', findTemplateStepIndex(tpl, 'st-99'), -1);
check('a blank step resolves to nothing', findTemplateStepIndex(tpl, ''), -1);
check('a missing template resolves to nothing', findTemplateStepIndex(null, 'st-1'), -1);

check('a resolved step names itself', stepLabel(tpl, 'st-12'), 'Bill Redirection & Go Live');
check('an unresolved step names nothing', stepLabel(tpl, 'st-99'), '');

check('a reference reads as service then step',
  describeServiceRef('Bill payment', 'Bill Redirection & Go Live'), 'Bill payment › Bill Redirection & Go Live');
check('and as just the service without one', describeServiceRef('Bill payment', ''), 'Bill payment');

// --- editing one entry without disturbing the rest -------------------------
// A service picker edits this list by name. It must not flatten a step
// refinement made elsewhere, or choosing an unrelated dependency would quietly
// re-plan the deal.

const list = 'Bill payment > st-12, Invoice collection, Meters > st-3';
check('refining one service leaves the others alone',
  setRefStep(list, 'Invoice collection', 'st-7'),
  'Bill payment > st-12, Invoice collection > st-7, Meters > st-3');
check('clearing a refinement drops just that step',
  setRefStep(list, 'Bill payment', ''),
  'Bill payment, Invoice collection, Meters > st-3');
check('replacing a refinement keeps the position',
  setRefStep(list, 'Bill payment', 'st-1'),
  'Bill payment > st-1, Invoice collection, Meters > st-3');
check('a service not in the list changes nothing', setRefStep(list, 'Nope', 'st-1'), list);
check('matching is case-insensitive', setRefStep(list, 'bill PAYMENT', 'st-2'),
  'Bill payment > st-2, Invoice collection, Meters > st-3');
check('a blank service name is a no-op', setRefStep(list, '', 'st-1'), list);
// Normalization: the list comes back in the canonical spacing either way.
check('an untouched list still round-trips through the formatter',
  setRefStep('A>st-1,B', 'B', ''), 'A > st-1, B');

check('the step for a service reads back', refStepFor(list, 'Meters'), 'st-3');
check('a service without one reads back blank', refStepFor(list, 'Invoice collection'), '');
check('a service not in the list reads back blank', refStepFor(list, 'Nope'), '');

console.log(failures === 0 ? '\nAll passed.' : `\n${failures} failed.`);
process.exit(failures === 0 ? 0 : 1);
