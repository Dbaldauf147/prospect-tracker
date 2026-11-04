// Close Rates chart preferences (colours and data labels).
import assert from 'node:assert/strict';
import { readChartPrefs, withColour, withoutColours, withLabels, labelText } from '../src/utils/closeRateChartPrefs.js';

assert.deepEqual(readChartPrefs(undefined), { labels: false, lineLabels: {}, colours: {} });
assert.deepEqual(readChartPrefs({ closeRatesChartPrefs: 'junk' }), { labels: false, lineLabels: {}, colours: {} });
const messy = readChartPrefs({ closeRatesChartPrefs: { labels: true, colours: { source: { BFO: '#AABBCC', Bad: 'red' }, stage: null } } });
assert.deepEqual(messy, { labels: true, lineLabels: {}, colours: { source: { BFO: '#AABBCC' } } });

let p = readChartPrefs({});
p = withColour(p, 'source', 'BFO', '#FF0000');
assert.equal(p.colours.source.BFO, '#ff0000');
assert.equal(withColour(p, 'source', 'BFO', 'nope'), p, 'bad hex is ignored');
p = withColour(p, 'stage', 'Stage 6', '#00ff00');
p = withoutColours(p, 'source');
assert.deepEqual(p.colours, { stage: { 'Stage 6': '#00ff00' } });
assert.equal(withLabels(p, true).labels, true);

assert.equal(labelText(null), '');
assert.equal(labelText(46.6), '47%');
assert.equal(labelText(0), '0%');
console.log('PASS closeRateChartPrefs');

// Per-line labels.
{
  const { isLabelled, withLineLabel, labelsState } = await import('../src/utils/closeRateChartPrefs.js');
  let q = readChartPrefs({});
  assert.deepEqual(q.lineLabels, {});
  assert.equal(isLabelled(q, 'source', 'BFO'), false, 'off by default');
  assert.equal(labelsState(q), 'none');
  q = withLineLabel(q, 'source', 'BFO', true);
  assert.equal(isLabelled(q, 'source', 'BFO'), true);
  assert.equal(isLabelled(q, 'source', 'Event'), false, 'other lines untouched');
  assert.equal(isLabelled(q, 'stage', 'BFO'), false, 'per chart');
  assert.equal(labelsState(q), 'some');
  q = withLabels(q, true);
  assert.deepEqual(q.lineLabels, {}, 'the all-lines button clears line choices');
  assert.equal(isLabelled(q, 'stage', 'Stage 6'), true);
  assert.equal(labelsState(q), 'all');
  q = withLineLabel(q, 'stage', 'Stage 6', false);
  assert.equal(isLabelled(q, 'stage', 'Stage 6'), false);
  assert.equal(labelsState(q), 'some');
  const cleaned = readChartPrefs({ closeRatesChartPrefs: { lineLabels: { source: { A: true, B: 'yes' }, x: 3 } } });
  assert.deepEqual(cleaned.lineLabels, { source: { A: true } });
  console.log('PASS closeRateChartPrefs line labels');
}
