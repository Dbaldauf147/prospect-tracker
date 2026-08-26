// Assertion tests for the scheduled-opps queue. Plain Node — no test
// framework (the project has none). Run:
//   node scripts/scheduledOpps.test.mjs
//
// A scheduled opp is a New Opp payload parked on user settings until its
// Eastern due date and time pass. Two things about it are easy to get
// subtly wrong and invisible on screen:
//
//   * WHEN it comes due — Eastern wall clock, EST/EDT, from a stored
//     date + time that the browser's own timezone must not affect.
//   * WHICH services it covers — the company card's Services Explored
//     board reads this queue so a service someone has already booked an
//     opp for doesn't read as untouched. That match has to agree with
//     the one used for live opps, or a service would change meaning the
//     moment its row is finally created.

import {
  SCHEDULED_OPP_DEFAULT_TIME,
  formatScheduledOppDay,
  formatScheduledOppWhen,
  placeScheduledRows,
  normalizeScheduledOpps,
  pendingScheduledOppsForCompany,
  pruneScheduledOpps,
  scheduledOppDueMs,
  scheduledOppPending,
  scheduledServicesForCompany,
} from '../src/utils/scheduledOpps.js';
import { easternWallToUtcMs } from '../src/utils/nfatSchedules.js';

let failures = 0;
function check(label, actual, expected) {
  const ok = Object.is(actual, expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n      got:  ${JSON.stringify(actual)}\n      want: ${JSON.stringify(expected)}`}`);
}
const j = (v) => JSON.stringify(v);
const et = (y, m, d, hh, mm) => easternWallToUtcMs(y, m, d, hh, mm);

// --- what a stored entry becomes ------------------------------------------
const raw = [
  { id: 'a', company: 'EOS Hospitality', scope: 'Budgets; Bill payment', notes: 'ask about the 2027 renewal', dueDate: '2026-08-14', dueTime: '08:00' },
  { id: 'b', company: 'No date co' },                    // unschedulable
  { id: 'c', company: 'Half filled', dueDate: '2026-08-15' },
  { company: 'No id', dueDate: '2026-08-16' },           // unidentifiable
];
const norm = normalizeScheduledOpps(raw);
check('only entries that can come due survive', j(norm.map(e => e.id)), j(['a', 'c']));
check('the services it is for are kept', norm[0].scope, 'Budgets; Bill payment');
check('and the note with them', norm[0].notes, 'ask about the 2027 renewal');
check('a missing time falls back to the default', norm[1].dueTime, SCHEDULED_OPP_DEFAULT_TIME);
check('a missing scope is empty, not undefined', norm[1].scope, '');
check('nothing stored is an empty queue', j(normalizeScheduledOpps(null)), j([]));

// --- when it comes due ----------------------------------------------------
check('the due time is Eastern wall clock',
  scheduledOppDueMs({ dueDate: '2026-08-14', dueTime: '08:00' }), et(2026, 8, 14, 8, 0));
check('EDT and EST are an hour apart',
  scheduledOppDueMs({ dueDate: '2026-01-14', dueTime: '08:00' }) - Date.UTC(2026, 0, 14, 8, 0), 5 * 3600_000);
check('an unparseable date has no due time', scheduledOppDueMs({ dueDate: 'soon' }), null);
check('pending until it fires', scheduledOppPending({ id: 'a' }), true);
check('a fired entry is not pending', scheduledOppPending({ id: 'a', firedAt: 1 }), false);
check('nor a cancelled one', scheduledOppPending({ id: 'a', canceledAt: 1 }), false);
check('the chip date is the Eastern day',
  formatScheduledOppDay({ dueDate: '2026-08-14', dueTime: '08:00' }), 'Aug 14');
check('and the tooltip spells the whole thing out',
  formatScheduledOppWhen({ dueDate: '2026-08-14', dueTime: '08:00' }), 'Fri, Aug 14, 8:00 AM ET');

// --- one company's queue --------------------------------------------------
const QUEUE = normalizeScheduledOpps([
  { id: 'soon', company: 'EOS Hospitality', scope: 'Budgets', dueDate: '2026-08-14', dueTime: '08:00' },
  { id: 'later', company: 'EOS Hospitality, Inc.', scope: 'Budgets; Bill payment', dueDate: '2026-09-01', dueTime: '08:00' },
  { id: 'fired', company: 'EOS Hospitality', scope: 'Audits', dueDate: '2026-08-01', dueTime: '08:00', firedAt: 123 },
  { id: 'canceled', company: 'EOS Hospitality', scope: 'API/ETL', dueDate: '2026-08-02', dueTime: '08:00', canceledAt: 123 },
  { id: 'other', company: 'Someone else', scope: 'Budgets', dueDate: '2026-08-14', dueTime: '08:00' },
]);
const mine = pendingScheduledOppsForCompany('EOS Hospitality', QUEUE);
check('soonest first', j(mine.map(e => e.id)), j(['soon', 'later']));
check('a company suffix still matches', mine[1].company, 'EOS Hospitality, Inc.');
check('no company, no queue', pendingScheduledOppsForCompany('', QUEUE).length, 0);
check('another company sees its own', j(pendingScheduledOppsForCompany('Someone else', QUEUE).map(e => e.id)), j(['other']));

// --- which services it books ----------------------------------------------
const ITEMS = ['Budgets', 'Bill payment', 'Audits', 'API/ETL', 'Strategic sourcing'];
const booked = scheduledServicesForCompany('EOS Hospitality', QUEUE, ITEMS);
check('every service named by a queued opp is booked',
  j([...booked.keys()].sort()), j(['Bill payment', 'Budgets']));
check('the soonest opp is the one shown', booked.get('Budgets').id, 'soon');
check('a service only a later opp names still shows it', booked.get('Bill payment').id, 'later');
check('a fired opp books nothing', booked.has('Audits'), false);
check('nor a cancelled one', booked.has('API/ETL'), false);
check('a service nobody named is free', booked.has('Strategic sourcing'), false);
check('another company\'s queue is not mine',
  j([...scheduledServicesForCompany('Someone else', QUEUE, ITEMS).keys()]), j(['Budgets']));
check('no company, nothing booked', scheduledServicesForCompany('', QUEUE, ITEMS).size, 0);
check('an opp with no services books nothing',
  scheduledServicesForCompany('Acme', normalizeScheduledOpps([{ id: 'x', company: 'Acme', dueDate: '2026-08-14' }]), ITEMS).size, 0);

// Scope is typed shorthand, so matching is on whole words — the same rule
// live opps go through (utils/scopeMatch.js). "RA" must not claim
// "St[ra]tegic sourcing" here any more than it does there.
const shorthand = normalizeScheduledOpps([{ id: 'r', company: 'Acme', scope: 'RA', dueDate: '2026-08-14' }]);
check('shorthand does not claim a service it merely appears inside',
  scheduledServicesForCompany('Acme', shorthand, ITEMS).size, 0);

// --- where the placeholder lines sit in the Opps table ---------------------
// The queue is rendered into the table as greyed placeholder rows. They go
// under the opps that have a Call In — those are today's callbacks and keep
// the top — and above the rest, where a queued opp would otherwise be lost
// among the recently-closed history.
{
  const row = (id, callIn) => ({ id, callIn });
  const hasCallIn = (r) => r.callIn != null;
  const ghosts = [{ id: 'g1' }, { id: 'g2' }];
  const ids = (arr) => arr.map(r => r.id);

  check('placed under the call-in rows and above the rest',
    j(ids(placeScheduledRows(
      [row('a', -2), row('b', 0), row('c', null), row('d', null)], ghosts, hasCallIn,
    ))),
    j(['a', 'b', 'g1', 'g2', 'c', 'd']));
  check('every call-in row stays above them, contiguous or not',
    j(ids(placeScheduledRows(
      [row('a', 1), row('c', null), row('b', 3)], ghosts, hasCallIn,
    ))),
    j(['a', 'c', 'b', 'g1', 'g2']));
  check('no call-in rows at all: the placeholders lead',
    j(ids(placeScheduledRows([row('c', null)], ghosts, hasCallIn))),
    j(['g1', 'g2', 'c']));
  check('every row has a call-in: the placeholders trail',
    j(ids(placeScheduledRows([row('a', 0), row('b', 2)], ghosts, hasCallIn))),
    j(['a', 'b', 'g1', 'g2']));
  check('nothing queued leaves the rows exactly as they were',
    j(ids(placeScheduledRows([row('a', 0), row('b', null)], [], hasCallIn))),
    j(['a', 'b']));
  check('no rows at all: just the placeholders',
    j(ids(placeScheduledRows([], ghosts, hasCallIn))), j(['g1', 'g2']));
}

// --- housekeeping ---------------------------------------------------------
const DAY = 24 * 60 * 60 * 1000;
const now = 1_800_000_000_000;
const kept = pruneScheduledOpps([
  { id: 'pending', dueDate: '2027-01-01' },
  { id: 'justFired', firedAt: now - 1 * DAY },
  { id: 'oldFired', firedAt: now - 61 * DAY },
  { id: 'oldCanceled', canceledAt: now - 61 * DAY },
], now);
check('pending entries are kept however far out', j(kept.map(e => e.id).includes('pending')), j(true));
check('a recent stamp stays, so every device sees it', j(kept.map(e => e.id)), j(['pending', 'justFired']));

console.log(failures === 0 ? '\nAll passed.' : `\n${failures} failed.`);
process.exit(failures === 0 ? 0 : 1);
