// Assertion tests for hand-corrected company facts. Plain Node - no test
// framework (the project has none). Run:
//   node scripts/companyFacts.test.mjs
//
// These figures are not display-only: employees gates CSRD's 1,000-employee
// test and revenue drives the SB 253 / SB 261 verdicts. A resolver that
// picks the wrong one produces a wrong compliance answer with no visible
// sign it did, which is why the precedence rules are pinned here.
import {
  parseEmployeesInput, parseTextInput, resolveFact, resolveCompanyFacts,
} from '../src/utils/companyFacts.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}
function ok(value, name) { eq(!!value, true, name); }

// ---- employees -------------------------------------------------------------

eq(parseEmployeesInput('2000'), { ok: true, value: 2000 }, 'a plain count parses');
eq(parseEmployeesInput('2,000'), { ok: true, value: 2000 }, 'thousands separators are accepted, since that is how it is shown');
eq(parseEmployeesInput(' 2 000 '), { ok: true, value: 2000 }, 'stray spaces inside the number too');

// Clearing is the only way to undo an edit, so it has to succeed.
eq(parseEmployeesInput(''), { ok: true, value: null }, 'an empty box clears the override');
eq(parseEmployeesInput('   '), { ok: true, value: null }, 'and so does whitespace');
eq(parseEmployeesInput(null), { ok: true, value: null }, 'and a missing value');

ok(!parseEmployeesInput('about 2000').ok, 'prose is not a headcount');
ok(!parseEmployeesInput('2.5').ok, 'nor a fraction of a person');
ok(!parseEmployeesInput('-5').ok, 'nor a negative one');
ok(!parseEmployeesInput('0').ok, 'zero is rejected: clearing is how you say "unknown"');
ok(!parseEmployeesInput('999999999').ok, 'a typo larger than any workforce is caught');
ok(/whole number/i.test(parseEmployeesInput('abc').error), 'and the error says what is wanted');

// ---- free text -------------------------------------------------------------

eq(parseTextInput('$2.1B'), { ok: true, value: '$2.1B' }, 'revenue keeps its currency and units');
eq(parseTextInput('not disclosed'), { ok: true, value: 'not disclosed' }, 'and can say there is no figure');
eq(parseTextInput('  EUR   840m '), { ok: true, value: 'EUR 840m' }, 'runs of whitespace collapse');
eq(parseTextInput(''), { ok: true, value: null }, 'empty clears');
ok(!parseTextInput('x'.repeat(200)).ok, 'a pasted paragraph is refused');

// ---- precedence ------------------------------------------------------------

eq(
  resolveFact('$5B', '$2.1B'),
  { value: '$5B', edited: true, researched: '$2.1B' },
  'an edit wins over the research, and the research is kept to revert to',
);
eq(
  resolveFact(null, '$2.1B'),
  { value: '$2.1B', edited: false, researched: '$2.1B' },
  'with no edit the research shows, unmarked',
);
// The distinction the marker depends on: a cleared override is absence,
// not a deliberate blank. Getting this wrong would leave the card
// claiming a value was hand-entered after the user had just erased it.
eq(resolveFact('', '$2.1B').edited, false, 'a cleared edit is not an edit');
eq(resolveFact(undefined, '$2.1B').edited, false, 'and neither is one that was never made');
eq(resolveFact(null, null), { value: null, edited: false, researched: null }, 'nothing researched and nothing typed is simply empty');

// A researched value of zero employees is no value at all - the research
// writes 0 when it could not find a figure.
eq(resolveCompanyFacts({ revenueResearch: { employees: 0 } }).employees.value, null, 'a researched zero headcount is treated as unknown');
eq(resolveCompanyFacts({ revenueResearch: { employees: '2000' } }).employees.value, 2000, 'a researched count arriving as a string still counts');
eq(
  resolveCompanyFacts({ edits: { employees: 3500 }, revenueResearch: { employees: 2000 } }).employees,
  { value: 3500, edited: true, researched: 2000 },
  'a corrected headcount wins, and says what it replaced',
);

// The whole card at once, which is how the component reads it.
{
  const facts = resolveCompanyFacts({
    edits: { revenue: '$5B' },
    revenueResearch: { revenue: '$2.1B', employees: 2000 },
    hqLocation: 'Charlotte, North Carolina, United States',
  });
  eq(facts.revenue.value, '$5B', 'the edited revenue shows');
  eq(facts.employees.value, 2000, 'the un-edited headcount still comes from research');
  eq(facts.employees.edited, false, 'and is not marked as edited');
  eq(facts.hqLocation.value, 'Charlotte, North Carolina, United States', 'the HQ passes through');
}

// Nothing at all must not throw: a brand-new company has no card state.
eq(resolveCompanyFacts().revenue, { value: null, edited: false, researched: null }, 'an empty card resolves rather than throwing');
eq(resolveCompanyFacts({}).employees.value, null, 'and so does an empty argument');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
