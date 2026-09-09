// Assertion tests for mergeTagEdit (src/utils/contactTagReview.js). Plain
// Node — no test framework (the project has none). Run:
//   node scripts/tagWriteMerge.test.mjs
//
// This rule exists because of a real, months-long data loss. dans_tags is one
// semicolon-joined string, so every write replaces the whole list; the tag
// editors built that list from a CACHED copy of the contact, and any tag added
// since that copy was taken — in HubSpot's UI, on another device, in another
// tab — was deleted by the next tag click. A tag history audit found ~85
// contacts that lost a tag that way between March and September, almost always
// a single one (Dan Key Target, Procurement, Decision Maker) while the rest
// survived.
//
// So the write applies the user's CHANGE to what HubSpot holds right now,
// rather than overwriting with what the editor happens to be showing.
import { mergeTagEdit } from '../src/utils/contactTagReview.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}

// --- the incident, as a test ----------------------------------------------
//
// The editor opened with a stale copy ("ESG"), the user ticked Procurement,
// and meanwhile the contact had gained Dan Key Target in HubSpot. The old
// code wrote "ESG;Procurement" and Dan Key Target was gone.
eq(mergeTagEdit({ base: 'ESG', intended: 'ESG;Procurement', current: 'ESG;Dan Key Target' }),
  { action: 'write', tags: 'ESG;Dan Key Target;Procurement' },
  'a tag added elsewhere survives a tick made against a stale copy');

// The same shape with nothing in the stale copy at all — the "everything
// replaced by Hide" rows in the audit.
eq(mergeTagEdit({ base: '', intended: 'Hide', current: 'Private Equity' }),
  { action: 'write', tags: 'Private Equity;Hide' },
  'and Hide is added to what is there rather than standing in for it');

// --- turning a tag off is still honoured ----------------------------------
eq(mergeTagEdit({ base: 'ESG;Procurement', intended: 'ESG', current: 'ESG;Procurement;Dan Key Target' }),
  { action: 'write', tags: 'ESG;Dan Key Target' },
  'unticking removes that tag and leaves the untouched ones alone');
eq(mergeTagEdit({ base: 'ESG;Procurement', intended: '', current: 'ESG;Procurement;Dan Key Target' }),
  { action: 'write', tags: 'Dan Key Target' },
  'clearing the editor removes what it held, not what it never knew about');

// --- nothing to do --------------------------------------------------------
eq(mergeTagEdit({ base: 'ESG', intended: 'ESG', current: 'ESG' }), { action: 'unchanged' },
  'no change is not a write');
eq(mergeTagEdit({ base: 'ESG', intended: 'ESG;Procurement', current: 'ESG;Procurement' }),
  { action: 'unchanged' },
  'and neither is adding a tag HubSpot already has');

// --- an unreadable contact is never overwritten ---------------------------
eq(mergeTagEdit({ base: 'ESG', intended: 'ESG;Procurement', current: undefined }), { action: 'skip' },
  'a read that failed skips the write rather than guessing at "no tags"');
eq(mergeTagEdit({ base: 'ESG', intended: 'ESG;Procurement', current: null }), { action: 'skip' },
  'and so does a contact HubSpot has no record of');
// An EMPTY string is a real answer — the contact genuinely has no tags — and
// must not be confused with the unreadable case above.
eq(mergeTagEdit({ base: '', intended: 'ESG', current: '' }), { action: 'write', tags: 'ESG' },
  'a contact who really has no tags gets the one being added');

// --- spelling ------------------------------------------------------------
// This dataset carries both "Efficiency / Renewables" and the no-space form
// HubSpot's enumeration accepts. They are one tag.
eq(mergeTagEdit({
  base: 'ESG',
  intended: 'ESG;Efficiency / Renewables',
  current: 'ESG;Efficiency/Renewables',
}), { action: 'unchanged' },
  'a tag HubSpot already carries under another spelling is not added twice');
eq(mergeTagEdit({
  base: 'ESG;Efficiency / Renewables',
  intended: 'ESG',
  current: 'ESG;Efficiency/Renewables',
}), { action: 'write', tags: 'ESG' },
  'and unticking it removes the spelling HubSpot actually holds');

// --- order --------------------------------------------------------------
// What HubSpot holds keeps its order; additions land at the end. A write that
// merely reshuffled the same tags would be a pointless call — and would show
// up in the audit as a change nobody made.
eq(mergeTagEdit({ base: 'B', intended: 'B;C', current: 'A;B' }),
  { action: 'write', tags: 'A;B;C' }, 'additions go on the end of what is there');
eq(mergeTagEdit({ base: 'A;B', intended: 'B;A', current: 'A;B' }), { action: 'unchanged' },
  'reordering the editor changes nothing');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
