// Assertion tests for the Final Margin suggestion on the close-out popups.
// Plain Node - no test framework (the project has none). Run:
//   node scripts/closeOutMargin.test.mjs
import { snapshotMargin, suggestedFinalMargin } from '../src/utils/closeOutMargin.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a === b) { passed++; } else { failed++; console.error(`FAIL  ${name}\n        expected ${b}\n        got      ${a}`); }
}

eq(suggestedFinalMargin({}), null, 'no option attached: nothing to suggest, and nothing said');
eq(suggestedFinalMargin(null), null, 'no opp at all is the same');

eq(
  suggestedFinalMargin({ _pricingOption: { name: 'Option 2', finalMargin: 0.4617 } }),
  { text: '46.2%', pct: 0.4617, optionName: 'Option 2', from: 'final' },
  'the term margin saved with the SIA option',
);
eq(
  snapshotMargin({ finalMargin: null, marginByYear: [0.61, 0.52, null] }),
  { pct: 0.52, from: 'years' },
  'an older snapshot without a term margin falls back to the last year it has',
);
eq(
  snapshotMargin({ termRevenue: 100000, termCost: 60000 }),
  { pct: 0.4, from: 'totals' },
  'and then to the term totals behind it',
);
eq(snapshotMargin({ termRevenue: 0, termCost: 10 }), null, 'no revenue is no margin, not a divide by zero');

eq(
  suggestedFinalMargin({ _pricingOption: { name: 'Option 1' } }, { name: 'Option 1', source: 'pricing' }),
  { text: '', pct: null, optionName: 'Option 1', reason: 'noMargin' },
  'an SIA option with no margin saved says so',
);
eq(
  suggestedFinalMargin({}, { name: 'Option 3', source: 'options' }).reason,
  'handBuilt',
  'a hand-built option has no cost side, and says that instead',
);
eq(
  suggestedFinalMargin({}, 'Legacy Option').optionName,
  'Legacy Option',
  'a legacy string link still names the option',
);

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
