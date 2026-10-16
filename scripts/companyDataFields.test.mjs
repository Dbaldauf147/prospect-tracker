// Assertion tests for src/utils/companyDataFields.js, the My Accounts
// Company Data subtab's missing-value check and paste-back. Plain Node. Run:
//   node scripts/companyDataFields.test.mjs
import { hasValue, fieldHasValue, missingFields, fieldNotNeeded, parseCount, mapHeaders, planCompanyDataPaste, COMPANY_DATA_FIELDS } from '../src/utils/companyDataFields.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}

// --- what counts as missing ------------------------------------------------
eq([hasValue(0), hasValue('12'), hasValue(null), hasValue(''), hasValue(undefined), hasValue('abc')], [true, true, false, false, false, false],
  '0 is a value, blank / null / junk are not');
eq(missingFields({ numberOfSites: 10, numberOfAccounts: null, numberOfMeters: 0, zoomCompanyId: '123', website: '  ' }), ['numberOfAccounts', 'equipmentCount', 'annualMwh', 'zoomCompanyName', 'website'],
  'missing fields, in field order; a blank text field is missing');
{
  const idField = COMPANY_DATA_FIELDS.find(f => f.key === 'zoomCompanyId');
  eq([fieldHasValue(idField, 'abc'), fieldHasValue(idField, ' '), fieldHasValue(idField, null)], [true, false, false], 'any text counts for a text field');
}

// --- numbers -----------------------------------------------------------------
eq([parseCount('10,000'), parseCount(' $1,200 '), parseCount('3.5'), parseCount(''), parseCount('-')], [10000, 1200, 3.5, null, null],
  'commas, dollar signs and spaces are stripped; blank and a dash write nothing');
eq([Number.isNaN(parseCount('about 40')), Number.isNaN(parseCount('-5'))], [true, true], 'words and negatives are not numbers');

// --- headers -----------------------------------------------------------------
eq(mapHeaders(['ID', 'Company', 'Sites', 'Utility Accounts', 'Meters', 'Equipment', 'Electric MWh']),
  { company: 1, id: 0, fields: { numberOfSites: 2, numberOfAccounts: 3, numberOfMeters: 4, equipmentCount: 5, annualMwh: 6 } },
  'the export\'s own header row maps back');
eq(mapHeaders(['Company', 'Zoom Company ID', 'Zoom Company Name', 'Company URL']),
  { company: 0, id: -1, fields: { zoomCompanyId: 1, zoomCompanyName: 2, website: 3 } },
  'Zoom Company ID / Name are not taken for the record ID or company columns');
eq(mapHeaders(['Account Name', '# Sites', 'MWh']).fields, { numberOfSites: 1, annualMwh: 2 }, 'common ways of writing a header');

// --- the paste ---------------------------------------------------------------
const records = [
  { id: 'a1', company: 'Acme Corp', numberOfSites: null, numberOfAccounts: 40 },
  { id: 'b2', company: 'Beta Holdings', numberOfSites: 5 },
  { id: 'c3', company: 'Gamma', numberOfMeters: null },
];
{
  const text = [
    'ID\tCompany\tSites\tUtility Accounts\tMeters',
    'a1\tAcme Corp\t1,200\t40\t',
    '\tbeta  holdings\t7\t30\t',
    '\tGamma\tlots\t\t15',
    '\tNobody Inc\t3\t\t',
  ].join('\n');
  const plan = planCompanyDataPaste(text, records);
  eq(plan.updates.map(u => [u.id, u.patch]), [
    ['a1', { numberOfSites: 1200 }],
    ['b2', { numberOfAccounts: 30 }],
    ['c3', { numberOfMeters: 15 }],
  ], 'fills blanks; a value equal to the record writes nothing; name match ignores case and spacing');
  eq(plan.skipped.map(s => [s.company, s.key, s.from, s.to]), [['Beta Holdings', 'numberOfSites', 5, 7]],
    'a number the company already has is not replaced by default, and is reported');
  eq(plan.invalid, [{ company: 'Gamma', label: 'Sites', value: 'lots' }], 'a cell that is not a number is reported, not written');
  eq(plan.unmatched, ['Nobody Inc'], 'a row with no company record is reported');

  const over = planCompanyDataPaste(text, records, { overwrite: true });
  eq(over.updates.find(u => u.id === 'b2').patch, { numberOfSites: 7, numberOfAccounts: 30 }, 'with overwrite on, the existing number is replaced');
  eq(over.skipped, [], 'and nothing is skipped');
}
eq(planCompanyDataPaste('a1\t5', records).error !== '', true, 'one line is not a paste with a header');
eq(planCompanyDataPaste('Company\tNotes\nAcme Corp\thi', records).error.startsWith('No data columns'), true, 'a header with no data column says so');
eq(planCompanyDataPaste('Sites\tMeters\n4\t5', records).error, 'No Company column found in the header row.', 'no company or id column says so');
eq(planCompanyDataPaste('ID\tSites\nc3\t9', records).updates.map(u => [u.id, u.patch]), [['c3', { numberOfSites: 9 }]], 'the ID column alone is enough');

{
  const recs = [
    { id: 'a1', company: 'Acme Corp', zoomCompanyId: '', website: 'acme.com' },
    { id: 'b2', company: 'Beta Holdings', zoomCompanyName: 'Beta Holdings LLC' },
  ];
  const text = [
    'Company\tZoom Company ID\tZoom Company Name\tCompany URL',
    'Acme Corp\t 104567 \tAcme Corporation\twww.acme.com',
    'Beta Holdings\t-\tBeta Holdings LLC\tbeta.com',
  ].join('\n');
  const plan = planCompanyDataPaste(text, recs);
  eq(plan.updates.map(u => [u.id, u.patch]), [
    ['a1', { zoomCompanyId: '104567', zoomCompanyName: 'Acme Corporation' }],
    ['b2', { website: 'beta.com' }],
  ], 'text cells are trimmed and written as text; a dash or an equal value writes nothing');
  eq(plan.skipped.map(s => [s.company, s.key, s.from, s.to]), [['Acme Corp', 'website', 'acme.com', 'www.acme.com']],
    'existing text is not replaced by default');
  eq(plan.invalid, [], 'text is never "not a number"');
}

{
  const rec = { numberOfSites: 3, numberOfAccounts: 4, numberOfMeters: 5, equipmentCount: 6, annualMwh: 7, website: 'x.com' };
  eq(missingFields(rec), ['zoomCompanyId', 'zoomCompanyName'], 'blank Zoom fields are missing by default');
  eq(missingFields(rec, COMPANY_DATA_FIELDS, { zoomExcluded: true }), [], 'not when the company is excluded from ZoomInfo');
  eq(missingFields({ ...rec, website: '' }, COMPANY_DATA_FIELDS, { zoomExcluded: true }), ['website'], 'other fields still count when excluded');
  eq(fieldNotNeeded(COMPANY_DATA_FIELDS.find(f => f.key === 'numberOfSites'), { zoomExcluded: true }), false, 'only the Zoom fields are waived');
  eq(missingFields(rec, COMPANY_DATA_FIELDS, { allDms: true }), ['zoomCompanyName'], 'a decision maker on every tag waives the Zoom id only');
  eq(missingFields({ ...rec, numberOfSites: null }, COMPANY_DATA_FIELDS, { allDms: true }), ['numberOfSites', 'zoomCompanyName'], 'other fields still count with every DM');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
