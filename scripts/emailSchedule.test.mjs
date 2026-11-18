// Assertion tests for Email Campaigns > Email Schedule (utils/emailSchedule).
// Run: node scripts/emailSchedule.test.mjs
import {
  outreachLog, sendsInWindow, readinessOn, targetDate, plannedSends,
  buildEmailSchedule, audienceMembers, addDays, nextWeekday,
} from '../src/utils/emailSchedule.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.log(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}

check('addDays crosses a month', addDays('2026-11-28', 5), '2026-12-03');
check('nextWeekday skips the weekend', nextWeekday('2026-11-21'), '2026-11-23');
check('nextWeekday keeps a weekday', nextWeekday('2026-11-18'), '2026-11-18');

const sent = (email, days) => ({ email, sentDate: `${days[days.length - 1]}T15:00:00Z`, sendCount: days.length, sendHistory: days.map(d => ({ date: `${d}T15:00:00Z`, subject: 's' })) });
const campaigns = [
  { title: 'A', subject: 'A', contacts: [sent('a@x.com', ['2026-11-02', '2026-11-09']), sent('b@x.com; c@x.com', ['2026-11-10'])] },
  { title: 'B', subject: 'B', contacts: [{ email: 'a@x.com', sentDate: '2026-11-12T15:00:00Z' }, { email: 'z@x.com', sentDate: '' }],
    sentTo: { clients: true }, scheduledFor: { clients: '2026-11-01', keyContacts: '2026-11-25', prospects: '2026-11-10' } },
];
const log = outreachLog(campaigns);
check('history days per address', log.get('a@x.com'), ['2026-11-02', '2026-11-09', '2026-11-12']);
check('grouped send credits each address', [log.get('b@x.com'), log.get('c@x.com')], [['2026-11-10'], ['2026-11-10']]);
check('unsent row has no log', log.has('z@x.com'), false);

check('window is 21 days ending on the day', sendsInWindow(log.get('a@x.com'), '2026-11-22'), 3);
check('a send 21 days back is outside', sendsInWindow(log.get('a@x.com'), '2026-11-23'), 2);

const members = ['a@x.com', 'b@x.com', 'q@x.com'];
check('a is at 3, so over; b and q fine', readinessOn({ members, log, day: '2026-11-18' }), { total: 3, ok: 2, over: 1, share: 2 / 3 });
check('planned sends count for everyone', readinessOn({ members, log, planned: ['2026-11-16', '2026-11-17'], day: '2026-11-18' }).ok, 1);
check('empty audience is share 1', readinessOn({ members: [], log, day: '2026-11-18' }).share, 1);

// a drops to 2 in window on 11-23 (11-02 leaves), 1 on 11-30.
check('target waits for a to clear at 100%', targetDate({ members, log, fromDay: '2026-11-18', most: 1 }), '2026-11-23');
check('target today when most is enough', targetDate({ members, log, fromDay: '2026-11-18', most: 0.6 }), '2026-11-18');

const planned = plannedSends(campaigns);
check('sent audiences and blanks are skipped', planned.map(r => `${r.audience}:${r.date}`), ['prospects:2026-11-10', 'keyContacts:2026-11-25']);

const sched = buildEmailSchedule({ campaigns, members: { clients: [], keyContacts: members, prospects: ['b@x.com'] }, today: '2026-11-18', most: 1 });
const pros = sched.rows.find(r => r.audience === 'prospects');
check('overdue send is due today', [pros.sendDay, pros.overdue], ['2026-11-18', true]);
const key = sched.groups.find(g => g.key === 'keyContacts');
check('group next', key.next.date, '2026-11-25');
check('group target', key.next.target, '2026-11-23');
check('not early when after target', key.next.early, false);
// After the 11-25 send: a has 11-09, 11-12, 11-25 until 11-30 (11-09 leaves) -> needs <=2.
check('next target after the planned send', key.nextTarget, '2026-11-30');

const gates = {
  clientExclusionOf: (c) => (c.x ? 'untracked' : ''),
  isClient: (c) => c.t === 'client', isKey: (c) => c.t === 'key' || c.t === 'client', isKeyProspect: (c) => c.t === 'dm' || c.t === 'key',
};
const m = audienceMembers([
  { email: 'C@x.com', t: 'client' }, { email: 'k@x.com', t: 'key' }, { email: 'd@x.com', t: 'dm' }, { email: 'e@x.com', t: 'client', x: 1 }, { email: '', t: 'key' },
], gates);
check('audiences are disjoint', [[...m.clients], [...m.keyContacts], [...m.prospects]], [['c@x.com'], ['k@x.com'], ['d@x.com']]);

console.log(`emailSchedule: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
