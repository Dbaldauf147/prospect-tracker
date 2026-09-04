// Assertion tests for tagging Costs to Serve rows. Plain Node, no test
// framework (the project has none). Run:
//   node scripts/s2cTags.test.mjs
//
// The cost block is re-pasted from Excel whenever costs change, and that paste
// replaces every row. Tags live only in this app, so the thing worth pinning
// is that a refresh doesn't quietly throw the tagging away — including when
// Excel comes back with different casing or a stray trailing space.
import {
  carryTagsOnPaste, tagSuggestions, costElementKey, hasTags, S2C_TAG_FIELDS,
} from '../src/utils/s2cTags.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.error(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}

const row = (costElement, over = {}) => ({
  costElement, setup: '', setupUom: '', ongoing: '', ongoingUom: '',
  serviceSegment: '', productName: '', deliverable: '', ...over,
});
const tags = (r) => [r.serviceSegment, r.productName, r.deliverable];

// ── The three columns ─────────────────────────────────────────────────────
check('fields', S2C_TAG_FIELDS.map(f => f.key), ['serviceSegment', 'productName', 'deliverable']);

// ── Matching a Cost Element ───────────────────────────────────────────────
check('key: folded and trimmed', costElementKey('  Implementation '), 'implementation');
check('key: casing', costElementKey('IMPLEMENTATION'), 'implementation');
check('key: nothing', costElementKey(), '');

check('hasTags: untagged', hasTags(row('X')), false);
check('hasTags: whitespace is not a tag', hasTags(row('X', { productName: '   ' })), false);
check('hasTags: one is enough', hasTags(row('X', { deliverable: 'Report' })), true);

// ── Carrying tags across a re-paste ───────────────────────────────────────
const previous = [
  row('Implementation', { serviceSegment: 'Sustainability', productName: 'ESL', deliverable: 'Onboarding' }),
  row('Managed service', { serviceSegment: 'Ops', productName: 'CCM', deliverable: 'Monthly report' }),
  row('Untagged element'),
  row(''),
];

{
  // The ordinary refresh: same elements, new numbers.
  const pasted = [row('Implementation', { setup: '2500' }), row('Managed service', { ongoing: '25' })];
  const out = carryTagsOnPaste(pasted, previous);
  check('carry: tags come across', tags(out[0]), ['Sustainability', 'ESL', 'Onboarding']);
  check('carry: and the new numbers survive', out[0].setup, '2500');
  check('carry: second row too', tags(out[1]), ['Ops', 'CCM', 'Monthly report']);
}
{
  // Excel gives the name back differently — the tags must still find it.
  const out = carryTagsOnPaste([row('  IMPLEMENTATION  ')], previous);
  check('carry: casing and whitespace still match', tags(out[0]), ['Sustainability', 'ESL', 'Onboarding']);
}
{
  // A genuinely new cost element has nothing to inherit.
  const out = carryTagsOnPaste([row('Brand new element')], previous);
  check('carry: new elements arrive blank', tags(out[0]), ['', '', '']);
}
{
  // A blank Cost Element names nothing and must not collect another row's tags.
  const out = carryTagsOnPaste([row('')], previous);
  check('carry: blank names match nothing', tags(out[0]), ['', '', '']);
}
{
  // Nothing was tagged before, so nothing changes — and the same array comes
  // back rather than a rebuilt one.
  const plain = [row('A'), row('B')];
  const out = carryTagsOnPaste(plain, [row('A'), row('B')]);
  check('carry: no tags to carry', out, plain);
}
{
  // Duplicate elements: first tagged row wins, so the result doesn't depend on
  // where in the sheet the duplicate sat.
  const dupes = [
    row('Meters', { productName: 'First' }),
    row('Meters', { productName: 'Second' }),
  ];
  check('carry: first tagged row wins',
    carryTagsOnPaste([row('Meters')], dupes)[0].productName, 'First');
}
{
  // A partially tagged row carries only the tags it has — an empty tag must
  // not overwrite anything, and must not invent a value.
  const partial = [row('Setup', { productName: 'ESL' })];
  const out = carryTagsOnPaste([row('Setup')], partial);
  check('carry: partial tags', tags(out[0]), ['', 'ESL', '']);
}
{
  // The paste itself carrying a tag is not clobbered by the old one. (Not a
  // path the UI offers today, but the merge should be sane if it ever does.)
  const out = carryTagsOnPaste([row('Implementation', { productName: 'FromExcel' })], previous);
  check('carry: existing tag still wins on a name match', out[0].productName, 'ESL');
}

// ── Suggestions ───────────────────────────────────────────────────────────
{
  const rows = [
    row('a', { serviceSegment: 'Sustainability' }),
    row('b', { serviceSegment: 'sustainability' }),
    row('c', { serviceSegment: 'Ops' }),
    row('d', { serviceSegment: '  ' }),
    row('e', {}),
  ];
  check('suggest: deduped case-insensitively, sorted',
    tagSuggestions(rows, 'serviceSegment'), ['Ops', 'Sustainability']);
  check('suggest: first spelling is the one offered',
    tagSuggestions([row('a', { productName: 'esl' }), row('b', { productName: 'ESL' })], 'productName'),
    ['esl']);
  check('suggest: empty column', tagSuggestions(rows, 'deliverable'), []);
  check('suggest: no rows', tagSuggestions([], 'productName'), []);
}

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
