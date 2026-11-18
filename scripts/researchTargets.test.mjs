// Assertion tests for the Targets tab's "Research targets" button: the
// cleaning of what the model returns into rows the tab can store, and the
// type list it is asked to choose from. Plain Node, no framework. Run:
//   node scripts/researchTargets.test.mjs
import { allowedTypes, buildSystemPrompt, buildUserPrompt, cleanResearchedTargets, STANDARD_TARGET_TYPES } from '../api/_lib/researchTargets.js';
import { mergePastedTargets, mergeResearchedTargets, normalizeTargets } from '../src/utils/companyTargets.js';

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n      got:  ${JSON.stringify(actual)}\n      want: ${JSON.stringify(expected)}`}`);
}

// The type list: the user's names first, standard ones behind, no repeats.
check('types: custom first, de-duped ignoring case and punctuation, no "No target set"',
  allowedTypes(['Net-Zero', 'No target set', 'Water', '  ', 'water']).slice(0, 3),
  ['Net-Zero', 'Water', 'Carbon neutral']);
check('types: not a list falls back to the standard ones', allowedTypes('x'), STANDARD_TARGET_TYPES);
check('prompt: lists the types and the company', [
  buildSystemPrompt(['Net zero', 'Water']).includes('"Net zero", "Water"'),
  buildUserPrompt({ company: 'Westinghouse', domain: 'westinghousenuclear.com' }),
], [true, 'Research the climate and energy targets set by "Westinghouse" (website: westinghousenuclear.com). Return the JSON object as specified.']);

// A typical answer, messy in the ways models are.
const out = cleanResearchedTargets({
  targets: [
    { action: 'target', type: 'Net-Zero', yearSet: 'announced 2021', baseYear: 2019, targetYear1: 'by 2050', targetYear2: '2050', scope1: true, scope2: 'yes', scope3: 'no', classification: '1.5C', status: 'self-declared', datePublished: 'n/a', detail: ' Net-zero GHG emissions  by 2050 ', sourceUrl: 'https://example.com/esg' },
    // The same target again from a second source: dropped.
    { action: 'Target', type: 'Net zero', baseYear: '2019', targetYear1: '2050', scope1: true, scope2: true, scope3: false },
    { action: 'Commitment', type: '', commitmentType: 'Net-zero', status: 'committed', datePublished: 'Published 2024-04-25' },
    { action: 'Target', type: 'Water use', targetYear1: '2030', classification: 'ambitious', status: 'great', sourceUrl: 'javascript:alert(1)' },
    // No target year: progress or an aspiration, not a target.
    { action: 'Target', type: 'Absolute emissions reduction', baseYear: '2019' },
    null, 'x',
  ],
  noTargetFound: true,
  summary: 'Found   two targets.',
  sources: [{ title: 'ESG report', url: 'https://example.com/esg' }, { title: 'bad', url: 'ftp://x' }, { url: 'https://sbti.org/x' }],
}, allowedTypes(['Net zero']));

check('clean: net zero row standardized', out.targets[0], {
  action: 'Target', type: 'Net zero', commitmentType: '', yearSet: '2021', baseYear: '2019', targetYear1: '2050', targetYear2: '',
  scope1: true, scope2: true, scope3: false, classification: '1.5°C', status: 'Self-declared', datePublished: '',
  detail: 'Net-zero GHG emissions by 2050', sourceUrl: 'https://example.com/esg',
});
check('clean: repeat and yearless rows dropped, junk skipped', out.targets.map(t => t.type), ['Net zero', 'SBTi commitment', 'Water use']);
check('clean: commitment keeps its type, year set from date published',
  [out.targets[1].action, out.targets[1].commitmentType, out.targets[1].status, out.targets[1].datePublished, out.targets[1].yearSet],
  ['Commitment', 'Net-zero', 'Committed', '2024-04-25', '2024']);
check('clean: unknown classification, status and unsafe link blanked',
  [out.targets[2].classification, out.targets[2].status, out.targets[2].sourceUrl], ['', '', '']);
check('clean: noTargetFound is false once a target is found', out.noTargetFound, false);
check('clean: summary and sources', [out.summary, out.sources], ['Found two targets.', [
  { title: 'ESG report', url: 'https://example.com/esg' }, { title: 'https://sbti.org/x', url: 'https://sbti.org/x' },
]]);
check('clean: nothing usable', cleanResearchedTargets(null), { targets: [], noTargetFound: false, summary: '', sources: [] });
check('clean: no target found', cleanResearchedTargets({ targets: [], noTargetFound: true }).noTargetFound, true);

// The rows drop straight into the tab's own merge, and a second run adds nothing.
const first = mergePastedTargets([], out.targets);
check('merge: all three added', [first.added, first.list.length], [3, 3]);
check('merge: stored rows carry only the stored fields', Object.keys(first.list[0]).sort(), Object.keys(normalizeTargets([{}])[0]).sort());
check('merge: researching again adds nothing', mergePastedTargets(first.list, out.targets).added, 0);

// Researched rows meeting rows typed by hand (the Westinghouse case: a net
// zero row with only its years, and one with no base year).
const logged = [
  { id: 'a', action: 'Target', type: 'Net zero', baseYear: '2019', targetYear1: '2050' },
  { id: 'b', action: 'Target', type: 'Net zero', targetYear1: '2050' },
  { id: 'c', action: 'Target', type: 'Absolute emissions reduction', baseYear: '2019', targetYear1: '2023', scope1: true, scope2: true },
];
const researched = [
  { action: 'Target', type: 'Net zero', yearSet: '2021', baseYear: '2019', targetYear1: '2050', scope1: true, scope2: true, status: 'Self-declared' },
  { action: 'Target', type: 'Absolute emissions reduction', baseYear: '2019', targetYear1: '2030', scope1: true, scope2: true },
];
const m = mergeResearchedTargets(logged, researched);
check('research merge: hand-typed row filled in, differing target year added', [m.added, m.duplicates, m.updated, m.list.length], [1, 1, 1, 4]);
check('research merge: blanks filled, typed values kept', [m.list[0].id, m.list[0].yearSet, m.list[0].status, m.list[0].scope1, m.list[0].scope3, m.list[0].baseYear], ['a', '2021', 'Self-declared', true, false, '2019']);
check('research merge: second look-alike row left alone', [m.list[1].yearSet, m.list[1].status], ['', '']);
check('research merge: running it again changes nothing', (({ added, updated }) => [added, updated])(mergeResearchedTargets(m.list, researched)), [0, 0]);
check('research merge: differing scopes are different targets',
  mergeResearchedTargets([{ id: 'x', type: 'Net zero', targetYear1: '2050', scope1: true, scope2: true, scope3: true }], researched.slice(0, 1)).added, 1);
check('research merge: a hidden row is not matched', mergeResearchedTargets([{ ...logged[0], hidden: true }], researched.slice(0, 1)).added, 1);

if (failures) { console.log(`\n${failures} FAILED`); process.exit(1); }
console.log('\nAll passed');
