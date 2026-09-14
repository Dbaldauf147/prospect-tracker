// Assertion tests for Site Status on the Utility Lookup page — the per-site
// record of what is happening with the building.
// Plain Node — no test framework (the project has none). Run:
//   node scripts/siteStatus.test.mjs
//
// Two things here are easy to get quietly wrong.
//
// The first is the column detection. A sites file is full of columns that
// say "status" and mean something else — contract status, compliance
// status, survey status — and binding the site's status to whichever came
// first in the sheet mislabels every row on the page without erroring once.
//
// The second is what happens to a value nothing recognises. The vocabulary
// is the user's to rewrite, so "recognised" moves; a status that got dropped
// or blanked because it wasn't on today's list would be the user's own data
// deleted to tidy a column.
import {
  SITE_STATUS_OPTIONS, SITE_STATUS_HEADER,
  pickSiteStatusColumn, normalizeSiteStatus, siteStatusCounts,
  isActiveSiteStatus, activeSites, activeSiteCount, inactiveSiteBreakdown, inactiveSiteNote,
} from '../src/utils/siteStatus.js';
import {
  SITE_EDIT_FIELDS, SITE_CELL_EDIT_FIELDS, siteEditableColumns, applySiteColumnEdit, coerceSiteValue,
} from '../src/utils/siteMassEdit.js';
import { getEffectiveDropdownLists } from '../src/utils/dropdownListsStore.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; } else { failed++; console.error(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}
function ok(value, name) { eq(!!value, true, name); }

// ── finding the file's own status column ─────────────────────────────────
{
  eq(pickSiteStatusColumn(['Site Name', 'Site Status', 'Zip']), 'Site Status', 'the exact header wins');
  eq(pickSiteStatusColumn(['Site', 'Status']), 'Status', 'a bare Status is taken when nothing better is there');
  eq(pickSiteStatusColumn(['Location Status']), 'Location Status', 'so are the other words for a site');
  eq(pickSiteStatusColumn(['Operational Status']), 'Operational Status', 'and the operational phrasing');
  eq(pickSiteStatusColumn(['Status', 'Site Status']), 'Site Status', 'the specific header beats the vague one wherever it sits');

  // The whole reason this isn't a /status/ match.
  eq(pickSiteStatusColumn(['Contract Status']), '', 'a contract\'s status is not the site\'s');
  eq(pickSiteStatusColumn(['Ownership Status', 'Tenure Status']), '', 'neither is the tenure column');
  eq(pickSiteStatusColumn(['Compliance Status', 'Audit Status', 'Data Status']), '', 'nor a filing, an audit or a data flag');
  eq(pickSiteStatusColumn(['Contract Status', 'Site Status']), 'Site Status', 'and the real one is still found beside them');
  eq(pickSiteStatusColumn([]), '', 'a file with no headers has no status column');
  eq(pickSiteStatusColumn(['Site Name', 'Zip']), '', 'nor does one that simply has not got one');
}

// ── folding a typed value onto the vocabulary ────────────────────────────
{
  eq(normalizeSiteStatus('open'), 'Open', 'case is forgiven');
  eq(normalizeSiteStatus('  CLOSED  '), 'Closed', 'so is padding');
  eq(normalizeSiteStatus('under-construction'), 'Under construction', 'and punctuation between the words');
  eq(normalizeSiteStatus(''), '', 'blank is blank');
  eq(normalizeSiteStatus(null), '', 'so is nothing at all');

  // The rule that keeps the user's data: an unknown value is kept as typed.
  eq(normalizeSiteStatus('Mothballed'), 'Mothballed', 'a value off the list is kept exactly as it came');
  eq(normalizeSiteStatus('Open', ['Trading', 'Shut']), 'Open',
    'including under a rewritten vocabulary — the old value is still the user\'s');
  eq(normalizeSiteStatus('shut', ['Trading', 'Shut']), 'Shut', 'and the new list is what folding follows');
}

// ── what the portfolio holds ─────────────────────────────────────────────
{
  const counts = siteStatusCounts(['Open', 'open', 'Closed', '', null, 'Mothballed']);
  eq([...counts], [['Open', 2], ['Closed', 1], ['Mothballed', 1], ['', 2]],
    'counted in vocabulary order, then what the file brought, then the sites with no status');
  eq([...siteStatusCounts([])], [], 'nothing loaded, nothing counted');
  eq([...siteStatusCounts(['Open'])], [['Open', 1]], 'a status nothing is at is left out rather than listed as zero');
}

// ── it is a real column of the uploaded rows ─────────────────────────────
//
// Which is what makes it export, re-upload and mass-edit like every other
// column on the page, rather than living in a side table the exports can't
// see.
{
  const field = SITE_EDIT_FIELDS.find(f => f.key === 'siteStatus');
  ok(field, 'the mass editor offers Site Status');
  eq(field.options, SITE_STATUS_OPTIONS, 'as a picklist, not a text box');
  eq(SITE_CELL_EDIT_FIELDS.siteStatus, 'siteStatus', 'and the table cell writes to the same field');

  // The page hands in the header it resolved — the file's own, or its own —
  // so the editor offers the column on a file that never had one.
  const rows = [{ 'Site Name': 'Maple Grove' }, { 'Site Name': 'Oak Ridge' }];
  const headers = [...Object.keys(rows[0]), SITE_STATUS_HEADER];
  const mapping = { siteName: 'Site Name', siteStatus: SITE_STATUS_HEADER };
  const columns = siteEditableColumns(headers, mapping, ['Site Name'], { siteStatus: ['Trading', 'Shut'] });
  const column = columns.find(c => c.header === SITE_STATUS_HEADER);
  ok(column, 'a file with no status column still has a status cell to type into');
  eq(column.label, 'Site Status', 'shown under the page\'s label');
  eq(column.options, ['Trading', 'Shut'], 'offering the vocabulary the user edited, not the shipped one');

  const typed = coerceSiteValue(column, ' Shut ');
  eq(typed, { ok: true, value: 'Shut' }, 'a typed status is text, trimmed');
  const { rows: next, changed } = applySiteColumnEdit(rows, new Set([rows[0]]), column.header, typed.value);
  eq(changed, 1, 'the edit lands on the site it was aimed at');
  eq(next[0][SITE_STATUS_HEADER], 'Shut', 'writing the status into the row itself');
  eq(next[1][SITE_STATUS_HEADER], undefined, 'and nowhere else');
}

// ── the vocabulary is the user's ─────────────────────────────────────────
{
  const list = getEffectiveDropdownLists({}).find(l => l.key === 'siteStatus');
  ok(list, 'Site Status is a list on Dropdowns › Lists');
  eq(list.options, SITE_STATUS_OPTIONS, 'seeded with the shipped vocabulary');
  eq(
    getEffectiveDropdownLists({ dropdownLists: { siteStatus: ['Trading', 'Shut'] } })
      .find(l => l.key === 'siteStatus').options,
    ['Trading', 'Shut'],
    'and rewritten by an edit there, like every other list',
  );
}

// ── which sites the counts count ─────────────────────────────────────────
//
// The company popup and the Master Analysis count active sites, so this is
// the rule behind every site number a reader sees. Two calls in it are
// deliberate and easy to get backwards.
{
  eq(isActiveSiteStatus(''), true, 'no status counts as active');
  eq(isActiveSiteStatus(null), true, 'and so does nothing at all');
  eq(isActiveSiteStatus('Open'), true, 'open is trading');
  eq([isActiveSiteStatus('Closed'), isActiveSiteStatus('Sold')], [false, false], 'closed and sold are not');
  eq([isActiveSiteStatus('Vacant'), isActiveSiteStatus('Under construction')], [false, false],
    'an empty shell and a building site are not trading either');

  // A rewritten vocabulary keeps working: the test is on the opening word.
  eq([isActiveSiteStatus('Operating'), isActiveSiteStatus('Active'), isActiveSiteStatus('Trading'), isActiveSiteStatus('In service')],
    [true, true, true, true], 'the other words for trading are read as trading');
  eq(isActiveSiteStatus('Not operating'), false, 'and the test is anchored, so a negation is not read as one');
  eq(isActiveSiteStatus('Mothballed'), false,
    'a word off the vocabulary is not active: somebody typed it about this site, and it is never good news');

  const rows = [
    { __siteStatus__: null }, { __siteStatus__: 'Open' }, { __siteStatus__: 'open' },
    { __siteStatus__: 'Closed' }, { __siteStatus__: 'Closed' }, { __siteStatus__: 'Sold' },
    { __siteStatus__: 'Mothballed' },
  ];
  eq(activeSiteCount(rows), 3, 'the count is the trading ones plus the ones nobody has said');
  eq(activeSites(rows).length, 3, 'and the list agrees with the count');
  eq(activeSiteCount([]), 0, 'no sites, no count');
  eq([...inactiveSiteBreakdown(rows)], [['Closed', 2], ['Mothballed', 1], ['Sold', 1]],
    'what was left out, commonest first, so a shrunken count can say why');
  eq(inactiveSiteNote(rows), '4 sites not counted: 2 Closed, 1 Mothballed, 1 Sold.', 'as one sentence');
  eq(inactiveSiteNote([{ __siteStatus__: 'Open' }]), '', 'and nothing at all when nothing was left out');
}

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
