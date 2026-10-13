// Assertion tests for tag presets (src/utils/tagPresets.js). Plain Node. Run:
//   node scripts/tagPresets.test.mjs
//
// A preset is a named set of answers for the contact popup's tag table,
// saved off one contact and applied to another in one click.
import { presetTagsFrom, applyTagPreset, savePreset, deletePreset, presetSummary } from '../src/utils/tagPresets.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}

const TAGS = ['ESG', 'Efficiency / Renewables', 'Procurement', 'Decision Maker', 'Hide'];

// --- saving ----------------------------------------------------------------
{
  const tags = presetTagsFrom({
    checked: new Set(['ESG', 'Decision Maker']),
    verdicts: { Procurement: { answer: 'no', status: '' }, 'Efficiency/Renewables': { answer: 'yes', status: 'notsold' } },
    tags: TAGS,
  });
  eq(tags, {
    ESG: { answer: 'yes', status: '' },
    'Efficiency / Renewables': { answer: 'yes', status: 'notsold' },
    Procurement: { answer: 'no', status: '' },
    'Decision Maker': { answer: 'yes', status: '' },
  }, 'a preset saves every answered row, as the table shows it, and skips blank ones');
}

// --- applying ----------------------------------------------------------------
{
  const preset = { tags: {
    ESG: { answer: 'yes', status: '' },
    Procurement: { answer: 'no', status: '' },
    'Efficiency/Renewables': { answer: 'yes', status: 'notsold' },
    'Gone Tag': { answer: 'yes', status: '' },
  } };
  const { checked, verdicts } = applyTagPreset({
    checked: new Set(['Procurement', 'Hide']),
    verdicts: { 'efficiency / renewables': 'sold', Hide: { answer: 'yes', status: '' } },
    tags: TAGS,
    preset,
  });
  eq([...checked].sort(), ['ESG', 'Hide'],
    'Yes turns a tag on, No takes one off, Not sold holds one off, and untouched tags stay');
  eq(verdicts, {
    Hide: { answer: 'yes', status: '' },
    ESG: { answer: 'yes', status: '' },
    Procurement: { answer: 'no', status: '' },
    'Efficiency / Renewables': { answer: 'yes', status: 'notsold' },
  }, 'records land under the vocabulary spelling, replacing other spellings; unknown tags are skipped');
}

{
  const { checked } = applyTagPreset({
    checked: new Set(), verdicts: {}, tags: TAGS,
    preset: { tags: { 'Decision Maker': { answer: '', status: 'sold' } } },
  });
  eq([...checked], ['Decision Maker'], 'Sold on its own puts the tag on');
}

// --- the list ----------------------------------------------------------------
{
  let list = savePreset([], 'ESG Director', { ESG: { answer: 'yes', status: '' } });
  eq(list.length, 1, 'saving adds a preset');
  const id = list[0].id;
  list = savePreset(list, '  esg director ', { Procurement: { answer: 'no', status: '' } });
  eq([list.length, list[0].id, list[0].name, Object.keys(list[0].tags)], [1, id, 'esg director', ['Procurement']],
    'saving under an existing name (any case) overwrites it in place');
  eq(savePreset(list, '   ', {}), list, 'a blank name saves nothing');
  list = savePreset(list, 'CFO', {});
  eq(deletePreset(list, id).map(p => p.name), ['CFO'], 'deleting removes just that preset');
}

eq(presetSummary({ tags: { ESG: { answer: 'yes', status: '' }, Procurement: { answer: 'no', status: '' } } }),
  'Tags on: ESG. 1 other answer (No / Not sure / Not sold)', 'the tooltip names the tags a preset turns on');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
