// Assertion tests for the shared contact Bulk Edit plan. Plain Node:
//   node scripts/bulkContactEdit.test.mjs
import { planBulkContactEdit, planBulkTagPreset, planBulkTagAnswer, BULK_CONTACT_FIELDS } from '../src/utils/bulkContactEdit.js';

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n      got:  ${JSON.stringify(actual)}\n      want: ${JSON.stringify(expected)}`}`);
}

const cs = [
  { id: '1', jobtitle: 'VP', dans_tags: 'ESG;Decision Maker' },
  { id: '2', jobtitle: 'Director', dans_tags: '' },
  { vid: 3, jobtitle: 'Director' },
  { jobtitle: 'no id' },
];

check('title: writes only where it changes, skips no-id',
  planBulkContactEdit(cs, { field: 'jobtitle', value: ' Director ' }),
  { writes: [{ cid: '1', properties: { jobtitle: 'Director' } }], notes: null, skipped: 3 });
check('tags add: keeps existing, skips those that have it',
  planBulkContactEdit(cs.slice(0, 2), { field: 'dans_tags', mode: 'add', value: 'ESG; Utilities' }).writes,
  [{ cid: '1', properties: { dans_tags: 'ESG;Decision Maker;Utilities' } }, { cid: '2', properties: { dans_tags: 'ESG;Utilities' } }]);
check('tags remove: only contacts carrying it',
  planBulkContactEdit(cs.slice(0, 2), { field: 'dans_tags', mode: 'remove', value: 'esg' }).writes,
  [{ cid: '1', properties: { dans_tags: 'Decision Maker' } }]);
check('tags replace',
  planBulkContactEdit([cs[0]], { field: 'dans_tags', mode: 'replace', value: 'Hide' }).writes,
  [{ cid: '1', properties: { dans_tags: 'Hide' } }]);
const notes = planBulkContactEdit(cs.slice(0, 2), { field: 'notes', mode: 'append', value: 'call in Q1' }, { 1: 'met at expo' });
check('notes append: per-user map, no HubSpot writes', [notes.writes, notes.notes], [[], { 1: 'met at expo\ncall in Q1', 2: 'call in Q1' }]);
check('notes replace with blank clears', planBulkContactEdit([cs[0]], { field: 'notes', mode: 'replace', value: '' }, { 1: 'x', 9: 'keep' }).notes, { 9: 'keep' });

const preset = { id: 'p1', name: 'ESG Director', tags: { ESG: { answer: 'yes', status: '' }, Utilities: { answer: 'no', status: '' } } };
const pc = [
  { id: '1', dans_tags: 'Decision Maker;Utilities' },
  { id: '2', dans_tags: 'ESG' },
  { dans_tags: 'no id' },
];
// Contact 2 already has every row answered, so the preset has nothing to do
// there; a tag the preset leaves out is only filled (No) where it is blank.
const pp = planBulkTagPreset(pc, preset, { 2: { ESG: { answer: 'yes', status: '' }, Utilities: { answer: 'no', status: '' }, 'Decision Maker': { answer: 'unsure', status: '' } } }, ['ESG', 'Utilities', 'Decision Maker']);
check('preset: tag list follows the answers, other tags kept',
  pp.writes, [{ cid: '1', properties: { dans_tags: 'Decision Maker;ESG' } }]);
check('preset: answers recorded only where they change',
  pp.records, { 1: { ESG: { answer: 'yes', status: '' }, Utilities: { answer: 'no', status: '' } } });
check('preset: already-answered and no-id contacts are skipped', pp.skipped, 2);
check('preset: a tag it leaves out is filled No on a contact with no answer there',
  planBulkTagPreset([{ id: '2', dans_tags: 'ESG' }], preset, {}, ['ESG', 'Utilities', 'Decision Maker']).records,
  { 2: { ESG: { answer: 'yes', status: '' }, Utilities: { answer: 'no', status: '' }, 'Decision Maker': { answer: 'no', status: '' } } });

// Tag answers: Mark Yes / No / Not sure on a tag for every selected contact.
{
  const ac = [
    { id: '1', dans_tags: 'Decision Maker' },
    { id: '2', dans_tags: 'ESG;Decision Maker' },
    { id: '3', dans_tags: 'ESG' },
    { dans_tags: 'no id' },
  ];
  const yes = planBulkTagAnswer(ac, 'yes', 'ESG', { 3: { ESG: { answer: 'yes', status: '' } } });
  check('answer yes: the tag goes on where it is missing',
    yes.writes, [{ cid: '1', properties: { dans_tags: 'Decision Maker;ESG' } }]);
  check('answer yes: recorded where it was not already',
    yes.records, { 1: { ESG: { answer: 'yes', status: '' } }, 2: { ESG: { answer: 'yes', status: '' } } });
  check('answer yes: already-Yes and no-id contacts are skipped', yes.skipped, 2);

  const no = planBulkTagAnswer(ac.slice(0, 2), 'no', 'esg', {});
  check('answer no: the tag comes off where it is on, other tags kept',
    no.writes, [{ cid: '2', properties: { dans_tags: 'Decision Maker' } }]);
  check('answer no: recorded on everyone, including those who never had the tag',
    Object.keys(no.records), ['1', '2']);

  const unsure = planBulkTagAnswer([ac[2]], 'unsure', 'ESG', {});
  check('answer not sure: recorded and the tag comes off',
    [unsure.records, unsure.writes], [{ 3: { ESG: { answer: 'unsure', status: '' } } }, [{ cid: '3', properties: { dans_tags: '' } }]]);

  const held = planBulkTagAnswer([{ id: '9', dans_tags: '' }], 'yes', 'ESG', { 9: { ESG: { answer: '', status: 'notsold' } } });
  check('answer yes over a Not sold hold-off: Yes is recorded, the tag stays off',
    [held.records[9].ESG, held.writes], [{ answer: 'yes', status: 'notsold' }, []]);

  const two = planBulkTagAnswer([ac[0]], 'yes', 'ESG; Utilities', {});
  check('answer: several tags at once',
    [two.writes[0].properties.dans_tags, Object.keys(two.records[1])], ['Decision Maker;ESG;Utilities', ['ESG', 'Utilities']]);
  check('answer: nothing typed changes nothing', planBulkTagAnswer(ac, 'yes', ' ', {}).writes, []);
  check('tags field opens on Mark Yes, not Replace all',
    BULK_CONTACT_FIELDS.find(f => f.key === 'dans_tags').modes[0][0], 'yes');
}

if (failures) { console.log(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nAll passed');
