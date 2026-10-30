// Assertion tests for yearly campaign schedules.
// Run: node scripts/campaignSchedules.test.mjs
import {
  fillYear, occurrenceDate, nextOccurrence, dueSchedules, applyDueSchedules,
  buildScheduledCampaign, cannotCreateReason, lastCreatedYear, templateFromText,
  scheduleWhenLabel,
} from '../src/utils/campaignSchedules.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.error(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}

const NOW = '2026-11-01T12:00:00.000Z';

check('fillYear', fillYear('Holiday {year} / { Year }', 2026), 'Holiday 2026 / 2026');
check('occurrence', occurrenceDate({ month: 3, day: 15 }, 2026), '2026-03-15');
check('Feb 29 in a common year', occurrenceDate({ month: 2, day: 29 }, 2027), '2027-02-28');
check('Feb 29 in a leap year', occurrenceDate({ month: 2, day: 29 }, 2028), '2028-02-29');
check('label', scheduleWhenLabel({ month: 12, day: 1 }), 'December 1');

const holiday = {
  id: 'h', title: 'Holiday {year}', subjects: ['Happy holidays {year}'],
  month: 11, day: 1, createdOn: '2026-01-01', carryContacts: true,
};

// Due on the day, not before.
check('not due the day before', dueSchedules([holiday], [], '2026-10-31').length, 0);
check('due on the day', dueSchedules([holiday], [], '2026-11-01').map(d => d.year), [2026]);
check('still due later in the year', dueSchedules([holiday], [], '2026-12-30').length, 1);
check('disabled is never due', dueSchedules([{ ...holiday, enabled: false }], [], '2026-11-01').length, 0);
check('set up after this year\'s date waits a year',
  dueSchedules([{ ...holiday, createdOn: '2026-11-02' }], [], '2026-11-05').length, 0);

// The campaign it builds.
const first = buildScheduledCampaign(holiday, 2026, [], NOW);
check('title filled', first.title, 'Holiday 2026');
check('subject filled', [first.subject, first.subjects], ['Happy holidays 2026', ['Happy holidays 2026']]);
check('stamped', [first.scheduleId, first.scheduleYear], ['h', 2026]);
check('empty roster', [first.contacts.length, first.totalContacts], [0, 0]);
check('no event link key', 'eventUrl' in first, false);

// Created once.
const r1 = applyDueSchedules([], [holiday], '2026-11-01', NOW);
check('created', r1.created.length, 1);
check('not again', applyDueSchedules(r1.campaigns, [holiday], '2026-11-02', NOW).created.length, 0);
check('reason when it exists', cannotCreateReason(holiday, 2026, r1.campaigns), 'The 2026 campaign already exists.');
check('last created year', lastCreatedYear(r1.campaigns, 'h'), 2026);

// Next year's copies last year's roster, minus its activity.
const lastYear = {
  ...first,
  contacts: [
    { email: 'ann@x.com', name: 'Ann', company: 'X', sentDate: '2026-11-02', replied: true, eventStatus: 'Yes', notes: 'liked it', recipientCount: 1, outreach: '', holdUntil: '' },
    { email: 'bob@x.com', name: 'Bob', company: 'X', sentDate: '', replied: false, outreach: 'avoid', holdUntil: '' },
    { email: 'me@se.com', name: 'Me', sentDate: '2026-11-02' },
  ],
  targetCompanies: [{ company: 'Y Corp' }],
};
const next = applyDueSchedules([lastYear], [holiday], '2027-11-01', NOW);
const made = next.created[0];
check('next year created', [made.title, made.scheduleYear], ['Holiday 2027', 2027]);
check('roster carried, activity reset, colleagues dropped', made.contacts, [
  { email: 'ann@x.com', name: 'Ann', company: 'X', sentDate: '', replied: false, eventStatus: '', recipientCount: 1, outreach: '', holdUntil: '', notes: '' },
  { email: 'bob@x.com', name: 'Bob', company: 'X', sentDate: '', replied: false, eventStatus: '', recipientCount: 1, outreach: 'avoid', holdUntil: '', notes: '' },
]);
check('counts', [made.totalContacts, made.sent, made.replies], [2, 0, 0]);
check('target companies carried', made.targetCompanies, [{ company: 'Y Corp' }]);
check('newest first', next.campaigns[0] === made, true);
check('last year untouched', lastYear.contacts[0].sentDate, '2026-11-02');
check('fresh roster when carrying is off',
  buildScheduledCampaign({ ...holiday, carryContacts: false }, 2027, [lastYear], NOW).contacts.length, 0);

// Seeded from an existing campaign the first time.
const seed = { subject: 'Holiday 2025', contacts: [{ email: 'cat@y.com', sentDate: '2025-12-01' }] };
const seeded = buildScheduledCampaign({ ...holiday, copyFrom: 'holiday 2025' }, 2026, [seed], NOW);
check('copyFrom seeds the first year', seeded.contacts.map(c => [c.email, c.sentDate]), [['cat@y.com', '']]);

// A subject without {year} would collide with last year's.
const noToken = { ...holiday, subjects: ['Happy holidays'] };
const withOld = [{ subject: 'Happy holidays', contacts: [] }];
check('subject clash refused', dueSchedules([noToken], withOld, '2026-11-01').length, 0);
check('clash reason names the fix', cannotCreateReason(noToken, 2026, withOld).includes('{year}'), true);
check('no subject refused', cannotCreateReason({ ...holiday, subjects: [] }, 2026, []), 'Give the schedule a subject line.');

// Two schedules due at once both go in.
const other = { ...holiday, id: 'o', subjects: ['Budget season {year}'], month: 9, day: 1 };
check('two due', applyDueSchedules([], [holiday, other], '2026-11-01', NOW).created.map(c => c.subject),
  ['Happy holidays 2026', 'Budget season 2026']);

// Next occurrence.
check('next: later this year', nextOccurrence(holiday, [], '2026-06-01'), '2026-11-01');
check('next: done this year', nextOccurrence(holiday, r1.campaigns, '2026-11-02'), '2027-11-01');
check('next: set up after the date', nextOccurrence({ ...holiday, createdOn: '2026-11-05' }, [], '2026-11-05'), '2027-11-01');

// Templates from an existing campaign.
check('year becomes token', templateFromText('Holiday 2025 note', 2026), 'Holiday {year} note');
check('this year too', templateFromText('Q1 2026 update', 2026), 'Q1 {year} update');
check('no year left alone', templateFromText('Holiday note', 2026), 'Holiday note');

console.log(`${failed ? 'FAIL' : 'PASS'} campaignSchedules: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
