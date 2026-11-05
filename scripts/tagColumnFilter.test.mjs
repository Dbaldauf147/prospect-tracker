// The Tags column filter: one value per tag, any-match.
import assert from 'node:assert/strict';
import { tagValuesOf, anyValueSelected } from '../src/utils/tagColumnFilter.js';

const vocab = ['Decision Maker', 'Procurement', 'Dan Key Target'];
assert.deepEqual(tagValuesOf({ dans_tags: 'decision maker; Procurement;;Dan Key Target' }, vocab), ['Decision Maker', 'Procurement', 'Dan Key Target']);
assert.deepEqual(tagValuesOf({ dans_tags: 'Decision Maker;decisionmaker' }, vocab), ['Decision Maker'], 'two spellings are one tag');
assert.deepEqual(tagValuesOf({ dan_s_tags: 'New Tag' }, vocab), ['New Tag'], 'legacy field, unknown tag kept as written');
assert.deepEqual(tagValuesOf({}, vocab), [''], 'no tags is the blank value');
assert.equal(anyValueSelected(['Decision Maker', 'Procurement'], new Set(['Procurement'])), true);
assert.equal(anyValueSelected([''], new Set(['Procurement'])), false);
assert.equal(anyValueSelected([''], new Set([''])), true);
console.log('PASS  tag column filter');
