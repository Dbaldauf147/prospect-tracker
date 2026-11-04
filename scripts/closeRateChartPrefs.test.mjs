// Close Rates chart preferences (colours and data labels).
import assert from 'node:assert/strict';
import { readChartPrefs, withColour, withoutColours, withLabels, labelText } from '../src/utils/closeRateChartPrefs.js';

assert.deepEqual(readChartPrefs(undefined), { labels: false, lineLabels: {}, colours: {}, targets: {} });
assert.deepEqual(readChartPrefs({ closeRatesChartPrefs: 'junk' }), { labels: false, lineLabels: {}, colours: {}, targets: {} });
const messy = readChartPrefs({ closeRatesChartPrefs: { labels: true, colours: { source: { BFO: '#AABBCC', Bad: 'red' }, stage: null } } });
assert.deepEqual(messy, { labels: true, lineLabels: {}, colours: { source: { BFO: '#AABBCC' } }, targets: {} });

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

// Targets: several per chart, each with a colour and an optional name.
{
  const { cleanTarget, cleanTargets, targetsOf, withTargets, nextTargetColour, targetLabel, DEFAULT_TARGET_COLOUR } = await import('../src/utils/closeRateChartPrefs.js');
  assert.equal(cleanTarget('25'), 25);
  assert.equal(cleanTarget('22.55%'), 22.6);
  assert.equal(cleanTarget(''), null);
  assert.equal(cleanTarget('abc'), null);
  assert.equal(cleanTarget(120), null);
  assert.equal(cleanTarget(-1), null);
  // An older single-number save still reads, as one slate target.
  const legacy = readChartPrefs({ closeRatesChartPrefs: { targets: { source: 40, stage: 'x', service: 200 } } });
  assert.deepEqual(legacy.targets, { source: [{ id: 't1', value: 40, colour: DEFAULT_TARGET_COLOUR, name: '' }] });
  let t = readChartPrefs({});
  assert.deepEqual(targetsOf(t, 'source'), []);
  t = withTargets(t, 'source', [
    { id: 'a', value: '30', colour: '#FF0000', name: ' Floor ' },
    { id: 'b', value: 45, colour: 'nope', name: 'Stretch' },
    { id: 'c', value: '', colour: '#00ff00' },
  ]);
  assert.deepEqual(targetsOf(t, 'source'), [
    { id: 'a', value: 30, colour: '#ff0000', name: 'Floor' },
    { id: 'b', value: 45, colour: DEFAULT_TARGET_COLOUR, name: 'Stretch' },
  ], 'blank value dropped, bad colour defaulted, names trimmed');
  assert.deepEqual(readChartPrefs({ closeRatesChartPrefs: { targets: t.targets } }).targets, t.targets, 'round-trips');
  t = withTargets(t, 'source', []);
  assert.deepEqual(t.targets, {}, 'empty clears');
  assert.equal(nextTargetColour([]), DEFAULT_TARGET_COLOUR);
  assert.notEqual(nextTargetColour([{ colour: DEFAULT_TARGET_COLOUR }]), DEFAULT_TARGET_COLOUR);
  assert.equal(targetLabel({ value: 30, name: '' }), 'Target 30%');
  assert.equal(targetLabel({ value: 45, name: 'Stretch' }), 'Stretch 45%');
  assert.deepEqual(cleanTargets('35'), [{ id: 't1', value: 35, colour: DEFAULT_TARGET_COLOUR, name: '' }]);
  console.log('PASS closeRateChartPrefs targets');
}
