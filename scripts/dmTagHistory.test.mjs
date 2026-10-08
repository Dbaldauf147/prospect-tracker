// Assertion tests for the My Accounts "DM Tags History" subtab
// (src/utils/dmTagHistory.js). Plain Node, no framework. Run:
//   node scripts/dmTagHistory.test.mjs
//
// The claims:
//   1. A reading is taken on a fixed basis: inactive accounts out, every
//      tag in, and nothing at all while there is nothing to read.
//   2. A day is rewritten only when its numbers move, and the last reading
//      of the day wins.
//   3. The chart reads per-tier percentages with the DM Tags rounding, and
//      a day before a tag existed is a gap, not 0.
//   4. Only starred TAG columns are charted.
import {
  dmTagReading, withDmTagDay, trimDmTagHistory, dmTagSeries, starredTagKeys, pctOf,
} from '../src/utils/dmTagHistory.js';
import { tagColumnKey } from '../src/utils/decisionMakerTagMatrix.js';
import { makeDecisionMakerLookup } from '../src/utils/decisionMakerCoverage.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.log(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}

const contact = (id, company, tags) => ({ id, company, firstname: id, dans_tags: tags });
const contacts = [
  contact('a', 'Acme', 'Decision Maker;Energy'),
  contact('b', 'Beta', 'Decision Maker'),
  contact('c', 'Gone Co', 'Decision Maker;Energy'),
];
const lookup = makeDecisionMakerLookup(contacts);
const accounts = [
  { company: 'Acme', myTier: 'Tier 1', status: 'Prospect' },
  { company: 'Beta', myTier: 'Tier 1', status: 'Prospect' },
  { company: 'Cold', myTier: 'Tier 2', status: 'Prospect' },
  { company: 'Gone Co', myTier: 'Tier 2', status: 'Old Client' },
];
const energy = tagColumnKey('Energy');

// 1. the reading
const r = dmTagReading(accounts, lookup, ['Energy', 'Sustainability']);
check('Energy: 1 of 2 Tier 1, 0 of 1 Tier 2 (the Old Client is out)', r.tags[energy].t, [[1, 2], [0, 1], [0, 0]]);
check('a tag nobody carries is still recorded, at zero', r.tags[tagColumnKey('Sustainability')].t, [[0, 2], [0, 1], [0, 0]]);
check('the any-decision-maker baseline', r.dm, [[2, 2], [0, 1], [0, 0]]);
check('the label is kept as spelled', r.tags[energy].label, 'Energy');
check('no contacts yet, no reading', dmTagReading(accounts, null, ['Energy']), null);
check('no accounts, no reading', dmTagReading([], lookup, ['Energy']), null);
check('only inactive accounts, no reading', dmTagReading([accounts[3]], lookup, ['Energy']), null);

// 2. writing a day
const h1 = withDmTagDay({}, '2026-10-08', r, 1);
check('a first reading writes the day', h1['2026-10-08'].tags[energy].t, [[1, 2], [0, 1], [0, 0]]);
check('the same numbers again are not a write', withDmTagDay(h1, '2026-10-08', r, 2) === h1, true);
const moved = { ...r, tags: { ...r.tags, [energy]: { label: 'Energy', t: [[2, 2], [0, 1], [0, 0]] } } };
const h2 = withDmTagDay(h1, '2026-10-08', moved, 3);
check('a later reading the same day replaces it', h2['2026-10-08'].tags[energy].t[0], [2, 2]);
check('and stamps when', h2['2026-10-08'].updatedAt, 3);
check('no day, no write', withDmTagDay(h1, '', r) === h1, true);
const many = {};
for (let i = 1; i <= 5; i += 1) many[`2026-01-0${i}`] = { dm: [] };
check('trimming keeps the newest days', Object.keys(trimDmTagHistory(many, 2)), ['2026-01-04', '2026-01-05']);

// 3. the series
const hist = {
  '2026-10-09': { tags: { [energy]: { label: 'Energy', t: [[2, 3], [1, 1], [0, 0]] } }, dm: [[3, 3], [1, 1], [0, 0]] },
  '2026-10-08': { tags: {}, dm: [[1, 3], [0, 1], [0, 0]] },
};
const s = dmTagSeries(hist, energy);
check('oldest day first', s.map(d => d.day), ['2026-10-08', '2026-10-09']);
check('a day before the tag existed is a gap', s[0].byTier.map(b => b.pct), [null, null, null]);
check('then its percentages, an empty tier null', s[1].byTier.map(b => b.pct), [67, 100, null]);
check('with the counts behind them', [s[1].byTier[0].mapped, s[1].byTier[0].total], [2, 3]);
check('the baseline reads off dm', dmTagSeries(hist, 'dm').map(d => d.byTier[0].pct), [33, 100]);
check('never rounds up to 100 with one missing', pctOf([199, 200]), 99);
check('an empty tier has no percentage', pctOf([0, 0]), null);

// 4. starred
check('only tag columns count', starredTagKeys(['company', 'tag:energy', 'dmCount', 'tag:esg']), ['tag:energy', 'tag:esg']);
check('nothing starred is nothing', starredTagKeys(undefined), []);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
