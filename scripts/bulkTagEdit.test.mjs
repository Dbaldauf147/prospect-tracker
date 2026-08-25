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
import { tagKey, dedupeTags, planTagEdit } from '../src/utils/contactTagReview.js';

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

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
