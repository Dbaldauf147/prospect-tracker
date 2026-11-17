// Planned send dates per audience on a saved campaign (utils/campaignAudience
// scheduledFor). Plain Node:  node scripts/campaignSchedule.test.mjs
import assert from 'node:assert/strict';
import { campaignSchedule, withSchedule, listWithSchedule, scheduleState } from '../src/utils/campaignAudience.js';

const c = { title: 'Midterm', subject: 'Midterm results' };
assert.deepEqual(campaignSchedule(c), { clients: '', keyContacts: '', prospects: '' });
const c1 = withSchedule(c, 'prospects', '2026-12-01');
assert.deepEqual(c1.scheduledFor, { prospects: '2026-12-01' });
assert.equal(campaignSchedule(c1).prospects, '2026-12-01');
assert.equal(c.scheduledFor, undefined, 'original untouched');
assert.equal(withSchedule(c1, 'prospects', '').scheduledFor, undefined, 'clearing the last date drops the field');
assert.equal(withSchedule(c, 'clients', 'soon').scheduledFor, undefined, 'junk is not stored');
assert.equal(campaignSchedule({ scheduledFor: { clients: 'x' } }).clients, '', 'junk reads as no date');

const list = [{ title: 'A', subject: 'a' }, c];
const out = listWithSchedule(list, c, 'clients', '2026-11-20');
assert.equal(out[1].scheduledFor.clients, '2026-11-20');
assert.equal(out[0], list[0]);
assert.throws(() => listWithSchedule(list, { title: 'Gone' }, 'clients', '2026-11-20'));

assert.equal(scheduleState('', '2026-11-17'), '');
assert.equal(scheduleState('2026-11-16', '2026-11-17'), 'overdue');
assert.equal(scheduleState('2026-11-17', '2026-11-17'), 'today');
assert.equal(scheduleState('2026-11-24', '2026-11-17'), 'soon');
assert.equal(scheduleState('2026-11-25', '2026-11-17'), 'later');
console.log('campaignSchedule: all assertions passed');

// Row colours.
import { campaignRowTone } from '../src/utils/campaignAudience.js';
const T = '2026-11-17';
const all = { sentTo: { clients: true, keyContacts: true, prospects: true } };
assert.equal(campaignRowTone(all, T), 'complete');
assert.equal(campaignRowTone(all, T, true), 'complete', 'complete wins over paused');
assert.equal(campaignRowTone({}, T, true), 'waiting', 'paused');
assert.equal(campaignRowTone({}, T), '');
assert.equal(campaignRowTone({ sentTo: { clients: true }, scheduledFor: { keyContacts: '2026-11-23', prospects: '2026-11-17' } }, T), 'waiting', 'ticked + dates');
assert.equal(campaignRowTone({ scheduledFor: { clients: '2026-12-01', keyContacts: '2026-12-01', prospects: '2026-12-01' } }, T), 'waiting', 'all dated');
assert.equal(campaignRowTone({ sentTo: { clients: true }, scheduledFor: { keyContacts: '2026-11-23' } }, T), '', 'one audience with neither');
assert.equal(campaignRowTone({ sentTo: { clients: true, keyContacts: true }, scheduledFor: { prospects: '2026-11-10' } }, T), '', 'overdue date does not count');
console.log('campaignRowTone: all assertions passed');
