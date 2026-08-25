// Assertion tests for the bulk contact-tag edit (src/utils/contactTagReview.js:
// tagKey / dedupeTags / planTagEdit). Plain Node — no test framework (the
// project has none). Run:
//   node scripts/bulkTagEdit.test.mjs
//
// What's expensive about getting this wrong, in the two ways it already went
// wrong on the All Contacts page:
//
//   1. dans_tags is ONE string, so every tag write is a whole-list
//      overwrite. The old code built that list from the cached HubSpot
//      snapshot, and a contact the snapshot had never seen came back as
//      "no tags" — so a bulk ADD wrote only the chosen tag and silently
//      cleared everything else the contact had in HubSpot.
//
//   2. This dataset carries both "Efficiency / Renewables" and
//      "Efficiency/Renewables". The old comparison only lowercased, so the
//      two read as different tags: a remove aimed at one left the other
//      standing and reported "already up to date", and an add handed the
//      contact a second copy under the other spelling.
//
// The server has always treated them as one tag (api/hubspot.js dansTagKey),
// and so has the bulk picker — these tests hold the writer to the same rule.
import { tagKey, dedupeTags, planTagEdit, groupTagWrites, recordForVerdict, recordKeepsTag } from '../src/utils/contactTagReview.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}

// ── tagKey: one tag, however it's spelled ────────────────────────────────
{
  eq(tagKey('Efficiency / Renewables'), tagKey('Efficiency/Renewables'),
    'tagKey: spaced and unspaced Efficiency / Renewables are one tag');
  eq(tagKey('NAM Only'), tagKey('nam only'),
    'tagKey: casing is not identity');
  eq(tagKey('ESG') === tagKey('EU'), false,
    'tagKey: genuinely different tags stay different');
}

// ── dedupeTags ───────────────────────────────────────────────────────────
{
  eq(dedupeTags(['Efficiency / Renewables', 'Efficiency/Renewables', 'ESG']),
    ['Efficiency / Renewables', 'ESG'],
    'dedupeTags: picking both spellings writes the tag once, first spelling wins');
  eq(dedupeTags(['  ESG  ', '', null, 'ESG']), ['ESG'],
    'dedupeTags: trims, drops blanks, collapses repeats');
}

// ── planTagEdit: add ─────────────────────────────────────────────────────
{
  eq(planTagEdit('add', ['Decision Maker'], 'ESG;EU'),
    { action: 'write', tags: 'ESG;EU;Decision Maker' },
    'add: appends to what HubSpot holds, keeping the rest');

  eq(planTagEdit('add', ['Efficiency/Renewables'], 'ESG;Efficiency / Renewables'),
    { action: 'unchanged' },
    'add: a tag already held under the other spelling is already held');

  eq(planTagEdit('add', ['Efficiency / Renewables'], 'ESG'),
    { action: 'write', tags: 'ESG;Efficiency / Renewables' },
    'add: a tag they genuinely lack is added');

  // The bug that wiped tags: no contact to read, so there is no list to
  // append to. Writing anyway would send just the chosen tag.
  eq(planTagEdit('add', ['Efficiency / Renewables'], undefined),
    { action: 'skip' },
    'add: a contact HubSpot has no record of is skipped, never overwritten');

  eq(planTagEdit('add', ['ESG'], ''),
    { action: 'write', tags: 'ESG' },
    'add: a contact HubSpot holds with no tags yet is written, not skipped');
}

// ── planTagEdit: remove ──────────────────────────────────────────────────
{
  eq(planTagEdit('remove', ['Efficiency/Renewables'], 'ESG;Efficiency / Renewables;EU'),
    { action: 'write', tags: 'ESG;EU' },
    'remove: strips the tag whichever spelling the contact carries');

  eq(planTagEdit('remove', ['Procurement'], 'ESG;EU'),
    { action: 'unchanged' },
    'remove: a tag they never had leaves the list alone');

  eq(planTagEdit('remove', ['ESG'], undefined),
    { action: 'skip' },
    'remove: an unreadable contact is skipped');
}

// ── planTagEdit: replace ─────────────────────────────────────────────────
{
  eq(planTagEdit('replace', ['ESG'], 'EU;Procurement'),
    { action: 'write', tags: 'ESG' },
    'replace: overwrites the whole list, which is what it says on the tin');

  // Replace is the one mode that doesn't read the current list, so it still
  // runs for a contact we couldn't read.
  eq(planTagEdit('replace', ['ESG'], undefined),
    { action: 'write', tags: 'ESG' },
    'replace: runs even without a current list to build on');

  eq(planTagEdit('replace', [], 'ESG;EU'),
    { action: 'write', tags: '' },
    'replace: with nothing chosen, clears every tag');

  eq(planTagEdit('replace', ['ESG'], 'ESG'),
    { action: 'unchanged' },
    'replace: writing what HubSpot already holds is not a write');
}

// ── The reported case, end to end ────────────────────────────────────────
{
  // 22 contacts selected, "Add · Efficiency/Renewables". HubSpot has the
  // tag on some (under either spelling) and not on others; one selected id
  // is a contact HubSpot no longer has.
  const live = new Map([
    ['1', 'ESG;Efficiency / Renewables'],   // already has it, spaced
    ['2', 'ESG;Efficiency/Renewables'],     // already has it, unspaced
    ['3', 'ESG;Decision Maker'],            // genuinely missing it
    ['4', ''],                              // no tags at all
  ]);
  const ids = ['1', '2', '3', '4', '5'];    // 5 is gone from HubSpot
  const out = ids.map(id => planTagEdit('add', ['Efficiency/Renewables'], live.get(id)));
  eq(out.map(p => p.action),
    ['unchanged', 'unchanged', 'write', 'write', 'skip'],
    'reported case: only the contacts actually missing the tag are written');
  eq(out[2].tags, 'ESG;Decision Maker;Efficiency/Renewables',
    'reported case: the write keeps the tags the contact already had');
  eq(out[3].tags, 'Efficiency/Renewables',
    'reported case: an untagged contact gets just the new tag');
}

// ── The bulk "Mark …" actions ────────────────────────────────────────────
// A mark records an answer AND moves the HubSpot tag. Which way it moves is
// read off the record the mark leaves behind, per contact — not off one
// direction picked for the whole batch. Yes is the reason: it turns the tag
// on for everyone except a contact already held off by a Not sold, who
// records the Yes and keeps the tag off. That hold-off is the whole point,
// and a batch-wide "Yes means add" would quietly undo it.
{
  const after = (stored, verdict) => recordKeepsTag(recordForVerdict(stored, verdict));

  eq(after(undefined, 'yes'), true, 'Mark Yes on an unanswered tag turns the tag on');
  eq(after({ answer: 'no', status: '' }, 'yes'), true, 'Mark Yes over a No turns the tag on');
  eq(after({ answer: '', status: 'notsold' }, 'yes'), false,
    'Mark Yes over a Not sold keeps the tag OFF — the hold-off stands');
  eq(recordForVerdict({ answer: '', status: 'notsold' }, 'yes'),
    { answer: 'yes', status: 'notsold' },
    'Mark Yes over a Not sold still records the Yes: theirs, not bought yet');

  // The existing marks are unchanged by reading the record instead of a
  // fixed direction — they were always uniform.
  eq([after(undefined, 'sold'), after({ answer: 'yes', status: '' }, 'sold')], [true, true],
    'Mark Sold turns the tag on, whatever was there');
  eq([after(undefined, 'no'), after(undefined, 'unsure'), after(undefined, 'notsold')],
    [false, false, false],
    'Mark No / Not sure / Not sold all take the tag off');
  eq(after({ answer: 'yes', status: '' }, 'notsold'), false,
    'Mark Not sold over a Yes takes the tag off, and the Yes survives in the record');
}

// ── groupTagWrites ───────────────────────────────────────────────────────
{
  // The ordinary case: everyone wants the same thing, so it's one write.
  const same = new Map([
    ['1', { on: ['ESG'], off: [] }],
    ['2', { on: ['ESG'], off: [] }],
  ]);
  eq(groupTagWrites(['1', '2'], same),
    [{ mode: 'add', tags: ['ESG'], ids: ['1', '2'] }],
    'contacts wanting the same change go out as one write');

  // Mark Yes across a batch where one contact is held off.
  const mixed = new Map([
    ['1', { on: ['ESG'], off: [] }],
    ['2', { on: [], off: ['ESG'] }],   // held off by a Not sold
    ['3', { on: ['ESG'], off: [] }],
  ]);
  eq(groupTagWrites(['1', '2', '3'], mixed),
    [{ mode: 'add', tags: ['ESG'], ids: ['1', '3'] },
     { mode: 'remove', tags: ['ESG'], ids: ['2'] }],
    'a held-off contact is split out instead of being tagged with the rest');

  eq(groupTagWrites(['1'], new Map([['1', { on: [], off: [] }]])), [],
    'a contact wanting nothing produces no write at all');

  eq(groupTagWrites(['9'], new Map()), [],
    'an id with no plan produces no write');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
