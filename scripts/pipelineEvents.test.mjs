import assert from 'node:assert/strict';
import { sanitizeEvents } from '../src/utils/pipelineEvents.js';

assert.deepEqual(sanitizeEvents(null), []);
assert.deepEqual(sanitizeEvents({}), []);
const out = sanitizeEvents([
  { id: 'a', name: 'GreenBuild', date: '2026-11-12' },
  { id: 'b', name: 'No date', date: 'soon' },
  null,
  'junk',
]);
assert.equal(out.length, 2);
assert.deepEqual(out[0], { id: 'a', name: 'GreenBuild', date: '2026-11-12' });
assert.equal(out[1].date, '');
assert.ok(sanitizeEvents([{ name: 'x' }])[0].id);
console.log('pipelineEvents tests passed');
