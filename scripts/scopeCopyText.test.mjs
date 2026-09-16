// Assertion tests for the Scope picker's Copy text. Plain Node - no test
// framework (the project has none). Run:
//   node scripts/scopeCopyText.test.mjs
//
// What this pins is a format somebody pastes into a proposal or an email,
// so the things worth holding are the ones that would be noticed there:
// the categories survive, the order is the board's, and an empty scope
// copies nothing rather than a stray heading.
import { scopeCopyText } from '../src/utils/scopeCopyText.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}

const groups = [
  { category: 'Energy Management', items: [{ label: 'Comp GHG' }, { label: 'Strategic sourcing' }] },
  { category: 'Sustainability', items: [{ label: 'CSRD reporting' }] },
];

// ---- the ordinary case ------------------------------------------------------

eq(
  scopeCopyText(groups),
  'Energy Management\n- Comp GHG\n- Strategic sourcing\n\nSustainability\n- CSRD reporting',
  'services are listed under their category, in board order',
);

eq(
  scopeCopyText(groups, ['Electric', 'Natural Gas']),
  'Commodities: Electric, Natural Gas\n\nEnergy Management\n- Comp GHG\n- Strategic sourcing'
  + '\n\nSustainability\n- CSRD reporting',
  'commodities lead when the scope has any',
);

// ---- nothing to copy --------------------------------------------------------

eq(scopeCopyText([]), '', 'an empty scope copies nothing');
eq(scopeCopyText(), '', 'a missing selection copies nothing');
eq(scopeCopyText([{ category: 'Energy Management', items: [] }]), '', 'an empty category is not a scope');
eq(scopeCopyText([], ['Electric']), '', 'a commodity with no service is not worth pasting');

// ---- the awkward cases ------------------------------------------------------

eq(
  scopeCopyText([{ category: '', items: [{ label: 'Comp GHG' }] }]),
  '- Comp GHG',
  'a service with no category heading is still listed',
);

eq(
  scopeCopyText([{ category: 'Energy Management', items: [{ label: '  Comp GHG  ' }, { label: '' }] }]),
  'Energy Management\n- Comp GHG',
  'names are trimmed and blanks dropped',
);

eq(
  scopeCopyText(groups, ['', '  ']),
  'Energy Management\n- Comp GHG\n- Strategic sourcing\n\nSustainability\n- CSRD reporting',
  'blank commodities do not earn a line',
);

eq(
  scopeCopyText([{ category: 'Not on the board', items: [{ label: 'Something typed by hand' }] }]),
  'Not on the board\n- Something typed by hand',
  'off-board services copy like any other',
);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
