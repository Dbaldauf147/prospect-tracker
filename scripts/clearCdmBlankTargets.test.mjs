// One-time fix: listed companies whose Targets list row has no CDM lose Dan as CDM.
import assert from 'node:assert/strict';
import { cardsToClear, NOV10_ADDED } from '../src/utils/clearCdmBlankTargets.js';

const rows = [
  { name: 'Access Industries', cdm: '' },
  { name: 'ACRE Management', cdm: 'Dan Baldauf' },
  { name: 'ECP Holdings', cdm: '' },
  { name: 'Kin Properties Inc', cdm: '' },
];
const prospects = [
  { id: 'a', company: 'Access Industries', cdm: 'Dan Baldauf' },     // blank CDM row -> clear
  { id: 'b', company: 'ACRE Management', cdm: 'Dan Baldauf' },       // row names Dan -> keep
  { id: 'c', company: 'ECP', cdm: 'Dan Baldauf' },                   // mapped to a blank row -> clear
  { id: 'd', company: 'Andreessen Horowitz', cdm: 'Dan Baldauf' },   // not on the list -> keep
  { id: 'e', company: 'Kin Properties', cdm: 'Rose Shaver' },        // not Dan -> keep
  { id: 'f', company: 'Not Listed Co', cdm: 'Dan Baldauf' },         // not in the day's list -> keep
  { id: 'g', company: ' access industries ', cdm: 'Dan Baldauf' },   // spacing / case -> clear
];
const got = cardsToClear({ prospects, rows, targetMap: { c: ['ECP Holdings'] }, cdmName: 'Dan Baldauf' });
assert.deepEqual(got.map(x => x.id).sort(), ['a', 'c', 'g']);
assert.equal(got.find(x => x.id === 'c').targetRow, 'ECP Holdings');

// A mapping to a row that names a CDM wins over a same-name blank row.
const r2 = cardsToClear({ prospects: [{ id: 'a', company: 'Access Industries', cdm: 'Dan Baldauf' }], rows: [...rows, { name: 'Access Ind (Main)', cdm: 'Dan Baldauf' }], targetMap: { a: ['Access Ind (Main)'] }, cdmName: 'Dan Baldauf' });
assert.equal(r2.length, 0);

assert.equal(cardsToClear({ prospects, rows: [], cdmName: 'Dan Baldauf' }).length, 0, 'no Targets data: nothing');
assert.equal(NOV10_ADDED.length, 176);
console.log('PASS  clear CDM on blank-CDM Targets rows');
