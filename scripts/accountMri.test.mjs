// Assertion tests for the Account MRI intake template export (tab 1,
// Profile & Background): the tracker-to-template mapping and writing the
// values into the real template. Plain Node. Run:
//   node scripts/accountMri.test.mjs
import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';
import ExcelJS from 'exceljs';
import {
  MRI_PROFILE_FIELDS, MRI_PROFILE_SHEET_PATH, accountMriProfile, fillProfileSheet,
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

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
