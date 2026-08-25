// Assertion tests for which deals still owe a post-sale follow-up.
// Plain Node — no test framework (the project has none). Run:
//   node scripts/postSaleIgnoredDeals.test.mjs
//
// Four surfaces read postSaleFollowUpRows: the Pipeline dashboard's
// Post-Sale Follow-Up table, that table's Excel export, the Clients tab's
// Post-Sale Follow-Up subtab, and the Issues tab's overdue detector. They
// share the one definition precisely so a deal can't be owed on one and
// settled on another — which is what makes this function worth pinning:
// a wrong answer here is wrong in four places, and the two directions fail
// differently. Drop a deal that is still owed and the follow-up is never
// chased; keep one the user has ignored and the Issues page nags about a
// deal they already decided to leave.
import { postSaleFollowUpRows, isIgnoredDeal, DEAL_IGNORED_KEY } from '../src/utils/postSaleFollowUp.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}

const deal = (over = {}) => ({
  'Client Name': 'EOS Hospitality',
  'Agreement Name': 'Strategic sourcing',
  'Original Contract Start': '2026-01-05',
  'Follow Up On Sale': '',
  ...over,
});
const names = (rows) => rows.map(r => r['Agreement Name']);

{
  // The rule the user asked for: ignoring a deal on the Deals subtab is
  // them saying they're done with it, and it stops being owed everywhere.
  const owed = deal({ 'Agreement Name': 'Owed' });
  const ignored = deal({ 'Agreement Name': 'Ignored', [DEAL_IGNORED_KEY]: '1' });
  eq(names(postSaleFollowUpRows([owed, ignored])), ['Owed'], 'an ignored deal is not owed a post-sale follow-up');
}

{
  // Un-ignoring brings it back: the flag is cleared to '' rather than
  // deleted, so an empty value must not read as still ignored.
  eq(names(postSaleFollowUpRows([deal({ [DEAL_IGNORED_KEY]: '' })])), ['Strategic sourcing'], 'clearing the flag puts the deal back on the list');
  eq(names(postSaleFollowUpRows([deal({ [DEAL_IGNORED_KEY]: undefined })])), ['Strategic sourcing'], 'and so does never having set it');
}

{
  // Uploaded workbooks spell "blank" with dashes; those are not a flag.
  eq(isIgnoredDeal({ [DEAL_IGNORED_KEY]: '-' }), false, 'a dash is a blank cell, not an ignore');
  eq(isIgnoredDeal({ [DEAL_IGNORED_KEY]: '—' }), false, 'an em dash too');
  eq(isIgnoredDeal({ [DEAL_IGNORED_KEY]: '1' }), true, 'the flag DealsView writes reads as ignored');
  eq(isIgnoredDeal({}), false, 'a row without the key is not ignored');
  eq(isIgnoredDeal(null), false, 'and neither is no row at all');
}

{
  // The pre-existing rules still hold — this change must not widen or
  // narrow what counts as owed beyond the ignore flag.
  eq(names(postSaleFollowUpRows([deal({ 'Follow Up On Sale': '2026-02-01' })])), [], 'a deal with a follow-up date is settled');
  eq(names(postSaleFollowUpRows([deal({ 'Follow Up On Sale': 'N/A' })])), [], 'a deliberate N/A is settled');
  eq(names(postSaleFollowUpRows([deal({ 'Follow Up On Sale': '#N/A' })])), ['Strategic sourcing'], "but Excel's #N/A error still reads as missing");
  eq(names(postSaleFollowUpRows([deal({ 'Client Name': '', 'Agreement Name': '' })])), [], 'blank spacer rows are skipped');
}

{
  // Oldest sold first — the most overdue lead. Undated rows sink.
  const rows = postSaleFollowUpRows([
    deal({ 'Agreement Name': 'undated', 'Original Contract Start': '' }),
    deal({ 'Agreement Name': 'newer', 'Original Contract Start': '2026-06-01' }),
    deal({ 'Agreement Name': 'oldest', 'Original Contract Start': '2025-02-01' }),
  ]);
  eq(names(rows), ['oldest', 'newer', 'undated'], 'oldest sold first, undated last');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
