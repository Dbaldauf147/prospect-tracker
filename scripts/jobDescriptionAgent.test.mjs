import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  linkedinMarkedNa,
  jobDescriptionTargets, jobDescriptionPromptBlock, parseJobDescriptionPaste,
  jobDescriptionsPasteUpdate, DEFAULT_AI_PROMPT_JOB_DESCRIPTIONS, parseLocation, locationUpdatesFor,
} from '../src/utils/jobDescriptionAgent.js';

const contacts = [
  { id: '1', firstname: 'Stephen', lastname: 'Smith', company: 'Simon', jobtitle: 'SVP Ops', hs_linkedin_url: 'https://www.linkedin.com/in/ss', dans_tags: 'Dan Key Target' },
  { id: '2', firstname: 'Ann', lastname: 'Lee', company: 'Acme', dans_tags: 'Dan Key Target' },
  { id: '3', firstname: 'Has', lastname: 'Desc', company: 'Acme', dans_tags: 'Dan Key Target' },
  { id: '4', firstname: 'Marked', lastname: 'NA', company: 'Acme', dans_tags: 'Dan Key Target' },
  { id: '5', firstname: 'Not', lastname: 'Key', company: 'Acme', dans_tags: 'Met In Person' },
  { id: '6', firstname: 'Hidden', lastname: 'One', company: 'Acme', dans_tags: 'Dan Key Target; Hide' },
  { id: '7', firstname: 'Left', lastname: 'Co', company: 'Acme', dans_tags: 'Dan Key Target; Left' },
];

test('lists Key Contacts whose job description is blank, N/A counts as done', () => {
  const t = jobDescriptionTargets(contacts, { 3: 'Leads ops', 4: 'N/A' }, { 2: { _companyOverride: 'Acme Corp' } });
  assert.deepEqual(t.map(r => r.id), ['2', '1']);
  assert.equal(t[0].company, 'Acme Corp');
  assert.equal(t[0].linkedin, '');
  assert.equal(t[1].linkedin, 'https://www.linkedin.com/in/ss');
});

test('the prompt block carries only contacts with a LinkedIn URL', () => {
  const block = jobDescriptionPromptBlock(jobDescriptionTargets(contacts, {}));
  const lines = block.split('\n');
  assert.equal(lines[0], 'Contact ID\tName\tCompany\tJob Title\tLinkedIn URL');
  assert.deepEqual(lines.slice(1), ['1\tStephen Smith\tSimon\tSVP Ops\thttps://www.linkedin.com/in/ss']);
});

test('reads a multi-line paste back, N/A and empty blocks become N/A', () => {
  const paste = [
    'Here you go:',
    '=== 1 | Stephen Smith ===',
    'Enterprise-wide responsibility.',
    '',
    '- Asset Management',
    'Current role: SVP, Simon, Jan 2013 - Present',
    '=== 2 | Ann Lee ===',
    'N/A',
    '===  9  ===',
    '',
  ].join('\r\n');
  assert.deepEqual(parseJobDescriptionPaste(paste), [
    { id: '1', text: 'Enterprise-wide responsibility.\n\n- Asset Management\nCurrent role: SVP, Simon, Jan 2013 - Present', location: null },
    { id: '2', text: 'N/A', location: null },
    { id: '9', text: 'N/A', location: null },
  ]);
  assert.deepEqual(parseJobDescriptionPaste('no headers here'), []);
});

test('writes the paste into contactJobDescriptions, no write when nothing changes', () => {
  const s0 = { contactJobDescriptions: { 5: 'Kept' } };
  const patch = jobDescriptionsPasteUpdate([{ id: '1', text: 'About' }, { id: '2', text: 'N/A' }])(s0);
  assert.deepEqual(patch.contactJobDescriptions, { 5: 'Kept', 1: 'About', 2: 'N/A' });
  assert.equal(jobDescriptionsPasteUpdate([{ id: '5', text: 'Kept' }])(s0), null);
  assert.equal(jobDescriptionsPasteUpdate([])(s0), null);
});

test('the prompt asks for the format the parser reads', () => {
  const example = DEFAULT_AI_PROMPT_JOB_DESCRIPTIONS.split('For example:\n')[1];
  const [first] = parseJobDescriptionPaste(example);
  assert.equal(first.id, '12345');
  assert.deepEqual(first.location, { city: 'Indianapolis', state: 'Indiana' });
  assert.ok(!first.text.includes('Location:'), 'the Location line is not part of the job description');
  assert.match(DEFAULT_AI_PROMPT_JOB_DESCRIPTIONS, /Location: <City>, <State>/);
});

test('a leading Location line becomes city/state, later ones stay in the text', () => {
  const paste = [
    '=== 1 | A ===', '', 'Location: Austin, Texas, United States', 'About text', 'Location: somewhere else',
    '=== 2 | B ===', 'Location: N/A', 'N/A',
    '=== 3 | C ===', 'location:  Greater Boston ', 'Current role: X',
  ].join('\n');
  const [a, b, c] = parseJobDescriptionPaste(paste);
  assert.deepEqual(a, { id: '1', text: 'About text\nLocation: somewhere else', location: { city: 'Austin', state: 'Texas' } });
  assert.deepEqual(b, { id: '2', text: 'N/A', location: null });
  assert.deepEqual(c, { id: '3', text: 'Current role: X', location: null });
  assert.equal(parseLocation(''), null);
  assert.deepEqual(parseLocation('Toronto, Ontario'), { city: 'Toronto', state: 'Ontario' });
});

test('location updates skip contacts that already have that city and state', () => {
  const cs = [{ id: '1', city: 'austin', state: 'TEXAS' }, { id: '2', city: 'Dallas', state: 'Texas' }, { vid: 3 }];
  const loc = { city: 'Austin', state: 'Texas' };
  const u = locationUpdatesFor([{ id: '1', location: loc }, { id: '2', location: loc }, { id: '3', location: loc }, { id: '4', location: loc }, { id: '2', location: null }], cs);
  assert.deepEqual(u, [{ id: '2', properties: loc }, { id: '3', properties: loc }]);
});

test('a LinkedIn URL of N/A takes the contact off the list; a blank one does not', () => {
  const key = (id, url) => ({ id, firstname: `P${id}`, dans_tags: 'Dan Key Target', company: 'Acme', hs_linkedin_url: url });
  const ids = jobDescriptionTargets([
    key('1', 'N/A'), key('2', 'n/a'), key('3', ''), key('4', 'https://www.linkedin.com/in/x'), key('5', 'NA'), key('6', 'none'), key('7', '-'),
  ], {}).map(t => t.id).sort();
  assert.deepEqual(ids, ['3', '4']);
  assert.equal(linkedinMarkedNa('N/A.'), true);
  assert.equal(linkedinMarkedNa('https://linkedin.com/in/na'), false);
  assert.equal(linkedinMarkedNa(''), false);
});
