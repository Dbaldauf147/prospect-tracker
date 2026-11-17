// Assertion tests for the company popup's Targets tab: the stored rows, the
// five-yearly refresh, and the Target Type list.
// Plain Node, no framework. Run:
//   node scripts/companyTargets.test.mjs
import { normalizeTargets, updateTarget, removeTarget, cleanYear, blankTarget, scopesLabel, refreshDue, parsePastedTargets, mergePastedTargets, allSavedTargets, soonestTargetPerCompany, noTargetRow, hasNoTargetRow } from '../src/utils/companyTargets.js';

const store = {};
globalThis.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
};
const types = await import('../src/utils/targetTypeOptions.js');

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n      got:  ${JSON.stringify(actual)}\n      want: ${JSON.stringify(expected)}`}`);
}

check('normalize: not an array', normalizeTargets(null), []);
check('normalize: fills blanks, drops junk', normalizeTargets([{ id: 'a', type: 'Net zero', baseYear: 2019 }, null, 'x']), [
  { id: 'a', action: 'Target', type: 'Net zero', commitmentType: '', yearSet: '', baseYear: '2019', targetYear1: '', targetYear2: '', scope1: false, scope2: false, scope3: false, classification: '', status: '', datePublished: '', hidden: false },
]);
check('cleanYear: digits only, four max', [cleanYear('20a305'), cleanYear(''), cleanYear(null)], ['2030', '', '']);
const list = [{ id: 'a', type: '' }, { id: 'b', type: 'SBTi' }];
const edited = updateTarget(list, 'a', 'targetYear1', '2030x');
check('update: year cleaned, other row untouched', [edited[0].targetYear1, edited[1].type], ['2030', 'SBTi']);
check('update: scope flag', updateTarget(list, 'b', 'scope3', 1)[1].scope3, true);
check('remove', removeTarget(list, 'a').map(r => r.id), ['b']);
const b = blankTarget();
check('blank: has id and empty fields', [!!b.id, b.type, b.scope1], [true, '', false]);
check('scopesLabel', [scopesLabel({ scope1: true, scope3: true }), scopesLabel({})], ['1, 3', '']);

check('update: year set cleaned', updateTarget(list, 'a', 'yearSet', '2o21')[0].yearSet, '221');
check('blank: has a year set', blankTarget().yearSet, '');

// Refresh: year set + 5, judged against this year.
check('refresh: none without a year set', refreshDue({ yearSet: '' }, 2026), null);
check('refresh: none on a half-typed year', refreshDue({ yearSet: '202' }, 2026), null);
check('refresh: upcoming', refreshDue({ yearSet: '2023' }, 2026), { year: 2028, status: 'upcoming', label: 'Upcoming' });
check('refresh: due this year', refreshDue({ yearSet: '2021' }, 2026), { year: 2026, status: 'due', label: 'Due this year' });
check('refresh: overdue', refreshDue({ yearSet: '2019' }, 2026), { year: 2024, status: 'overdue', label: 'Overdue' });

// Bulk paste: the SBTi dashboard's Targets / Commitments table.
const SBTI = [
  'ACTION\tCOMMITMENT TYPE\tSTATUS\tTARGET\tSCOPE\tTARGET CLASSIFICATION\tBASE YEAR\tTARGET YEAR\tDATE PUBLISHED',
  'Target\tNA\tOther\tNet-zero\t1+2+3\t1.5°C\t2019\t2040\t2024-12-05',
  'Target\tNA\tOther\tNear-term\t1+2\t1.5°C\t2019\t2030\t2024-12-05',
  'Target\tNA\tOther\tNear-term\t3\tNA\t2019\t2030\t2024-12-05',
  'Target\tNA\tOther\tLong-term\t1+2\t1.5°C\t2019\t2040\t2024-12-05',
  'Target\tNA\tOther\tLong-term\t3\tNA\t2019\t2040\t2024-12-05',
  'Commitment\tBA1.5 Option 2\tValidated Targets\tNA\tNA\tNA\tNA\tNA\t2021-07-01',
].join('\r\n');
const strip = rows => rows.map(({ id, ...r }) => r);
const parsed = parsePastedTargets(SBTI);
check('paste: six rows', parsed.rows.length, 6);
check('paste: net-zero row', strip(parsed.rows)[0], {
  action: 'Target', type: 'Net zero', commitmentType: '', yearSet: '2024', baseYear: '2019', targetYear1: '2040', targetYear2: '',
  scope1: true, scope2: true, scope3: true, classification: '1.5°C', status: 'Other', datePublished: '2024-12-05', hidden: false,
});
check('paste: scope 3 alone, NA classification blank', strip(parsed.rows)[2], {
  action: 'Target', type: 'SBTi near-term', commitmentType: '', yearSet: '2024', baseYear: '2019', targetYear1: '2030', targetYear2: '',
  scope1: false, scope2: false, scope3: true, classification: '', status: 'Other', datePublished: '2024-12-05', hidden: false,
});
check('paste: commitment row', strip(parsed.rows)[5], {
  action: 'Commitment', type: 'SBTi commitment', commitmentType: 'BA1.5 Option 2', yearSet: '2021', baseYear: '', targetYear1: '', targetYear2: '',
  scope1: false, scope2: false, scope3: false, classification: '', status: 'Validated Targets', datePublished: '2021-07-01', hidden: false,
});
const noHeader = parsePastedTargets(SBTI.split('\r\n').slice(1).join('\n'));
check('paste: without the header, same rows', strip(noHeader.rows), strip(parsed.rows));
const perLine = parsePastedTargets(SBTI.split('\r\n').flatMap(l => l.split('\t')).join('\n'));
check('paste: one cell per line, same rows', strip(perLine.rows), strip(parsed.rows));
const perLineNoHeader = parsePastedTargets(SBTI.split('\r\n').slice(1).flatMap(l => l.split('\t')).join('\n'));
check('paste: one cell per line without header', strip(perLineNoHeader.rows), strip(parsed.rows));
check('paste: blank text', parsePastedTargets('  \n '), { rows: [], skipped: 0 });
const merged = mergePastedTargets([], parsed.rows);
check('merge: all added', [merged.added, merged.duplicates, merged.list.length], [6, 0, 6]);
const again = mergePastedTargets(merged.list, parsePastedTargets(SBTI).rows);
check('merge: pasting again adds nothing', [again.added, again.duplicates, again.updated, again.list.length], [0, 6, 0, 6]);

// Two commitments on the same date (Net-zero and Standard) are two rows.
{
  const two = [
    'Commitment\tNet-zero\tValidated Targets\tNA\tNA\tNA\tNA\tNA\t2022-06-23',
    'Commitment\tStandard\tValidated Targets\tNA\tNA\tNA\tNA\tNA\t2022-06-23',
  ].join('\n');
  const p2 = parsePastedTargets(two).rows;
  check('paste: both commitments kept', mergePastedTargets([], p2).added, 2);
  check('paste: commitment types', p2.map(r => [r.action, r.commitmentType]), [['Commitment', 'Net-zero'], ['Commitment', 'Standard']]);
  // Rows logged before these fields existed: one commitment row, no details.
  const old = [{ id: 'o1', type: 'SBTi commitment', yearSet: '2022', status: 'Validated Targets' },
    { id: 'o2', type: 'Net zero', yearSet: '2024', baseYear: '2019', targetYear1: '2040', scope1: true, scope2: true, scope3: true, classification: '1.5°C', status: 'Other' }];
  const re = mergePastedTargets(old, [...p2, ...parsePastedTargets(SBTI.replace(/2024-12-05/g, '2024-04-25')).rows.slice(0, 1)]);
  check('re-paste: fills the old rows, adds the second commitment', [re.added, re.updated, re.list.length], [1, 2, 3]);
  check('re-paste: old commitment gains its type and date', [re.list[0].action, re.list[0].commitmentType, re.list[0].datePublished], ['Commitment', 'Net-zero', '2022-06-23']);
  check('re-paste: old target gains its action and date', [re.list[1].action, re.list[1].datePublished], ['Target', '2024-04-25']);
  check('re-paste: second commitment added', re.list[2].commitmentType, 'Standard');
}
check('normalize: old commitment classification becomes its commitment type',
  normalizeTargets([{ id: 'c', type: 'SBTi commitment', classification: 'BA1.5 Option 2' }]).map(r => [r.action, r.commitmentType, r.classification])[0],
  ['Commitment', 'BA1.5 Option 2', '']);
check('normalize: an action that was cleared stays cleared', normalizeTargets([{ id: 'c', type: 'Net zero', action: '' }])[0].action, '');

// Target Type list.
check('types: defaults before anything is saved', types.loadTargetTypeOptions(), types.DEFAULT_TARGET_TYPES);
check('types: adding a new one', [types.addTargetTypeOption(' GRESB target '), types.loadTargetTypeOptions().at(-1)], [true, 'GRESB target']);
check('types: same name in another case is not added', types.addTargetTypeOption('net ZERO'), false);
check('types: blank is not added', types.addTargetTypeOption('   '), false);
check('types: a removed default stays removed', [types.removeTargetTypeOption('Net zero'), types.loadTargetTypeOptions().includes('Net zero')], [true, false]);
check('types: removing what is not there', types.removeTargetTypeOption('Nope'), false);
check('types: dedupe keeps first spelling', types.dedupeTypes(['A', 'a', ' b ', '', 3]), ['A', 'b']);

// Hide: a flag on the row, kept through normalize and toggled like a scope.
{
  const hid = updateTarget([{ id: 'h', type: 'Net zero' }], 'h', 'hidden', true);
  check('hide: sets the flag', hid[0].hidden, true);
  check('hide: survives normalize', normalizeTargets(hid)[0].hidden, true);
  check('hide: unhide', updateTarget(hid, 'h', 'hidden', false)[0].hidden, false);
  check('hide: new targets start shown', blankTarget().hidden, false);
}

// Every company's targets as one list (Prospecting > Targets).
{
  const all = allSavedTargets([
    { id: 'p1', company: 'CBRE', climateTargets: [{ id: 'a', type: 'Net zero', yearSet: '2024' }, { id: 'b', type: 'SBTi near-term', hidden: true }] },
    { id: 'p2', company: 'Acme' },
    { id: 'p3', company: 'Beta', climateTargets: 'junk' },
    { id: 'p4', company: 'Gamma', climateTargets: [{ id: 'a', type: 'SBTi commitment' }] },
  ]);
  check('all targets: count', all.length, 3);
  check('all targets: ids unique across companies', all.map(t => t.id), ['p1:a', 'p1:b', 'p4:a']);
  check('all targets: company and hidden carried', [all[0].company, all[1].hidden, all[2].company], ['CBRE', true, 'Gamma']);
  check('all targets: none', allSavedTargets(null), []);
}

// Prospecting > Targets: one row per company, its soonest refresh.
{
  const all = allSavedTargets([
    { id: 'p1', company: 'CBRE', climateTargets: [{ id: 'a', yearSet: '2024' }, { id: 'b', yearSet: '2021' }, { id: 'c', yearSet: '2021' }, { id: 'd' }] },
    { id: 'p2', company: 'Acme', climateTargets: [{ id: 'x' }, { id: 'y' }] },
    { id: 'p3', company: 'Beta', climateTargets: [{ id: 'z', yearSet: '2019' }] },
  ]);
  const one = soonestTargetPerCompany(all);
  check('soonest: one row per company', one.map(r => r.company), ['CBRE', 'Acme', 'Beta']);
  check('soonest: earliest refresh, first on a tie', one[0].targetId, 'b');
  check('soonest: no year set anywhere, first target', one[1].targetId, 'x');
  check('soonest: counts', one.map(r => r.targetCount), [4, 2, 1]);
  check('soonest: none', soonestTargetPerCompany([]), []);
}

// "No Target Set" button.
{
  const n = noTargetRow();
  check('no target: row', [n.type, n.action, n.yearSet, refreshDue(n)], ['No target set', '', '', null]);
  check('no target: survives normalize', normalizeTargets([n])[0].action, '');
  check('no target: detected', [hasNoTargetRow([n]), hasNoTargetRow([{ id: 'x', type: 'no target SET' }]), hasNoTargetRow([{ id: 'y', type: 'Net zero' }]), hasNoTargetRow(null)], [true, true, false, false]);
}

// Free text: a target written as a sentence rather than a table.
{
  const pick = r => [r.action, r.type, r.yearSet, r.baseYear, r.targetYear1, r.targetYear2, scopesLabel(r), r.classification, r.status];
  const realterm = parsePastedTargets('Realterm aims to achieve net-zero Scope 1 and Scope 2 emissions by 2050 (and targets net-positive impact before 2050 across key logistics and cargo operations like its air cargo programs)');
  check('free text: one sentence', realterm.rows.map(pick), [['Target', 'Net zero', '', '', '2050', '', scopesLabel({ scope1: true, scope2: true }), '', '']]);
  const report = parsePastedTargets('Acme commits to reduce absolute scope 1 and 2 GHG emissions 42% by 2030 from a 2020 base year. It also commits to reach net-zero across scopes 1-3 by 2045. The targets were validated by SBTi as consistent with 1.5\u00b0C.\nWe like cats a lot more than dogs.');
  check('free text: several sentences, description carried back', report.rows.map(pick), [
    ['Target', 'Absolute emissions reduction', '', '2020', '2030', '', scopesLabel({ scope1: true, scope2: true }), '1.5\u00b0C', 'Validated Targets'],
    ['Target', 'Net zero', '', '', '2045', '', scopesLabel({ scope1: true, scope2: true, scope3: true }), '1.5\u00b0C', 'Validated Targets'],
  ]);
  check('free text: unrelated sentence skipped', report.skipped, 1);
  check('free text: year set', parsePastedTargets('In 2021, Foo pledged to source 100% renewable electricity by 2025.').rows.map(pick),
    [['Target', 'Renewable electricity (RE100)', '2021', '', '2025', '', '', '', '']]);
}

if (failures) { console.log(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nAll company targets tests passed.');
