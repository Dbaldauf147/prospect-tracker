// Assertion tests for the Account MRI popup's form: its lists and rows held
// to the real template, its scoring, and what it types reaching the
// template export. Plain Node. Run:
//   node scripts/accountMriForm.test.mjs
import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';
import ExcelJS from 'exceljs';
import { fillAccountMriWorkbook, MRI_PROFILE_FIELDS, MRI_COMMITTEE_TABLE, accountMriProfile } from '../src/utils/accountMri.js';
import {
  MRI_LISTS, MRI_TABS, PROFILE_SECTIONS, BODY_SYSTEMS, OPPORTUNITY_FIELDS, BUY_STATEMENTS, OURS_STATEMENTS, WIN_MATRIX,
  MRI_TABLES, mergeProfile, systemScore, dealHealthScore, committeeRows, addMissingDecisionMakers, tabProgress,
  mriStageProgress,
  mriFormExport, diagnosisSignals, diagnosisNotes, DEFAULT_SIGNALS, dateSerial, mriSlug, formatMoneyInput, formatNumberInput, profileDisplayValue,
  climateCommitmentLevel, disclosureLevel, trackerSignals, mergeSignals, withTrackerSignals, climateTargetSummary, trackerNotes, disclosureFrameworkList, energyShareNote,
  profileRecordPatch,
  footprintLevel, spreadLevel,
  footprintFromServices, trackerFootprint, mergeFootprint,
  trackerSignalReasons, signalReason,
  withOpportunityDefault, setNoActiveOpportunity, NO_ACTIVE_OPPORTUNITY, revenueBillionsText,
} from '../src/utils/accountMriForm.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}\n        got      ${JSON.stringify(actual)}`); }
}

const templateBytes = await readFile(new URL('../src/assets/account-mri-intake-template.xlsx', import.meta.url));
const template = new ExcelJS.Workbook();
await template.xlsx.load(templateBytes);
const tab = n => template.worksheets[n - 1];
const textOf = (cell) => {
  const v = cell.value;
  return v && typeof v === 'object' && v.richText ? v.richText.map(t => t.text).join('') : v;
};

// The lists are the template's Lists tab, column for column.
const lists = template.getWorksheet('Lists');
const column = (letter) => {
  const out = [];
  for (let r = 2; r <= 11; r++) { const v = lists.getCell(`${letter}${r}`).value; if (v != null && v !== '') out.push(v); }
  return out;
};
const LIST_COLUMNS = { tier: 'A', yesNo: 'B', stage: 'C', stageCap: 'D', yesNoTbd: 'E', level: 'F', footprint: 'G', bodySystem: 'H', buyingRole: 'I', support: 'J', decisionRole: 'K', relationship: 'L', agree: 'M', advantage: 'N' };
eq(Object.keys(MRI_LISTS).sort(), Object.keys(LIST_COLUMNS).sort(), 'one list per Lists column');
for (const [name, letter] of Object.entries(LIST_COLUMNS)) eq(MRI_LISTS[name], column(letter), `list ${name} matches Lists!${letter}`);

// Tab 2's rows.
eq(BODY_SYSTEMS.map(s => s.name), MRI_LISTS.bodySystem, 'seven body systems, in list order');
eq(BODY_SYSTEMS.flatMap(s => s.signs.map(x => [tab(2).getCell(`A${x.row}`).value, tab(2).getCell(`C${x.row}`).value])),
  BODY_SYSTEMS.flatMap(s => s.signs.map(x => [s.name, x.label])), 'every vital sign sits on its template row');
eq(BODY_SYSTEMS.map(s => [tab(2).getCell(`A${s.summaryRow}`).value, tab(2).getCell(`B${s.summaryRow}`).value]), BODY_SYSTEMS.map(s => [s.name, s.focus]), 'summary rows');

// Tab 4 and tab 6 rows are where the template has those questions. The
// form's wording swaps the template's long dashes and ellipses for plain ones.
const plain = s => String(s).replace(/\s*[—:]\s*/g, ' ').replace(/…|\.\.\./g, '').replace(/\s+/g, ' ').trim();
eq(OPPORTUNITY_FIELDS.map(f => plain(f.label)), OPPORTUNITY_FIELDS.map(f => plain(textOf(tab(4).getCell(`A${f.row}`)))), 'opportunity fields sit on their template rows');
eq(OPPORTUNITY_FIELDS.length, new Set(OPPORTUNITY_FIELDS.map(f => f.key)).size, 'opportunity keys are distinct');
eq([...BUY_STATEMENTS, ...OURS_STATEMENTS].map(s => plain(s.label)), [...BUY_STATEMENTS, ...OURS_STATEMENTS].map(s => plain(tab(6).getCell(`B${s.row}`).value)), 'deal health statements sit on their template rows');
eq([...BUY_STATEMENTS, ...OURS_STATEMENTS].map(s => s.meaning), [...BUY_STATEMENTS, ...OURS_STATEMENTS].map(s => tab(6).getCell(`C${s.row}`).value), 'and carry its meanings');
eq(['HIGH', 'MED', 'LOW'].map(l => WIN_MATRIX[l]), [22, 23, 24].map(r => ['C', 'D', 'E'].map(c => tab(6).getCell(`${c}${r}`).value)), 'win matrix is the template\'s');

// The list tables: each header row is the template's.
const sheetOf = { 3: 3, 4: 4, 6: 6, 7: 7 };
for (const [name, def] of Object.entries(MRI_TABLES)) {
  const n = sheetOf[Number(def.path.match(/sheet(\d)/)[1])];
  const header = def.startRow - 2;
  eq(def.columns.map(c => plain(c.label).replace(/^\d+\. /, '')), def.columns.map(c => plain(textOf(tab(n).getCell(`${c.col}${header}`))).replace(/^\d+\. /, '')), `table ${name} columns match its header row`);
}
eq(MRI_TABLES.committee.columns.map(c => [c.col, c.key]), MRI_COMMITTEE_TABLE.columns.map(c => [c.col, c.key]), 'committee columns are the export\'s');
eq(MRI_TABS.length, 7, 'seven tabs');
eq(PROFILE_SECTIONS.flatMap(s => s.fields.map(f => f.key)), MRI_PROFILE_FIELDS.map(f => f.key), 'tab 1 shows every profile row once');

// Tab 1: typed over tracker.
const tracker = { accountName: 'BlackRock', tier: 'Tier I', stage: 'Prospect', revenueB: 20.4, sites: 169 };
eq(mergeProfile(tracker, {}).values.revenueB, 20.4, 'nothing typed: the tracker\'s value');
eq(mergeProfile(tracker, {}).typed, {}, 'and nothing marked typed');
const m = mergeProfile(tracker, { stage: 'Qualify', team: 'Keith McHugh', sites: '' });
eq([m.values.stage, m.values.team, m.values.sites, m.values.accountName], ['Qualify', 'Keith McHugh', '', 'BlackRock'], 'typed wins, even when it is a cleared field');
eq(m.typed, { team: true, stage: true, sites: true }, 'typed fields are marked');

// Tab 2 scores, as on the MRI tool's cards.
const brain = BODY_SYSTEMS[0], lungs = BODY_SYSTEMS[2];
eq(systemScore(brain, { 'brain.0': 'Strong', 'brain.1': 'Strong', 'brain.2': 'Strong', 'brain.3': 'Absent' }), { sum: 9, rated: 4, pct: 75 }, 'three Strong and an Absent is 75');
eq(systemScore(lungs, { 'lungs.0': 'Moderate', 'lungs.1': 'Strong', 'lungs.2': 'Strong', 'lungs.3': 'Strong' }).pct, 92, 'a Moderate and three Strong is 92');
eq(systemScore(brain, {}), { sum: 0, rated: 0, pct: 0 }, 'unrated');

// Tab 6: the template's own formulas.
const all = (statements, value) => Object.fromEntries(statements.map(s => [s.key, value]));
let d = dealHealthScore({ buy: all(BUY_STATEMENTS, 'Agree'), ours: all(OURS_STATEMENTS, 'Small advantage') }, 'Prospect');
eq([d.buy.total, d.buy.level, d.ours.total, d.ours.level, d.winProbability, d.stageCap], [20, 'HIGH', 16, 'HIGH', 0.8, 0.25], 'high and high is 80%, capped by stage');
d = dealHealthScore({ buy: { ...all(BUY_STATEMENTS, 'Strongly agree'), reason: 'Disagree' }, ours: all(OURS_STATEMENTS, 'Parity') });
eq([d.buy.total, d.buy.level, d.ours.total, d.ours.level, d.winProbability, d.stageCap], [22, 'MED', 12, 'MED', 0.5, null], 'a rating below Neutral caps buy at MED');
d = dealHealthScore({ buy: all(BUY_STATEMENTS, 'Agree'), ours: { ...all(OURS_STATEMENTS, 'Clear advantage'), extra: 'Clear disadvantage' } });
eq([d.ours.total, d.ours.level, d.winProbability], [16, 'MED', 0.6], 'a Clear disadvantage caps ours at MED');
d = dealHealthScore({ buy: all(BUY_STATEMENTS, 'Disagree'), ours: all(OURS_STATEMENTS, 'Small disadvantage') });
eq([d.buy.level, d.ours.level, d.winProbability], ['LOW', 'LOW', 0.15], 'low and low');
eq(dealHealthScore({ buy: all(BUY_STATEMENTS, 'Agree') }).winProbability, 0, 'no win probability until both blocks are rated');
eq(dealHealthScore({}, 'Customer – Expand').stageCap, 0.8, 'stage cap for a customer');

// Tab 3.
const dms = [{ name: 'Ann Lee', email: 'ann@x.example' }, { name: 'Bo Diaz', email: '' }];
eq(committeeRows(undefined, dms), dms, 'no saved committee: the tracker\'s decision makers');
eq(committeeRows([], dms), [], 'an emptied committee stays empty');
eq(committeeRows(
  [{ name: 'Ann', email: 'ann@x.example', support: '' }, { name: 'Zoe' }],
  [{ name: 'Ann', email: 'ANN@x.example', support: 'Neutral (Non-Committal)', relationship: '3 - Neutral', relOwner: 'Yes' }],
), [{ name: 'Ann', email: 'ann@x.example', support: '', relationship: '3 - Neutral', relOwner: 'Yes' }, { name: 'Zoe' }], 'a saved committee takes the tracker values it never set, keeps cleared ones');
eq(addMissingDecisionMakers([{ name: 'Ann', email: 'ANN@x.example', support: 'Unknown' }], dms).map(r => r.name), ['Ann', 'Bo Diaz'], 'only the missing decision makers are added, matched on email then name');

// Progress.
const form = {
  diagnosis: { signals: { 'brain.0': 'Strong', 'heart.0': 'Low' } },
  opportunity: { name: 'UBM', odds: '40' },
  dealHealth: { buy: { businessCase: 'Agree' } },
  closePlan: [{ what: 'Workshop', done: 'Yes' }, { what: 'Proposal' }, {}],
};
eq(tabProgress({ form, profile: m.values, committee: dms, sites: [] }), {
  profile: Math.round((5 / MRI_PROFILE_FIELDS.length) * 100), diagnosis: Math.round((17 / 28) * 100), committee: 100, opportunity: Math.round((2 / OPPORTUNITY_FIELDS.length) * 100), sites: 0, dealHealth: 11, closePlan: 50,
}, 'progress per tab');
eq(tabProgress({}).closePlan, 0, 'nothing saved');
eq(mriStageProgress(tabProgress({})).text, '1 - 0%', 'stage progress: nothing saved is stage 1');
eq(mriStageProgress({ profile: 55 }).text, '1 - 55%', 'stage progress: first unfinished tab');
eq(mriStageProgress({ profile: 100, diagnosis: 15, committee: 100 }).text, '2 - 15%', 'stage progress: moves on once a tab is done');
eq(mriStageProgress({ profile: 100, diagnosis: 100, committee: 100, opportunity: 100, sites: 100, dealHealth: 100, closePlan: 40 }).text, '7 - 40%', 'stage progress: last tab');
eq(mriStageProgress(Object.fromEntries(MRI_TABS.map(t => [t.key, 100])))?.text, '7 - 100%', 'stage progress: all done');

eq(dateSerial('2026-12-15'), 46371, 'a date as its spreadsheet day number');
eq(dateSerial('next week'), null, 'not a date');
eq(mriSlug(' BlackRock, Inc. '), 'blackrock-inc', 'slug');

// Export: everything typed lands in the real template.
const full = {
  profile: { team: 'Keith McHugh', assignedSince: '2026-11-23', energySpend: '310' },
  diagnosis: {
    signals: { 'brain.0': 'Strong', 'blood.3': 'Low' },
    footprint: { brain: 'SE partial' },
    notes: { blood: 'Leases most plant' },
    rawIntel: 'From the 10-K: net zero by 2030.',
  },
  pursuitTeam: [{ name: 'Dana Reyes', role: 'Account lead' }, {}],
  opportunity: { name: 'Enterprise UBM', planStarted: '2026-09-01', odds: '40', revenue: '$1,350,000', proofOfConcept: 'TBD', valueDrivers: 'Line one\nLine two' },
  evidence: [{ issue: 'Late fees', evidence: '3% late', impact: '$280k / yr', importance: '8', validated: 'Yes' }],
  dealHealth: {
    buy: { businessCase: 'Agree' },
    ours: { extra: 'Parity' },
    decisionGrid: Array.from({ length: 14 }, (_, i) => ({ step: String(i + 1), decision: `Decision ${i + 1}`, validated: 'No' })),
    yellowLights: [{ light: 'CFO has not seen it', resolve: 'Readout in January', resolved: 'No' }],
  },
  closePlan: [{ what: 'Pricing workshop', when: '2026-12-15', who: 'Dana Reyes', done: 'No' }],
};
const committee = [
  { id: 'x', name: 'Ann Lee', title: 'CFO', email: 'ann@x.example', phone: '555', bodySystem: 'Heart', buyingRole: 'Budget Holder', support: 'Neutral (Non-Committal)', decisionRole: 'Decider', relationship: '3 - Neutral', relOwner: 'Dana Reyes' },
  ...Array.from({ length: 26 }, (_, i) => ({ name: `Person ${i}` })),
];
const zip = await JSZip.loadAsync(templateBytes);
const result = await fillAccountMriWorkbook(zip, {
  profile: mergeProfile({ accountName: 'BlackRock' }, full.profile).values,
  committee,
  sites: [],
  extra: mriFormExport(full),
});
eq([result.committeeRows, result.extraRows], [27, 18], 'rows written');
const out = new ExcelJS.Workbook();
await out.xlsx.load(await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
const o = n => out.worksheets[n - 1];
const iso = v => (v instanceof Date ? v.toISOString().slice(0, 10) : v);
eq([o(1).getCell('C5').value, o(1).getCell('C8').value, iso(o(1).getCell('C13').value), o(1).getCell('C17').value], ['BlackRock', 'Keith McHugh', '2026-11-23', 310], 'tab 1: typed rows, a real date and a real number');
eq([o(2).getCell('D4').value, o(2).getCell('D31').value, o(2).getCell('D5').value, o(2).getCell('D35').value, o(2).getCell('E41').value, o(2).getCell('A46').value], ['Strong', 'Low', 'Strong', 'SE partial', 'Leases most plant', 'From the 10-K: net zero by 2030.'], 'tab 2: ratings, footprint, notes, raw intel');
eq(o(2).getCell('E4').value.formula.startsWith('IF(D4='), true, 'tab 2 score formulas untouched');
eq(['A', 'B', 'E', 'F', 'G', 'H', 'I', 'J'].map(c => o(3).getCell(`${c}6`).value), ['Ann Lee', 'CFO', 'Heart', 'Budget Holder', 'Neutral (Non-Committal)', 'Decider', '3 - Neutral', 'Dana Reyes'], 'tab 3: a stakeholder with every dropdown');
eq(o(3).getCell('A32').value, 'Person 25', 'tab 3: the committee ran past its entry rows');
eq([o(3).getCell('A34').value, o(3).getCell('A36').value, o(3).getCell('A37').value, o(3).getCell('B37').value], ['Our pursuit team', 'Alex Morgan', 'Dana Reyes', 'Account lead'], 'tab 3: pursuit team written, then moved down intact');
eq([o(4).getCell('B5').value, iso(o(4).getCell('B7').value), o(4).getCell('B15').value, o(4).getCell('B16').value, o(4).getCell('B24').value, o(4).getCell('B19').value], ['Enterprise UBM', '2026-09-01', 0.4, 1350000, 'TBD', 'Line one\nLine two'], 'tab 4: text, date, percent, money, dropdown');
eq(['A', 'B', 'C', 'D', 'E'].map(c => o(4).getCell(`${c}41`).value), ['Late fees', '3% late', '$280k / yr', 8, 'Yes'], 'tab 4: evidence ledger');
eq([o(6).getCell('D5').value, o(6).getCell('D17').value, o(6).getCell('D6').value], ['Agree', 'Parity', null], 'tab 6: ratings');
eq([o(6).getCell('A33').value, o(6).getCell('B33').value, o(6).getCell('B46').value, o(6).getCell('F46').value], [1, 'Decision 1', 'Decision 14', 'No'], 'tab 6: decision grid, past its entry rows');
eq([o(6).getCell('B50').value, o(6).getCell('B51').value, o(6).getCell('C51').value, o(6).getCell('D51').value], ['CFO has not seen the business case', 'CFO has not seen it', 'Readout in January', 'No'], 'tab 6: yellow lights moved down with their example row');
eq([o(7).getCell('A5').value, iso(o(7).getCell('B5').value), o(7).getCell('C5').value, o(7).getCell('F5').value], ['Pricing workshop', '2026-12-15', 'Dana Reyes', 'No'], 'tab 7: close plan');

// Money boxes read as dollars with commas as they are typed.
eq(
  ['1350000', '$1,350,000', '1234.5', '1234.567', '.5', '0', '007', '-2500', 'abc', '', null, '12a3'].map(formatMoneyInput),
  ['$1,350,000', '$1,350,000', '$1,234.5', '$1,234.56', '$0.5', '$0', '$7', '-$2,500', '', '', '', '$123'],
  'money input formatting',
);
// Schneider footprint from the services assigned to a body system.
{
  const st = { 'Bill payment': 'Sold', 'Audits': 'Not Sold', 'GHG': 'Qualifying', 'EAC procurement': '-', 'RA dashboards': 'Renewal' };
  eq([
    footprintFromServices(['Bill payment', 'Audits'], st),
    footprintFromServices(['Audits', 'GHG'], st),
    footprintFromServices(['GHG', 'EAC procurement'], st),
    footprintFromServices(['Never heard of it'], st),
    footprintFromServices(['RA dashboards'], st),
    footprintFromServices(['bill PAYMENT'], st),
    footprintFromServices([], st),
  ], ['SE incumbent', 'Competitor-held', 'Not yet served', 'Not yet served', 'SE incumbent', 'SE incumbent', ''], 'footprint: sold wins, then not sold, else not yet served');
  const fp = trackerFootprint({ heart: ['Bill payment'], lungs: ['Audits'], brain: [] }, st);
  eq(fp, { heart: 'SE incumbent', lungs: 'Competitor-held' }, 'footprint per body system; none assigned, none set');
  eq(mergeFootprint(fp, { heart: 'SE partial', lungs: '' }), { heart: 'SE partial' }, 'a footprint picked by hand wins; cleared stays blank');
  const cells = mriFormExport(withTrackerSignals({}, {}, {}, fp)).cells;
  const d2 = Object.values(cells).flat().filter(c => ['D36', 'D37'].includes(c.ref)).map(c => c.value);
  eq(d2, ['SE incumbent', 'Competitor-held'], 'the footprint exports; the service assignment does not');
}

// Skeleton: Footprint scale from the site count, Geographic spread from the site list.
eq(['', '0', '12', '49', '50', '100', '101', '2,000', 641.8, 'n/a'].map(footprintLevel),
  ['', '', 'Low', 'Low', 'Moderate', 'Moderate', 'Strong', 'Strong', 'Strong', ''], 'footprint scale by site count');
const list = rows => ({ headers: ['Site Name', 'City', 'State', 'Country'], rows });
eq(trackerSignals({}, { siteList: list([{ 'Site Name': 'A', State: 'NY', Country: 'USA' }, { 'Site Name': 'B', State: 'Ontario', Country: 'Canada' }]) })['skeleton.3'], 'Strong', 'spread: two countries');
eq(trackerSignals({}, { siteList: list([{ 'Site Name': 'A', State: 'NY', Country: 'USA' }, { 'Site Name': 'B', State: 'TX', Country: 'United States' }]) })['skeleton.3'], 'Moderate', 'spread: two states, US written two ways');
eq(trackerSignals({}, { siteList: list([{ 'Site Name': 'A', State: 'NY', Country: 'US' }, { 'Site Name': 'B', State: 'New York', Country: 'US' }]) })['skeleton.3'], 'Low', 'spread: one state, code and name');
eq(trackerSignals({}, { siteList: { headers: ['Site Name'], rows: [{ 'Site Name': 'A' }, { 'Site Name': 'B' }] } })['skeleton.3'], undefined, 'spread: list says nothing about where');
eq(trackerSignals({}, { siteList: null })['skeleton.3'], undefined, 'spread: no list');
eq(spreadLevel({ sites: 1, countries: 0, states: 0 }), 'Low', 'spread: a single site');
eq(trackerSignals({ numberOfSites: '2000' })['skeleton.0'], 'Strong', 'footprint from the Sites field');
eq(trackerSignals({}, { siteList: list(Array.from({ length: 60 }, (_, i) => ({ 'Site Name': `S${i}`, State: 'NY' }))) })['skeleton.0'], 'Moderate', 'footprint from the list when the Sites field is empty');
eq(trackerSignals({}, {})['skeleton.0'], undefined, 'footprint: no count, no rating');
eq(trackerSignals({ numberOfSites: '30' }, { siteList: list([{ 'Site Name': 'A', State: 'NY', Status: 'Closed' }]) })['skeleton.0'], 'Low', 'the Sites field wins over the list');

// Tab 1 rows that are the company's own field are written to the company.
eq(
  [
    ['vertical', 'Real Estate'], ['salesperson', 'Dan Baldauf'], ['hq', 'North America'],
    ['revenueB', '$40.6'], ['revenueB', ''], ['revenueText', '$2,870,000,000'],
    ['sites', '2,000'], ['background', 'SAE - Jimmy Sohal'],
    ['competitors', 'Deepki'], ['competitors', 'No competitor known'],
  ].map(([k, v]) => profileRecordPatch(k, v)),
  [
    { vertical: 'Real Estate' }, { cdm: 'Dan Baldauf' }, { hqRegion: 'North America' },
    { revenue: '$40.6B' }, { revenue: '' }, { revenue: '$2,870,000,000' },
    { numberOfSites: '2000' }, { notes: 'SAE - Jimmy Sohal' },
    { competitorsNotes: 'Deepki' }, { competitorsNotes: '' },
  ],
  'record patch per row',
);
eq(['tier', 'stage', 'fee', 'energySpend', 'currentProvider', 'team'].map(k => profileRecordPatch(k, 'x')), [null, null, null, null, null, null], 'rows the MRI keeps');
// What is written reads back as the same row value.
{
  const back = accountMriProfile({ record: { company: 'X', ...profileRecordPatch('revenueB', '$40.6'), ...profileRecordPatch('sites', '2,000') } });
  eq([back.revenueB, back.sites], [40.6, 2000], 'revenue and sites read back');
}

// Tab 2's "Public climate / net-zero commitment" from the Targets tab.
eq(
  [
    undefined,
    [],
    [{ type: 'No target set' }],
    [{ type: 'Net zero', targetYear1: '2050' }],
    [{ type: 'Net-zero' }],
    [{ type: 'SBTi near-term' }],
    [{ action: 'Commitment', type: 'SBTi commitment', commitmentType: 'Net-zero' }],
    [{ type: 'Renewable energy', value: '100%' }],
    [{ type: 'Carbon neutral' }, { type: 'Net zero', hidden: true }],
    [{ type: 'Net zero', hidden: true }],
    [{ action: 'Target' }],
  ].map(climateCommitmentLevel),
  ['Absent', 'Absent', 'Absent', 'Strong', 'Strong', 'Strong', 'Strong', 'Moderate', 'Moderate', 'Absent', 'Absent'],
  'climate commitment level from targets',
);
eq(trackerSignals({ climateTargets: [{ type: 'Net zero' }] }), { 'brain.0': 'Strong', 'immune.0': 'Absent', 'immune.1': 'Absent' }, 'tracker signals');
eq(
  [[], ['CDP'], ['GRESB'], ['NZAM'], ['UN PRI'], ['un pri'], ['SBT', 'Ecovadis', 'RECA'], ['SBT', 'GRESB'], ['CSRD'], ['CA SB']].map(disclosureLevel),
  ['Absent', 'Strong', 'Strong', 'Strong', 'Strong', 'Strong', 'Absent', 'Strong', 'Strong', 'Strong'],
  'disclosure level from CDP / GRESB / NZAM / UN PRI / CSRD / CA SB',
);
eq((({ 'immune.0': a, 'immune.1': b }) => [a, b])(trackerSignals({ frameworks: ['UN PRI'] })), ['Strong', 'Strong'], "the record's own frameworks count");
eq((({ 'immune.0': a, 'immune.1': b }) => [a, b])(trackerSignals({ frameworks: ['SBT'] }, { frameworks: new Set(['CDP']) })), ['Strong', 'Strong'], 'a Lists-page flag counts');
eq(mergeSignals(trackerSignals({ frameworks: ['CDP'] }), { 'immune.0': 'Low' })['immune.0'], 'Low', 'a hand-picked Immune rating still wins');
eq((({ 'brain.0': a, 'brain.1': b, 'brain.2': c }) => [a, b, c])(mergeSignals({ 'brain.0': 'Strong' }, { 'brain.1': 'Low' })), ['Strong', 'Low', 'Absent'], 'tracker rating fills an unpicked sign');
eq(mergeSignals({ 'brain.0': 'Strong' }, { 'brain.0': 'Low' })['brain.0'], 'Low', 'a picked rating wins');
eq(['brain.0', 'brain.2'].map(k => k in mergeSignals({ 'brain.0': 'Strong' }, { 'brain.0': '', 'brain.2': '' })), [false, false], 'a sign cleared by hand stays blank');
eq(
  mriFormExport(withTrackerSignals({}, { 'brain.0': 'Strong' })).cells,
  mriFormExport({ diagnosis: { signals: { 'brain.0': 'Strong' } } }).cells,
  'the tracker rating exports',
);
eq(['2000', '1234567.5', '', 'x'].map(v => formatNumberInput(v)), ['2,000', '1,234,567.5', '', ''], 'count input formatting');
eq(
  [profileDisplayValue('revenueB', 1.63), profileDisplayValue('energySpend', '200000000'), profileDisplayValue('sites', 2000), profileDisplayValue('hq', 'North America'), profileDisplayValue('sites', '')],
  ['$1.63', '$200,000,000', '2,000', 'North America', ''],
  'tab 1 display values',
);
eq(mriFormExport({ opportunity: { programValue: formatMoneyInput('2500000') } }).cells, mriFormExport({ opportunity: { programValue: '2500000' } }).cells, 'a formatted money value exports as the same number');

// Tab 2's default Absent ratings, and nothing else, on a company nobody has touched.
eq(Object.keys(DEFAULT_SIGNALS).length, 15, 'fifteen vital signs default to Absent');
eq(DEFAULT_SIGNALS['heart.0'], 'Absent', 'Margin / cost pressure defaults to Absent');
eq(DEFAULT_SIGNALS['blood.3'], 'Absent', 'Appetite for OPEX / as-a-service defaults to Absent');
eq(Object.values(diagnosisNotes({})), BODY_SYSTEMS.map(() => '-'), 'every Intel notes box defaults to -');
eq(diagnosisNotes({ brain: 'Met CFO', heart: '' }).brain, 'Met CFO', 'a typed note replaces the default');
eq(diagnosisNotes({ heart: '' }).heart, '', 'an emptied note stays empty');
eq(diagnosisSignals({}), DEFAULT_SIGNALS, 'an untouched company shows the defaults');
eq(diagnosisSignals({ 'brain.2': 'Strong', 'heart.2': '', 'brain.0': 'Low' })['brain.2'], 'Strong', 'a picked rating replaces the default');
eq('heart.2' in diagnosisSignals({ 'heart.2': '' }), false, 'a default cleared by hand stays cleared');
eq(diagnosisSignals({ 'brain.0': 'Low' })['brain.0'], 'Low', 'a rating with no default is kept');
const tab2 = mriFormExport({}).cells['xl/worksheets/sheet2.xml'];
eq((tab2 || []).length, 15 + BODY_SYSTEMS.length, 'an empty form writes only the default ratings and notes on tab 2');
eq(tabProgress({ form: {} }).diagnosis, Math.round((15 / 28) * 100), 'diagnosis progress counts the defaults');

// Exec / board ownership of sustainability follows Public climate / net-zero commitment.
eq(diagnosisSignals({ 'brain.0': 'Strong' })['brain.1'], 'Strong', 'exec ownership matches the climate commitment');
eq(mergeSignals({ 'brain.0': 'Moderate' }, {})['brain.1'], 'Moderate', 'it follows the rating read from Targets');
eq(mergeSignals({ 'brain.0': 'Moderate' }, { 'brain.0': 'Low' })['brain.1'], 'Low', 'it follows a climate rating picked by hand');
eq(mergeSignals({ 'brain.0': 'Strong' }, { 'brain.1': 'Absent' })['brain.1'], 'Absent', 'a rating picked for it wins');
eq('brain.1' in mergeSignals({ 'brain.0': 'Strong' }, { 'brain.1': '' }), false, 'cleared by hand stays cleared');
eq('brain.1' in diagnosisSignals({}), false, 'nothing to match, nothing shown');

// Heart's Intel notes: energy spend as a share of revenue.
eq(energyShareNote({ energySpend: '40', revenueB: '1.63' }), 'Energy spend is 2.5% of revenue ($40M of $1.63B)', 'in the rows\' units: $M and $B');
eq(energyShareNote({ energySpend: '$200,000,000', revenueB: '$40.6' }), 'Energy spend is 0.49% of revenue ($200M of $40.6B)', 'energy spend written out in dollars');
eq(energyShareNote({ energySpend: '150', revenueB: 1.2 }), 'Energy spend is 13% of revenue ($150M of $1.2B)', 'a share of 10% or more is a whole number');
eq(energyShareNote({ energySpend: '', revenueB: '1.63' }), '', 'no energy spend, no note');
eq(energyShareNote({ energySpend: '40' }), '', 'no revenue, no note');
eq(trackerNotes({}, { profile: { energySpend: '40', revenueB: '1.63' } }).heart, 'Energy spend is 2.5% of revenue ($40M of $1.63B)', 'Heart note from tab 1');
eq(diagnosisNotes(trackerNotes({}, { profile: {} })).heart, '-', 'Heart keeps - without both figures');

// Immune's Intel notes: the disclosure frameworks the company reports to.
eq(disclosureFrameworkList(['UN PRI', 'SBT', 'gresb']), 'GRESB, UN PRI', 'only GRESB, CDP, UN PRI and NZAM, in that order');
eq(disclosureFrameworkList(['SBT']), '', 'none of the four');
eq(trackerNotes({ frameworks: ['CDP'] }, { frameworks: new Set(['NZAM']) }).immune, 'CDP, NZAM', 'the record\'s own and the Lists-page frameworks');
eq('immune' in trackerNotes({}), false, 'no frameworks, Immune keeps -');
eq([['CSRD'], ['ca sb'], ['RECA', 'SBT']].map(f => trackerSignals({ frameworks: f })['immune.0']), ['Strong', 'Strong', 'Absent'], 'CSRD and CA SB count as disclosure frameworks');
eq(trackerNotes({ frameworks: ['CA SB', 'CSRD', 'GRESB'] }).immune, 'GRESB, CSRD, CA SB', 'Immune note lists CSRD and CA SB');
eq(diagnosisNotes(trackerNotes({}, { frameworks: ['GRESB'] })).immune, 'GRESB', 'Immune note from Frameworks');

// Brain's Intel notes: the kind of targets the company has.
eq(climateTargetSummary([
  { action: 'Target', type: 'Absolute reduction', value: '50%', targetYear1: '2030', scope1: true, scope2: true, classification: '1.5°C' },
  { action: 'Commitment', type: 'SBTi commitment', commitmentType: 'Net-zero', targetYear1: '2050' },
  { action: 'Target', type: 'Intensity', value: '20%', targetYear1: '2025', hidden: true },
]), '50% Absolute reduction (Scope 1, 2) by 2030, 1.5°C; Net-zero commitment by 2050', 'targets in a line, hidden ones left out');
eq(climateTargetSummary([{ action: '', type: 'No target set' }]), 'No target set', 'checked and no target');
eq(climateTargetSummary([]), '', 'targets not looked at');
eq(trackerNotes({ climateTargets: [] }), {}, 'no Brain note when targets were not looked at');
{
  const L = rows => ({ headers: ['Site Name', 'State', 'Country'], rows });
  const twoCountries = L([{ 'Site Name': 'A', State: 'NY', Country: 'USA' }, { 'Site Name': 'B', State: 'Ontario', Country: 'Canada' }]);
  const threeStates = L([{ 'Site Name': 'A', State: 'NY', Country: 'US' }, { 'Site Name': 'B', State: 'TX', Country: 'US' }, { 'Site Name': 'C', State: 'Texas', Country: 'US' }, { 'Site Name': 'D', State: 'CA', Country: 'US' }]);
  eq([
    trackerNotes({ numberOfSites: '2000' }, { siteList: twoCountries }).skeleton,
    trackerNotes({}, { siteList: threeStates }).skeleton,
    trackerNotes({ numberOfSites: '1' }, { siteList: L([{ 'Site Name': 'A', State: 'NY' }]) }).skeleton,
    trackerNotes({ numberOfSites: '641.8' }).skeleton,
    trackerNotes({}, { siteList: L([{ 'Site Name': 'A', Country: 'UK' }, { 'Site Name': 'B', Country: 'UK' }]) }).skeleton,
    'skeleton' in trackerNotes({}),
  ], ['2,000 sites across 2 countries', '4 sites across 3 states', '1 site across 1 state', '642 sites', '2 sites across 1 country', false], 'Skeleton note: sites and where');
}
eq(diagnosisNotes({ ...trackerNotes({ climateTargets: [{ action: '', type: 'No target set' }] }) }).brain, 'No target set', 'Brain note from Targets');
eq(diagnosisNotes({ ...trackerNotes({ climateTargets: [{ action: '', type: 'No target set' }] }) }).heart, '-', 'the other systems keep -');
eq(withTrackerSignals({ diagnosis: { notes: { brain: 'typed' } } }, {}, { brain: 'from targets' }).diagnosis.notes.brain, 'typed', 'a typed Brain note wins over Targets');

// Nothing typed changes nothing beyond what the export always wrote.
const bare = await JSZip.loadAsync(templateBytes);
await fillAccountMriWorkbook(bare, { profile: {}, committee: [], sites: [], extra: mriFormExport({}) });
const untouched = await JSZip.loadAsync(templateBytes);
for (const n of [4, 6, 7]) {
  const path = `xl/worksheets/sheet${n}.xml`;
  eq(await bare.file(path).async('string') === await untouched.file(path).async('string'), true, `an empty form leaves tab ${n} byte for byte`);
}


// ── Why each Diagnosis sign shows what it shows (hover text) ──
{
  const rec = { frameworks: ['SBT', 'GRESB'], numberOfSites: '2000', climateTargets: [{ type: 'Net zero', targetYear1: '2050' }] };
  const siteList = list([{ 'Site Name': 'A', State: 'NY', Country: 'USA' }, { 'Site Name': 'B', State: 'Ontario', Country: 'Canada' }]);
  const r = trackerSignalReasons(rec, { siteList, frameworks: new Set(['CDP']) });
  eq(r['immune.0'].startsWith('Strong: the company reports to GRESB, CDP.'), true, 'why: disclosure names the frameworks that count');
  eq(r['immune.1'], r['immune.0'], 'why: both Immune signs give the same reason');
  eq(r['skeleton.0'].startsWith("Strong: 2,000 sites (the company's Sites field)."), true, 'why: footprint gives the count and where it came from');
  eq(r['skeleton.3'].startsWith('Strong: the saved site list has 2 open sites across 2 countries'), true, 'why: spread gives the countries');
  eq(r['brain.0'].startsWith('Strong: the Targets tab has one target (Net zero'), true, 'why: climate names the target');
  const none = trackerSignalReasons({ frameworks: ['SBT'] });
  eq(none['immune.0'].startsWith('Absent: the company reports to none of CDP, GRESB, NZAM, UN PRI, CSRD, CA SB (its frameworks: SBT).'), true, 'why: disclosure Absent lists what it does have');
  eq(none['brain.0'].startsWith('Absent: the Targets tab has no current target.'), true, 'why: no targets');
  eq(none['skeleton.0'].startsWith("the company's Sites field is empty"), true, 'why: footprint says what is missing');
  eq(none['skeleton.3'].startsWith('the company has no saved site list'), true, 'why: spread says what is missing');
  eq(signalReason('skeleton.3', { tracker: trackerSignals({}), reasons: none, signals: mergeSignals(trackerSignals({}), {}) }).startsWith('Not rated by the tracker: the company has no saved site list.'), true, 'hover: an unrated tracker sign says what is missing');
  eq(signalReason('skeleton.2', { tracker: {}, reasons: none, signals: mergeSignals({}, {}) }).startsWith('Absent by default'), true, 'hover: a defaulted sign with no tracker rule');

  const tracker = trackerSignals(rec, { siteList });
  const reasons = trackerSignalReasons(rec, { siteList });
  const ctx = saved => ({ saved, tracker, reasons, signals: mergeSignals(tracker, saved), labelOf: k => k });
  eq(signalReason('immune.0', ctx({})).startsWith('Strong: the company reports to GRESB.'), true, 'hover: tracker rating gives its reason');
  eq(signalReason('immune.0', ctx({ 'immune.0': 'Low' })).startsWith('Low: picked by hand on this Account MRI.'), true, 'hover: hand-picked says so');
  eq(signalReason('immune.0', ctx({ 'immune.0': 'Low' })).includes('The tracker would rate it Strong:'), true, 'hover: hand-picked still shows what the tracker would say');
  eq(signalReason('immune.0', ctx({ 'immune.0': '' })).startsWith('Cleared by hand'), true, 'hover: cleared by hand');
  eq(signalReason('heart.0', ctx({})).startsWith('Absent by default'), true, 'hover: a default Absent says it is the default');
  eq(signalReason('lungs.0', ctx({})).startsWith('Not rated yet'), true, 'hover: an unrated sign says so');
  eq(signalReason('brain.1', ctx({})).startsWith('Strong: matches "brain.0"'), true, 'hover: a following sign names the one it matches');
  eq(signalReason('brain.1', ctx({})).includes('the Targets tab has one target'), true, 'hover: and why that one is rated');
}

// Tab 4: "No active opportunity" ticked on its own.
{
  const none = { own: [], portfolio: [] };
  const auto = withOpportunityDefault({}, none).opportunity;
  eq([auto.noActive, auto.noActiveAuto, auto.name], [true, true, NO_ACTIVE_OPPORTUNITY], 'no live opp: ticked on its own');
  eq(withOpportunityDefault({}, { own: [{}], portfolio: [] }).opportunity, undefined, 'a live opp on the company: not ticked');
  eq(withOpportunityDefault({}, { own: [], portfolio: [{}] }).opportunity, undefined, 'a live opp on a portfolio company: not ticked');
  eq(withOpportunityDefault({}, null).opportunity, undefined, 'opps not loaded: not ticked');
  eq(withOpportunityDefault({ opportunity: { noActive: false } }, none).opportunity, { noActive: false }, 'unticked by hand: stays unticked');
  eq(withOpportunityDefault({ opportunity: { owner: 'Dan' } }, none).opportunity, { owner: 'Dan' }, 'something typed: left as it is');
  eq(setNoActiveOpportunity({}, false), { noActive: false }, 'unticking keeps that it was unticked');
}

eq(['.5', '$.5', '40.6', '$1.5B', '850M', '1630000000', 'n/a', ''].map(revenueBillionsText),
  ['$0.5B', '$0.5B', '$40.6B', '$1.5B', '850M', '1630000000', 'n/a', ''], 'company Revenue ($B): bare amounts stored as billions');
eq(profileRecordPatch('revenueB', '$.5'), { revenue: '$0.5B' }, 'MRI Revenue ($B) .5 writes $0.5B');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
