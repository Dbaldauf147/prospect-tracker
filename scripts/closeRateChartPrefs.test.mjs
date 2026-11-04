// Close Rates chart preferences (colours and data labels).
import assert from 'node:assert/strict';
import { readChartPrefs, withColour, withoutColours, withLabels, labelText } from '../src/utils/closeRateChartPrefs.js';

assert.deepEqual(readChartPrefs(undefined), { labels: false, colours: {} });
assert.deepEqual(readChartPrefs({ closeRatesChartPrefs: 'junk' }), { labels: false, colours: {} });
const messy = readChartPrefs({ closeRatesChartPrefs: { labels: true, colours: { source: { BFO: '#AABBCC', Bad: 'red' }, stage: null } } });
assert.deepEqual(messy, { labels: true, colours: { source: { BFO: '#AABBCC' } } });

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
