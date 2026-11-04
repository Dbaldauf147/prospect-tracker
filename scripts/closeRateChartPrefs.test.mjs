// Close Rates chart preferences (colours and data labels).
import assert from 'node:assert/strict';
import { readChartPrefs, withColour, withoutColours, withLabels, labelText } from '../src/utils/closeRateChartPrefs.js';

assert.deepEqual(readChartPrefs(undefined), { labels: false, lineLabels: {}, colours: {}, targets: {}, windows: {}, weeklyMonths: 6 });
assert.deepEqual(readChartPrefs({ closeRatesChartPrefs: 'junk' }), { labels: false, lineLabels: {}, colours: {}, targets: {}, windows: {}, weeklyMonths: 6 });
const messy = readChartPrefs({ closeRatesChartPrefs: { labels: true, colours: { source: { BFO: '#AABBCC', Bad: 'red' }, stage: null } } });
assert.deepEqual(messy, { labels: true, lineLabels: {}, colours: { source: { BFO: '#AABBCC' } }, targets: {}, windows: {}, weeklyMonths: 6 });

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

// Targets.
{
  const { withTarget, cleanTarget } = await import('../src/utils/closeRateChartPrefs.js');
  assert.equal(cleanTarget('25'), 25);
  assert.equal(cleanTarget('22.55%'), 22.6);
  assert.equal(cleanTarget(''), null);
  assert.equal(cleanTarget('abc'), null);
  assert.equal(cleanTarget(120), null);
  assert.equal(cleanTarget(-1), null);
  let t = readChartPrefs({});
  t = withTarget(t, 'source', '30');
  assert.deepEqual(t.targets, { source: 30 });
  t = withTarget(t, 'reach', 45);
  t = withTarget(t, 'source', '');
  assert.deepEqual(t.targets, { reach: 45 }, 'blank clears');
  assert.deepEqual(readChartPrefs({ closeRatesChartPrefs: { targets: { source: 40, stage: 'x', service: 200 } } }).targets, { source: 40 });
  console.log('PASS closeRateChartPrefs targets');
}

// Per-chart time frames.
{
  const { windowRange, savedWindow, withWindow, withWeeklyMonths } = await import('../src/utils/closeRateChartPrefs.js');
  const now = new Date(2026, 10, 4); // 4 Nov 2026
  assert.equal(windowRange('page', now), null);
  assert.deepEqual(windowRange('all', now), { from: '', to: '' });
  assert.deepEqual(windowRange('ytd', now), { from: '2026-01-01', to: '' });
  assert.deepEqual(windowRange('12m', now), { from: '2025-11-04', to: '' });
  assert.deepEqual(windowRange('6m', now), { from: '2026-05-04', to: '' });
  assert.deepEqual(windowRange('18m', now), { from: '2025-05-04', to: '' });
  assert.deepEqual(windowRange('6m', new Date(2026, 7, 31)), { from: '2026-02-28', to: '' }, 'month-end clamps');
  assert.equal(windowRange('nope', now), null);
  let w = readChartPrefs({});
  assert.equal(savedWindow(w, 'source'), 'page');
  w = withWindow(w, 'source', '12m');
  assert.equal(savedWindow(w, 'source'), '12m');
  assert.equal(withWindow(w, 'source', 'bogus'), w);
  w = withWindow(w, 'source', 'page');
  assert.deepEqual(w.windows, {});
  assert.equal(withWeeklyMonths(w, 12).weeklyMonths, 12);
  assert.equal(withWeeklyMonths(w, 7).weeklyMonths, 6, 'only 3/6/9/12');
  assert.deepEqual(readChartPrefs({ closeRatesChartPrefs: { windows: { source: '24m', stage: 'x' }, weeklyMonths: 5 } }).windows, { source: '24m' });
  console.log('PASS closeRateChartPrefs windows');
}
