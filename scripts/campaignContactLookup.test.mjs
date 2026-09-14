// Assertion tests for the Email Campaign Tracker's contact lookup.
// Plain Node - no test framework (the project has none). Run:
//   node scripts/campaignContactLookup.test.mjs
//
// What's worth pinning: an address pasted with its display name still finds
// the person, an exact address never drags in the longer addresses that
// contain it, a group row ("a@x; b@y") is findable by either half, a
// campaign listing the same address twice yields both rows, and the summary
// counts campaigns distinctly while counting sends per row.
import {
  LOOKUP_MIN_CHARS, normLookupEmail, contactAddresses, findContactRows,
  lookupSummary, lookupSuggestions,
} from '../src/utils/campaignContactLookup.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.log(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}

// --- normalizing what gets typed ---------------------------------------
check('lowercased and trimmed', normLookupEmail('  Sam@Acme.COM '), 'sam@acme.com');
check('a pasted display name is stripped', normLookupEmail('Sam Doe <Sam@Acme.com>'), 'sam@acme.com');
check('nothing typed is nothing', normLookupEmail(undefined), '');

// --- a roster row's addresses ------------------------------------------
check('a single address', contactAddresses({ email: 'Sam@Acme.com' }), ['sam@acme.com']);
check('a group row splits', contactAddresses({ email: 'a@x.com; b@y.com' }), ['a@x.com', 'b@y.com']);
check('commas split too', contactAddresses({ email: 'a@x.com, b@y.com' }), ['a@x.com', 'b@y.com']);
check('an empty row', contactAddresses({}), []);

// --- the campaigns a contact is on -------------------------------------
const campaigns = [
  {
    title: 'September power prices',
    contacts: [
      { email: 'sam@acme.com', sentDate: '2026-09-02T10:00:00Z', replied: true, replyDate: '2026-09-03T08:00:00Z' },
      { email: 'lee@acme.com', sentDate: '2026-09-02T10:00:00Z' },
    ],
  },
  {
    title: 'Autumn breakfast',
    contacts: [
      { email: 'Sam@Acme.com', sentDate: '2026-09-09T10:00:00Z' },
      { email: 'sam@acme.com.au', sentDate: '2026-09-09T10:00:00Z' },
      { email: 'jo@other.com' },
    ],
  },
  {
    title: 'Winter outlook',
    // Never sent, and the same person listed twice - both are real rows.
    contacts: [{ email: 'sam@acme.com' }, { email: 'sam@acme.com' }],
  },
];

const sam = findContactRows(campaigns, 'sam@acme.com');
check('every row for the address', sam.length, 4);
check('the longer address is not swept in',
  sam.every(r => !r.addresses.includes('sam@acme.com.au')), true);
check('most recently sent first', sam.map(r => r.campaign.title),
  ['Autumn breakfast', 'September power prices', 'Winter outlook', 'Winter outlook']);
check('the campaign index travels with the row', sam[0].campaignIndex, 1);
check('a pasted display name finds the same rows',
  findContactRows(campaigns, 'Sam Doe <sam@acme.com>').length, 4);
check('case does not matter', findContactRows(campaigns, 'SAM@ACME.COM').length, 4);

// A half-remembered local part, or a whole company's domain, falls back to
// substring - the point of typing three letters and looking.
check('a partial local part', findContactRows(campaigns, 'lee').map(r => r.campaign.title),
  ['September power prices']);
check('a bare domain finds every row on it',
  findContactRows(campaigns, '@acme.com').length, 6);
check('nobody on file', findContactRows(campaigns, 'nobody@nowhere.com'), []);
check('too short to search', findContactRows(campaigns, 's'), []);
check('nothing typed', findContactRows(campaigns, ''), []);
check('no campaigns at all', findContactRows(undefined, 'sam@acme.com'), []);
check('the minimum is what the box enforces', LOOKUP_MIN_CHARS, 2);

// --- what the rows add up to -------------------------------------------
const summary = lookupSummary(sam);
check('campaigns counted distinctly', summary.campaigns, 3);
check('rows counted as rows', summary.rows, 4);
check('sends counted per row', summary.sent, 2);
check('replies counted per row', summary.replies, 1);
check('the address that matched', summary.addresses, ['sam@acme.com']);
check('an empty lookup', lookupSummary([]), { rows: 0, campaigns: 0, sent: 0, replies: 0, addresses: [] });

// A group row counts for the campaign it is on, whichever half was searched.
const group = findContactRows([{ title: 'Site visit', contacts: [{ email: 'a@x.com; b@y.com', sentDate: '2026-09-01' }] }], 'b@y.com');
check('a group row is found by either half', group.length, 1);
check('and reports both addresses', group[0].addresses, ['a@x.com', 'b@y.com']);

// --- what the box offers ------------------------------------------------
const names = { 'sam@acme.com': { name: 'Sam Doe', company: 'Acme' } };
const suggestions = lookupSuggestions(campaigns, e => names[e]);
check('one entry per address', suggestions.map(s => s.email),
  ['jo@other.com', 'lee@acme.com', 'sam@acme.com', 'sam@acme.com.au']);
check('a name is filled in where one is known',
  suggestions.find(s => s.email === 'sam@acme.com').name, 'Sam Doe');
check('an address on three campaigns is counted once',
  suggestions.find(s => s.email === 'sam@acme.com').campaigns, 3);
check('no campaigns, nothing to offer', lookupSuggestions([], () => null), []);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
