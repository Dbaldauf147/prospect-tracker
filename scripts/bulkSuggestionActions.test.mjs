// Assertion tests for "Apply N suggestions" on Bulk Add Contacts. Plain
// Node - no test framework (the project has none). Run:
//   node scripts/bulkSuggestionActions.test.mjs
//
// The button's whole claim is that it does what the ✓ buttons do, all of
// them, and nothing else. So what is worth pinning is where it declines:
//
//   - a suggestion the user dismissed stays dismissed
//   - a field the prospect already answers is not overwritten (Email
//     Domain excepted: it is a list, and a new pattern is added to it)
//   - a company already equal to its suggestion is not "applied" again
//   - a row with no matched prospect has no record to write to
//   - the same prospect field offered by eight contacts at one company is
//     one write, not eight
//
// The count on the button comes from this list, so a rule that drifts from
// the cells shows up as a number nobody can reconcile with the rows.
import {
  companyTextEquals, pendingSuggestionActions, summarizeSuggestionActions, TV_SUGGESTION_FIELDS,
} from '../src/utils/bulkSuggestionActions.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.log(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}

const prospects = {
  p1: { id: 'p1', company: 'Northern Trust', website: '', zoomCompanyId: '', zoomCompanyName: '', emailDomain: '' },
  p2: { id: 'p2', company: 'Aegon', website: 'www.aegon.com', zoomCompanyId: '1427340', zoomCompanyName: 'Aegon USA', emailDomain: 'first.last@aegon.com' },
};

// The reads the page hands in, standing in for the table's own lookups.
function reader({
  suggested = {}, companyDismissed = new Set(), suggestions = {}, dismissed = new Set(),
} = {}) {
  return {
    suggestedCompanyFor: (r) => suggested[r.email] || '',
    companyDismissed: (r) => companyDismissed.has(r.email),
    prospectFor: (r) => prospects[r.prospectId] || null,
    tvStateFor: (r) => {
      const p = prospects[r.prospectId];
      if (!p) return null;
      return { prospect: p, has: {
        website: p.website, zoomCompanyId: p.zoomCompanyId,
        zoomCompanyName: p.zoomCompanyName, emailDomain: p.emailDomain,
      } };
    },
    suggestionFor: (pid, field) => suggestions[`${pid}::${field}`] || null,
    tvDismissed: (pid, field) => dismissed.has(`${pid}::${field}`),
  };
}

const names = (actions) => actions.map(a => (a.kind === 'company'
  ? `company:${a.email}:${a.to}`
  : `${a.prospectId}:${a.field}:${a.value}:${a.source}`));

// --- a plain row with everything on offer --------------------------------
const row1 = { email: 'mia@macerich.com', company: 'Macerich', prospectId: 'p1' };
check(
  'takes the Suggested Company and every empty Table View field',
  names(pendingSuggestionActions([row1], reader({
    suggested: { 'mia@macerich.com': 'Macerich Company' },
    suggestions: {
      'p1::website': { value: 'www.northerntrust.com' },
      'p1::zoomCompanyId': { value: '37094616' },
    },
  }))),
  [
    'company:mia@macerich.com:Macerich Company',
    'p1:website:www.northerntrust.com:suggestion',
    'p1:zoomCompanyId:37094616:suggestion',
    // No suggestion for Zoom Name, so the cell's "Use Company" shortcut is
    // what it offers, and this offers the same.
    'p1:zoomCompanyName:Northern Trust:useCompany',
  ],
);

// --- what it declines ----------------------------------------------------
check(
  'a dismissed Table View suggestion is left alone, Use Company included',
  names(pendingSuggestionActions([row1], reader({
    suggestions: { 'p1::website': { value: 'www.northerntrust.com' } },
    dismissed: new Set(['p1::website', 'p1::zoomCompanyName']),
  }))),
  [],
);
check(
  'a dismissed Suggested Company is left alone',
  names(pendingSuggestionActions([{ ...row1, prospectId: null }], reader({
    suggested: { 'mia@macerich.com': 'Macerich Company' },
    companyDismissed: new Set(['mia@macerich.com']),
  }))),
  [],
);
check(
  'a company that already equals its suggestion is nothing to apply',
  names(pendingSuggestionActions([{ email: 'a@x.com', company: 'Macerich Company' }], reader({
    suggested: { 'a@x.com': 'Macerich Company' },
  }))),
  [],
);

// --- whitespace, which is what made half a batch look like it failed ----
// Table View names carry stray spaces. Applying the suggestion writes the
// name; if "already applied" is judged on the exact characters, the row
// compares its written name against the untrimmed original, decides they
// differ, and keeps offering the same suggestion forever. The batch looked
// like it had half taken.
check('a trailing space is the same company', companyTextEquals('CBRE Investment Management ', 'CBRE Investment Management'), true);
check('and so is a leading one', companyTextEquals(' Nuveen', 'Nuveen'), true);
check('a blank and a missing value agree', companyTextEquals('', null), true);
// Case is a real difference: fixing it is what the ✓ is for.
check('different casing is not the same name', companyTextEquals('cbre', 'CBRE'), false);
check('a different company is a different company', companyTextEquals('Nuveen', 'Nuveen Real Estate'), false);

check(
  'a suggestion already applied, bar the whitespace, is not offered again',
  names(pendingSuggestionActions([{ email: 'a@x.com', company: 'CBRE Investment Management' }], reader({
    suggested: { 'a@x.com': 'CBRE Investment Management ' },
  }))),
  [],
);
check(
  'and the value it writes is the trimmed one',
  pendingSuggestionActions([{ email: 'a@x.com', company: 'CBRE Inc' }], reader({
    suggested: { 'a@x.com': 'CBRE Investment Management ' },
  }))[0].to,
  'CBRE Investment Management',
);
check(
  'a row with no matched prospect offers no record write',
  names(pendingSuggestionActions([{ email: 'b@x.com', company: 'X', prospectId: null }], reader({
    suggestions: { 'p1::website': { value: 'www.northerntrust.com' } },
  }))),
  [],
);

// p2 has every field filled: the cells show those values with no ✓, so
// nothing here may overwrite them - except Email Domain, which is a list.
const row2 = { email: 'alan@aegon.com', company: 'Aegon', prospectId: 'p2' };
check(
  'a filled field is shown, not overwritten',
  names(pendingSuggestionActions([row2], reader({
    suggestions: {
      'p2::website': { value: 'aegon.co.uk' },
      'p2::zoomCompanyName': { value: 'Aegon USA Investment' },
    },
  }))),
  [],
);
check(
  'a new Email Domain pattern is added to the list that is there',
  names(pendingSuggestionActions([row2], reader({
    suggestions: { 'p2::emailDomain': { value: 'f.last@aegonam.com' } },
  }))),
  ['p2:emailDomain:f.last@aegonam.com:suggestion'],
);

// --- one company, eight contacts -----------------------------------------
const crowd = [
  { email: 'a@nt.com', company: 'Northern Trust', prospectId: 'p1' },
  { email: 'b@nt.com', company: 'Northern Trust', prospectId: 'p1' },
  { email: 'c@nt.com', company: 'Northern Trust', prospectId: 'p1' },
];
const crowdActions = pendingSuggestionActions(crowd, reader({
  suggestions: { 'p1::website': { value: 'www.northerntrust.com' } },
}));
check(
  'the same prospect field is one write however many contacts offer it',
  names(crowdActions),
  ['p1:website:www.northerntrust.com:suggestion', 'p1:zoomCompanyName:Northern Trust:useCompany'],
);

// --- the counts the prompt and the button read ---------------------------
const mixed = pendingSuggestionActions([row1, row2], reader({
  suggested: { 'mia@macerich.com': 'Macerich Company' },
  suggestions: {
    'p1::website': { value: 'www.northerntrust.com' },
    'p2::emailDomain': { value: 'f.last@aegonam.com' },
  },
}));
check('the summary counts each half', summarizeSuggestionActions(mixed), {
  total: 4, companies: 1, prospectFields: 3, prospects: 2,
});
check('an empty list summarises to zeroes', summarizeSuggestionActions([]), {
  total: 0, companies: 0, prospectFields: 0, prospects: 0,
});
check('nothing in, nothing out', pendingSuggestionActions([], reader()), []);
check('no reads at all is not a crash', pendingSuggestionActions([row1]), []);

// The columns, in the order the table shows them.
check('the Table View columns it covers', TV_SUGGESTION_FIELDS,
  ['website', 'zoomCompanyId', 'zoomCompanyName', 'emailDomain']);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
