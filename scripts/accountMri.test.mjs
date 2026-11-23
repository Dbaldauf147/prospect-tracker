// Assertion tests for the Account MRI intake template export: tab 1
// (Profile & Background), tab 3 (Buying Committee) and tab 5 (Sites &
// Utilities), mapped from the tracker and written into the real template. Plain Node. Run:
//   node scripts/accountMri.test.mjs
import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';
import ExcelJS from 'exceljs';
import {
  MRI_PROFILE_FIELDS, MRI_PROFILE_SHEET_PATH, accountMriProfile, fillProfileSheet,
  fillTableSheet, fillAccountMriWorkbook, buyingCommitteeRows, siteUtilityRows, MRI_COMMITTEE_TABLE, MRI_SITES_TABLE,
  revenueInBillions, mriTier, mriStage, plainMentions, servicesInScope, mainContactText, mriFileName,
} from '../src/utils/accountMri.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}\n        got      ${JSON.stringify(actual)}`); }
}

eq(revenueInBillions('$1.5B'), 1.5, 'billions');
eq(revenueInBillions('850M'), 0.85, 'millions');
eq(revenueInBillions('$4,200,000,000'), 4.2, 'spelled out in dollars');
eq(revenueInBillions('2.3 billion'), 2.3, 'word unit');
eq(revenueInBillions('4.2'), null, 'bare number has no scale');
eq(revenueInBillions(''), null, 'blank');

eq(mriTier('Tier 1'), 'Tier I', 'tier 1');
eq(mriTier('Tier 3'), 'Tier III', 'tier 3');
eq(mriTier('Strategic Target'), 'Not set', 'off the tier list');
eq(mriStage('Client'), 'Customer – Expand', 'client stage');
eq(mriStage('Qualifying'), 'Qualify', 'qualifying stage');
eq(mriStage('Hold Off'), 'Hold Off', 'other statuses go across as they are');

eq(plainMentions('@![Engie] on @[Bill payment]\nand Enel X'), 'Engie on Bill payment; and Enel X', 'mention chips read as names');
eq(servicesInScope({ 'Bill payment': 'Sold', IDM: 'In Progress', 'API/ETL': 'N/A', X: '-', A: 'Sold' }), 'Sold: A, Bill payment. In progress: IDM', 'sold then in progress');
eq(servicesInScope({ IDM: 'Proposal' }), 'In progress: IDM', 'in progress only');
eq(servicesInScope({}), '', 'no services');
eq(
  mainContactText([
    { firstname: 'Jamie', lastname: 'Lee', email: 'jamie@x.example', phone: '555-0100', dans_tags: 'Primary Point of Contact' },
    { firstname: 'Not', lastname: 'Tagged', email: 'n@x.example', dans_tags: 'Decision Maker' },
  ]),
  'Jamie Lee · jamie@x.example · 555-0100',
  'only the tagged contact',
);
eq(mriFileName('A/B: Co?'), 'Account MRI - A B Co.xlsx', 'file name');

const profile = accountMriProfile({
  record: {
    company: 'Northwind & Sons <Data>', vertical: 'Cloud', cdm: 'Alex Morgan', status: 'Client', hqRegion: 'North America',
    revenue: '$4.2B', numberOfSites: '1,038', notes: 'Line one\nLine two', competitorsNotes: '@![Engie]',
    competitorConsultants: [{ firm: 'Enel X' }, { firm: 'engie' }],
    servicesExplored: { 'Bill payment': 'Sold' },
  },
  tier: 'Tier 2',
  contacts: [{ firstname: 'Jamie', lastname: 'Lee', dans_tags: 'Primary Point of Contact' }],
  contracts: { recurring: 450000.4, setup: 60000, soonestEnd: new Date(2027, 2, 31) },
});
eq(profile.tier, 'Tier II', 'profile tier');
eq(profile.existingClient, 'Yes', 'profile client');
eq(profile.sites, 1038, 'profile sites');
eq(profile.competitors, 'Engie; Enel X', 'competitors, firm not repeated');
eq(profile.fee, '$450,000 / yr', 'fee');
eq(profile.setup, '$60,000 one-time', 'setup');
eq(profile.ubm, 'Sold', 'ubm');
eq(profile.contractTerm, 'Expires Mar 31, 2027', 'contract term');
eq(accountMriProfile({ record: { company: 'X' } }).existingClient, '', 'no status, no client answer');
eq(accountMriProfile({ record: { company: 'X', status: 'Qualifying' } }).existingClient, 'No', 'not a client');

// Every mapped key is one the profile produces.
eq(MRI_PROFILE_FIELDS.filter(f => f.source && !(f.key in profile)).map(f => f.key), [], 'every mapped row has a value');

// The real template, filled and read back.
const buf = await readFile(new URL('../src/assets/account-mri-intake-template.xlsx', import.meta.url));
const zip = await JSZip.loadAsync(buf);
const before = await zip.file(MRI_PROFILE_SHEET_PATH).async('string');
const { xml, written } = fillProfileSheet(before, profile);
eq(written.length, MRI_PROFILE_FIELDS.filter(f => f.source).length, 'every mapped cell written');
eq(xml.includes('x14:dataValidations count="3"'), true, 'dropdowns kept');
zip.file(MRI_PROFILE_SHEET_PATH, xml);
const out = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
const wb = new ExcelJS.Workbook();
await wb.xlsx.load(out);
eq(wb.worksheets.map(w => w.name), ['1 Profile & Background', '2 Diagnosis', '3 Buying Committee', '4 Opportunity', '5 Sites & Utilities', '6 Deal Health', '7 Close Plan', 'Lists'], 'all tabs still there');
const ws = wb.worksheets[0];
const cell = ref => ws.getCell(ref).value;
eq(cell('C5'), 'Northwind & Sons <Data>', 'C5 account name, escaped');
eq(cell('C7'), 'Alex Morgan', 'C7 salesperson replaces the template value');
eq(cell('C8'), 'Keith McHugh', 'C8 team left as the template has it');
eq(cell('C10'), 'Tier II', 'C10 tier');
eq(cell('C11'), 'Yes', 'C11 existing client');
eq(cell('C15'), 4.2, 'C15 revenue is a number');
eq(cell('C16'), 1038, 'C16 sites is a number');
eq(cell('C23'), 'Line one\nLine two', 'C23 keeps line breaks');
eq(cell('C30'), 'No', 'C30 early out left as the template has it');
eq(cell('C13'), null, 'C13 assigned since left blank');
eq(cell('A5'), 'Account name', 'labels untouched');
eq(cell('B5'), 'Company', 'column B untouched');
eq(ws.getCell('C5').style.fill?.fgColor?.argb, ws.getCell('C21').style.fill?.fgColor?.argb, 'filled cell keeps the entry style');

// A blank profile leaves the sheet exactly as it was.
eq(fillProfileSheet(before, {}).xml === before, true, 'nothing to write, nothing changed');
let threw = '';
try { fillProfileSheet('<sheetData/>', { accountName: 'X' }); } catch (e) { threw = e.message; }
eq(threw, 'The Account MRI template has no cell C5.', 'a different layout is refused');

// Tab 3: decision makers.
const committee = buyingCommitteeRows([
  { firstname: 'Zed', lastname: 'Young', jobtitle: 'CFO', email: 'zed@x.example', mobilephone: '555-0102' },
  { firstname: 'Amy', lastname: 'Adams', jobtitle: 'VP Energy', email: 'amy@x.example', phone: '555-0101' },
  { email: 'noname@x.example' },
  {},
]);
eq(committee.map(c => c.name), ['Amy Adams', 'noname@x.example', 'Zed Young'], 'committee A to Z, nameless contact by email, empty dropped');
eq(committee[2], { name: 'Zed Young', title: 'CFO', email: 'zed@x.example', phone: '555-0102' }, 'committee row');

// Tab 5: the saved site list.
const analysisList = {
  headers: ['Site Name', 'City', 'ST / Prov', 'Country', 'Property Type', 'Site Status', 'Annual Electric (kWh)', 'Electric Rate ($/kWh)', 'Annual Gas (Dth)', 'Total Electric Cost'],
  rows: [
    { 'Site Name': 'Ashburn 1', City: 'Ashburn', 'ST / Prov': 'VA', Country: 'USA', 'Property Type': 'Data Center', 'Site Status': 'Active', 'Annual Electric (kWh)': 182000, 'Electric Rate ($/kWh)': 0.09, 'Annual Gas (Dth)': '4,100', 'Total Electric Cost': 16380 },
    { 'Site Name': 'Closed Store', City: 'Reno', 'ST / Prov': 'NV', Country: 'USA', 'Site Status': 'Closed' },
    { 'Site Name': '', City: 'Austin', 'ST / Prov': 'TX', Country: 'USA', 'Site Status': '' },
  ],
};
const siteRows = siteUtilityRows(analysisList);
eq(siteRows.length, 2, 'closed site left out');
eq(siteRows[0], { name: 'Ashburn 1', country: 'USA', location: 'Ashburn, VA', function: 'Data Center', elec: 182000, elecUnits: 'kWh', fuel: 4100, fuelUnits: 'Dth' }, 'analysis columns read, units from the header');
eq(siteRows[1], { name: 'Austin, TX', country: 'USA', location: 'Austin, TX', function: '', elec: null, elecUnits: '', fuel: null, fuelUnits: '' }, 'unnamed site named by its location, no consumption');
eq(
  siteUtilityRows({ headers: ['Facility', 'Address', 'State', 'Electric Usage', 'Electric UoM', 'Gas Usage', 'Gas Units'], rows: [{ Facility: 'Plant A', State: 'OH', 'Electric Usage': '1,200', 'Electric UoM': 'MWh', 'Gas Usage': 50, 'Gas Units': 'mmbtu' }] })[0],
  { name: 'Plant A', country: '', location: 'OH', function: '', elec: 1200, elecUnits: 'MWh', fuel: 50, fuelUnits: 'MMBtu' },
  'uploaded sheet, units from the units columns',
);
eq(siteUtilityRows(null), [], 'no list');

// The whole workbook, with lists longer than the template's entry rows.
const many = (n, make) => Array.from({ length: n }, (_, i) => make(i));
const bigCommittee = many(28, i => ({ name: `Person ${String(i).padStart(2, '0')}`, title: 'Director', email: `p${i}@x.example`, phone: '' }));
const bigSites = many(205, i => ({ name: `Site ${i}`, country: 'USA', location: 'Austin, TX', function: 'Office', elec: 1000, elecUnits: 'kWh', fuel: i === 0 ? null : 10, fuelUnits: i === 0 ? '' : 'Dth' }));
const zip2 = await JSZip.loadAsync(buf);
const result = await fillAccountMriWorkbook(zip2, { profile, committee: bigCommittee, sites: bigSites });
eq(result, { profileCells: 18, committeeRows: 28, siteRows: 205 }, 'workbook fill result');
const sheet3 = await zip2.file(MRI_COMMITTEE_TABLE.path).async('string');
eq(sheet3.includes('<xm:sqref>E6:E33</xm:sqref>'), true, 'dropdowns stretched over the added rows');
const sheet5 = await zip2.file(MRI_SITES_TABLE.path).async('string');
eq(sheet5.includes('<f>SUM(E3:E207)</f>') && sheet5.includes('<f>COUNTA(A3:A207)</f>'), true, 'totals stretched over the added rows');
eq((await zip2.file('xl/workbook.xml').async('string')).includes('fullCalcOnLoad="1"'), true, 'recalculates on open');
const wb2 = new ExcelJS.Workbook();
await wb2.xlsx.load(await zip2.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
const t3 = wb2.worksheets[2];
const t5 = wb2.worksheets[4];
eq(t3.getCell('A5').value, 'Jamie Lee', 'tab 3 example row kept');
eq([t3.getCell('A6').value, t3.getCell('B6').value, t3.getCell('C6').value], ['Person 00', 'Director', 'p0@x.example'], 'tab 3 first decision maker');
eq(t3.getCell('A33').value, 'Person 27', 'tab 3 last decision maker, on an added row');
eq(t3.getCell('A33').style.border?.top?.style, t3.getCell('A30').style.border?.top?.style, 'added row styled like the entry rows');
eq([t3.getCell('A35').value, t3.getCell('A36').value, t3.getCell('A37').value], ['Our pursuit team', 'Name', 'Alex Morgan'], 'pursuit team moved down intact');
eq(t5.getCell('A2').value.startsWith('Ashburn Campus 1'), true, 'tab 5 example row kept');
eq([t5.getCell('A3').value, t5.getCell('C3').value, t5.getCell('E3').value, t5.getCell('F3').value, t5.getCell('G3').value], ['Site 0', 'Austin, TX', 1000, 'kWh', null], 'tab 5 first site');
eq([t5.getCell('A207').value, t5.getCell('G207').value, t5.getCell('H207').value], ['Site 204', 10, 'Dth'], 'tab 5 last site, on an added row');
eq(t5.getCell('K4').value.formula, 'SUM(E3:E207)', 'tab 5 total formula');
eq([t5.getCell('K4').value.result, t5.getCell('K5').value.result, t5.getCell('K6').value.result], [205000, 2040, 205], 'tab 5 totals stored with the file');

// Lists that fit change no layout; empty lists change nothing.
const fit = fillTableSheet(await zip.file(MRI_COMMITTEE_TABLE.path).async('string'), MRI_COMMITTEE_TABLE, bigCommittee.slice(0, 25));
eq([fit.written, fit.added, fit.xml.includes('<xm:sqref>E6:E30</xm:sqref>')], [25, 0, true], 'a full committee fits without adding rows');
const s3 = await zip.file(MRI_COMMITTEE_TABLE.path).async('string');
eq(fillTableSheet(s3, MRI_COMMITTEE_TABLE, []).xml === s3, true, 'no decision makers, tab untouched');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
