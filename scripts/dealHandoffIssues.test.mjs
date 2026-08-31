// Assertion tests for which deals the Issues page flags as having
// outstanding handoff items. Plain Node — no test framework (the project
// has none). Run:
//   node scripts/dealHandoffIssues.test.mjs
//
// Two surfaces share this definition: the Deals subtab's X/N Progress pill
// and the Issues page's "Handoff items outstanding" row. They have to
// agree — a pill that reads 9/9 must not be nagged about on Issues, and a
// deal the user ticked "Ignore this deal" on has to drop off both. The
// two directions fail differently: flag a finished deal and the Issues
// page cries wolf; miss an unfinished one and an invoice handoff quietly
// stalls.
import {
  HANDOFF_FIELDS, handoffProgress, incompleteHandoffDeals, isHandoffFieldDone,
} from '../src/utils/dealHandoff.js';
import { DEAL_IGNORED_KEY } from '../src/utils/postSaleFollowUp.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}

// A deal with every handoff field filled in — nothing outstanding.
function complete(over = {}) {
  const row = {
    'Client Name': 'EOS Hospitality',
    'Agreement Name': 'Strategic sourcing',
    'Original Contract Start': '2026-01-05',
  };
  for (const f of HANDOFF_FIELDS) row[f.key] = f.yesno ? 'Yes' : 'done';
  return { ...row, ...over };
}
const names = (rows) => rows.map(r => r.deal['Agreement Name']);
// Totals are read off the checklist rather than hard-coded, so adding a
// field to it doesn't fail these on arithmetic; what the assertions pin is
// the behaviour — a full checklist is clear, one gap is one short.
const TOTAL = HANDOFF_FIELDS.length;
const missingLabels = (row) => handoffProgress(row).missing.map(f => f.label);

{
  // The rule the user asked for: a non-ignored deal short of the full
  // checklist is flagged; a finished one isn't.
  const done = complete({ 'Agreement Name': 'Finished' });
  const short = complete({ 'Agreement Name': 'Short', Setup: '' });
  eq(names(incompleteHandoffDeals([done, short])), ['Short'], 'only the deal with an outstanding item is flagged');
  eq(handoffProgress(done), { done: TOTAL, total: TOTAL, missing: [] }, `a full checklist reads ${TOTAL}/${TOTAL}`);
  eq(handoffProgress(short).done, TOTAL - 1, `and one empty field drops it to ${TOTAL - 1}/${TOTAL}`);
  eq(missingLabels(short), ['Setup'], 'the outstanding item is named');
}

{
  // Original Contract Start is a checklist item, not just a grid column:
  // a deal with no start date is an unfinished handoff, and the popover
  // edits the same field the column does.
  const field = HANDOFF_FIELDS.find(f => f.key === 'Original Contract Start');
  eq(!!field, true, 'Original Contract Start is on the checklist');
  eq(field.date === true, true, 'and is marked as a date, so the popover picks it from a calendar');
  const noStart = complete({ 'Agreement Name': 'No start', 'Original Contract Start': '' });
  eq(missingLabels(noStart), ['Original Contract Start'], 'a deal with no start date is one short');
  eq(names(incompleteHandoffDeals([noStart])), ['No start'], 'and the Issues page flags it');
  const dashStart = complete({ 'Agreement Name': 'Dash', 'Original Contract Start': '-' });
  eq(missingLabels(dashStart), ['Original Contract Start'], 'a dash placeholder does not count as a date');
}

{
  // Ignoring a deal on the Deals subtab greys out its pill there and
  // means the same thing here — it stops being chased on Issues.
  const ignored = complete({ 'Agreement Name': 'Ignored', Setup: '', [DEAL_IGNORED_KEY]: '1' });
  eq(names(incompleteHandoffDeals([ignored])), [], 'an ignored deal is not flagged');
  eq(names(incompleteHandoffDeals([{ ...ignored, [DEAL_IGNORED_KEY]: '' }])), ['Ignored'], 'un-ignoring brings it back');
  eq(names(incompleteHandoffDeals([{ ...ignored, [DEAL_IGNORED_KEY]: '-' }])), ['Ignored'], 'a dash is a blank cell, not an ignore');
}

{
  // Uploaded workbooks spell "blank" with dashes, so a dash must not
  // count as a completed step (it would inflate the pill on both tabs).
  eq(missingLabels(complete({ Commission: '-' })), ['Commission'], 'a dash is not a completed field');
  eq(missingLabels(complete({ Commission: '—' })), ['Commission'], 'an em dash either');
  eq(missingLabels(complete({ Commission: '   ' })), ['Commission'], 'nor is whitespace');
  eq(missingLabels(complete({ Commission: '0' })), [], 'but a real value counts, including a zero');
}

{
  // The Yes/No field only completes on an explicit Yes — a "No" is a real
  // answer but still an outstanding handoff step.
  const yesno = HANDOFF_FIELDS.find(f => f.yesno);
  eq(isHandoffFieldDone({ [yesno.key]: 'Yes' }, yesno), true, 'Yes completes the yes/no field');
  eq(isHandoffFieldDone({ [yesno.key]: 'yes' }, yesno), true, 'case does not matter');
  eq(isHandoffFieldDone({ [yesno.key]: 'No' }, yesno), false, 'No leaves it outstanding');
  eq(isHandoffFieldDone({ [yesno.key]: 'Maybe' }, yesno), false, 'and so does any other answer');
}

{
  // Blank spacer rows in the workbook have no client and no agreement:
  // nothing to chase, so they must not each raise an empty issue.
  const spacer = { 'Client Name': '', 'Agreement Name': '' };
  eq(incompleteHandoffDeals([spacer]).length, 0, 'blank spacer rows are skipped');
  eq(incompleteHandoffDeals([]).length, 0, 'an empty deals list raises nothing');
  eq(incompleteHandoffDeals(null).length, 0, 'and neither does no list at all');
}

{
  // A row with a client but no filled fields at all is the 0/N case —
  // the red pill on the Deals subtab.
  const bare = { 'Client Name': 'Acme', 'Agreement Name': '' };
  const p = handoffProgress(bare);
  eq([p.done, p.total], [0, TOTAL], `a bare row is 0/${TOTAL}`);
  eq(names(incompleteHandoffDeals([bare])), [''], 'and it is flagged even without an agreement name');
}

{
  // Most-outstanding first, so the worst-off deals lead regardless of the
  // order they were uploaded in.
  const rows = incompleteHandoffDeals([
    complete({ 'Agreement Name': 'one missing', Setup: '' }),
    complete({ 'Agreement Name': 'three missing', Setup: '', Commission: '', 'Closed Won': '' }),
    complete({ 'Agreement Name': 'two missing', Setup: '', Commission: '' }),
  ]);
  eq(names(rows), ['three missing', 'two missing', 'one missing'], 'sorted most outstanding first');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
