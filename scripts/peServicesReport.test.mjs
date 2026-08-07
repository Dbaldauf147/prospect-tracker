// Assertion tests for the PE Overview services report. Plain Node — no
// test framework (the project has none). Run:
//   node scripts/peServicesReport.test.mjs
//
// The report is read as an answer to "who has what" across a firm's
// portfolio, so the two things pinned here are the ones a reader can't
// check by eye: that a status resolves the same way the company page
// resolves it (manual override beats the opp-derived stage), and that
// every status lands in the right outcome bucket. A miscounted bucket
// makes a service look covered when it isn't.
import { buildPeServicesReport, sortReportRows } from '../src/utils/peServicesReport.js';
import {
  SERVICE_BUCKETS, bucketExportLabel, exportStatusLabel, serviceBucket, serviceStatusBucket,
} from '../src/utils/serviceStatusColors.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}

const co = (id, company, servicesExplored = {}) => ({ id, company, servicesExplored });

// --- buckets -------------------------------------------------------------
eq(serviceStatusBucket('Sold'), 'sold', 'Sold is its own bucket');
eq(serviceStatusBucket('Not Sold'), 'notSold', 'Not Sold is its own bucket');
eq(serviceStatusBucket('N/A'), 'na', 'N/A is a deliberate answer, not a gap');
eq(serviceStatusBucket('n/a'), 'na', 'N/A matching is case-insensitive');
eq(serviceStatusBucket(''), 'none', 'no status is a gap');
eq(serviceStatusBucket('-'), 'none', 'the auto sentinel is a gap');
eq(serviceStatusBucket('Exploring'), 'inProgress', 'Exploring is in progress');
eq(serviceStatusBucket('Quoting'), 'inProgress', 'so is Quoting');
eq(serviceStatusBucket('Verbal'), 'inProgress', 'and Verbal — not sold until it is Sold');

// --- the grid ------------------------------------------------------------
{
  const companies = [
    co('1', 'Acme', { 'Energy Procurement': 'Sold', 'Sustainability': 'Exploring' }),
    co('2', 'Boreal', { 'Energy Procurement': 'Not Sold' }),
    co('3', 'Crestline', { 'Sustainability': 'N/A' }),
  ];
  const report = buildPeServicesReport({
    companies,
    serviceKeys: ['Energy Procurement', 'Sustainability'],
  });

  eq(report.rows.map(r => r.company), ['Acme', 'Boreal', 'Crestline'], 'rows keep the order given');
  eq(report.rows[0].statuses, { 'Energy Procurement': 'Sold', Sustainability: 'Exploring' },
    'a row carries each picked service status');
  eq(report.rows[0].explored, 2, 'both services count as explored');
  eq(report.rows[0].sold, 1, 'only the sold one counts as sold');
  eq(report.rows[1].explored, 1, 'a company with one gap counts one explored');
  eq(report.rows[1].statuses.Sustainability, '', 'the gap reports as an empty status');
  eq(report.rows[2].explored, 1, 'N/A still counts as explored — it is an answer');

  const [proc, sus] = report.services;
  eq({ sold: proc.sold, notSold: proc.notSold, inProgress: proc.inProgress, na: proc.na, none: proc.none },
    { sold: 1, notSold: 1, inProgress: 0, na: 0, none: 1 }, 'per-service buckets add up');
  eq({ explored: proc.explored, total: proc.total, pct: proc.pct }, { explored: 2, total: 3, pct: 67 },
    'coverage is explored over every company in the report');
  eq({ inProgress: sus.inProgress, na: sus.na, none: sus.none }, { inProgress: 1, na: 1, none: 1 },
    'the second service buckets independently');

  eq(report.totals, {
    companies: 3, services: 2, cells: 6, explored: 4, sold: 1, pct: 67, untouched: 0,
  }, 'the totals roll up the whole grid');
}

// --- manual status vs the status implied by an opp -----------------------
{
  const acme = co('1', 'Acme', { 'Energy Procurement': 'Not Sold' });
  const boreal = co('2', 'Boreal');
  // What buildOppStagesByClient produces: prospect -> service -> opp stage.
  const oppStages = new Map([
    [acme, new Map([['Energy Procurement', 'Quoting']])],
    [boreal, new Map([['Energy Procurement', 'Quoting']])],
  ]);
  const report = buildPeServicesReport({
    companies: [acme, boreal],
    serviceKeys: ['Energy Procurement'],
    oppStagesByClient: oppStages,
  });
  eq(report.rows[0].statuses['Energy Procurement'], 'Not Sold',
    'a manual status wins over the stage of an opp naming the service');
  eq(report.rows[1].statuses['Energy Procurement'], 'Quoting',
    'with no manual status the opp-derived stage is reported');
  eq(report.services[0].explored, 2, 'an opp-derived status still counts as explored');
}

// --- untouched companies -------------------------------------------------
{
  const report = buildPeServicesReport({
    companies: [co('1', 'Acme'), co('2', 'Boreal', { Sustainability: 'Sold' })],
    serviceKeys: ['Sustainability'],
  });
  eq(report.totals.untouched, 1, 'a company with nothing explored is counted');
  eq(report.rows[0].complete, false, 'and is not complete');
  eq(report.rows[1].complete, true, 'a company with every service answered is');
}

// --- renames -------------------------------------------------------------
{
  const report = buildPeServicesReport({
    companies: [co('1', 'Acme')],
    serviceKeys: ['Energy Procurement'],
    labelOf: new Map([['Energy Procurement', 'Power Buying']]),
  });
  eq(report.services[0].label, 'Power Buying', 'a renamed service reports under its display name');
  eq(report.services[0].key, 'Energy Procurement', 'but keeps its canonical key');
}

// --- empty selections ----------------------------------------------------
{
  const report = buildPeServicesReport({ companies: [co('1', 'Acme')], serviceKeys: [] });
  eq(report.services, [], 'no services picked means no service columns');
  eq(report.totals.pct, 0, 'and no division by zero');
  eq(report.rows[0].complete, false, 'a company is not "complete" against nothing');
}
eq(buildPeServicesReport({}).totals.companies, 0, 'no companies is not a crash');

// --- sorting -------------------------------------------------------------
{
  const rows = [
    { company: 'Crestline', explored: 1, sold: 0 },
    { company: 'Acme', explored: 3, sold: 2 },
    { company: 'Boreal', explored: 1, sold: 1 },
  ];
  eq(sortReportRows(rows, 'company').map(r => r.company), ['Acme', 'Boreal', 'Crestline'],
    'the default is company name');
  eq(sortReportRows(rows, 'leastExplored').map(r => r.company), ['Boreal', 'Crestline', 'Acme'],
    'biggest gaps first, ties by name');
  eq(sortReportRows(rows, 'mostExplored').map(r => r.company), ['Acme', 'Boreal', 'Crestline'],
    'most explored first');
  eq(sortReportRows(rows, 'mostSold').map(r => r.company), ['Acme', 'Boreal', 'Crestline'],
    'most sold first');
  eq(rows.map(r => r.company), ['Crestline', 'Acme', 'Boreal'], 'sorting does not mutate the input');
}

// --- how the Excel export words and colours a status ---------------------
eq(exportStatusLabel('Sold'), 'Existing service', 'a sold service reads as what the company already has');
eq(exportStatusLabel(''), 'Not explored', 'an unexplored one says so rather than sitting blank');
eq(exportStatusLabel('-'), 'Not explored', 'and so does the auto sentinel');
eq(exportStatusLabel('Not Sold'), 'Not Sold', 'Not Sold is reported verbatim — it is not "Sold"');
eq(exportStatusLabel('Exploring'), 'Exploring', 'an in-flight status keeps its own wording');
eq(exportStatusLabel('Quoting'), 'Quoting', 'so the sheet still tells Exploring from Quoting');
eq(exportStatusLabel('N/A'), 'N/A', 'N/A is reported verbatim');
eq(bucketExportLabel(serviceBucket('sold')), 'Existing service', 'the sold column is renamed too');
eq(bucketExportLabel(serviceBucket('notSold')), 'Not sold', 'buckets without an export name keep theirs');

{
  const fill = (key) => serviceBucket(key).xlsx.bg;
  eq(fill('sold'), 'FFDCFCE7', 'an existing service is green');
  eq(fill('notSold'), 'FFFEE2E2', 'not sold is red');
  eq(fill('na'), 'FFE2E8F0', 'N/A is grey');
  eq(fill('none'), 'FFFEF9C3', 'not explored is yellow — the work to do, not an empty cell');
  eq(fill('inProgress'), 'FFDBEAFE', 'in flight is blue, so it cannot be mistaken for a gap');

  const fills = SERVICE_BUCKETS.map(b => b.xlsx.bg);
  eq(new Set(fills).size, SERVICE_BUCKETS.length, 'every bucket is a different colour on the sheet');
  eq(SERVICE_BUCKETS.every(b => /^FF[0-9A-F]{6}$/.test(b.xlsx.bg) && /^FF[0-9A-F]{6}$/.test(b.xlsx.color)),
    true, 'and every one is a valid ARGB that exceljs will accept');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
