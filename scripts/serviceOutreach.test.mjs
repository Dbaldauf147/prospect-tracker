// Assertion tests for the Outreach by Service sub-tab's numbers.
// Run: node scripts/serviceOutreach.test.mjs
import {
  outreachEvents, outreachSeries, serviceOrder, rangeWindow, periodStart, periodLabel, asShares, NO_SERVICE,
} from '../src/utils/serviceOutreach.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.error(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}
const D = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };

const campaigns = [
  { title: 'Advisory push', services: ['Advisory', 'Utility Bill Mgmt'], contacts: [
    { email: 'a@acme.com', company: 'Acme', sentDate: '2026-09-02', replied: true, replyDate: '2026-10-01' },
    { email: 'b@acme.com', company: 'Acme', sentDate: '2026-09-20' },
    { email: 'c@globex.com', company: 'Globex' }, // never sent
  ] },
  { title: 'Advisory again', services: ['advisory '], contacts: [
    { email: 'a@acme.com', company: 'Acme', sentDate: '2026-10-05' },
    { email: 'x@y.com; z@y.com', company: 'Y', sentDate: '2026-10-06', replied: true },
  ] },
  { title: 'Untagged', contacts: [{ email: 'q@q.com', sentDate: '2026-10-10' }] },
];
const ev = outreachEvents(campaigns);

check('unsent rows are skipped; two-service campaign counts for both', ev.length, 2 * 2 + 2 + 1);
check('untagged campaign lands under NO_SERVICE', ev.filter(e => e.service === NO_SERVICE).length, 1);
check('service names merged across case and spacing', ev.filter(e => e.service === 'Advisory').length, 4);
check('reply without a date is dated by the send', ev.find(e => e.emails.includes('x@y.com')).replyAt.getDate(), 6);
check('colour order: biggest sender first, ties A-Z', serviceOrder(ev), ['Advisory', 'Utility Bill Mgmt', NO_SERVICE]);

const from = D('2026-09-01'), to = D('2026-10-31');
const sends = outreachSeries({ events: ev, services: ['Advisory', 'Utility Bill Mgmt'], period: 'month', metric: 'sends', from, to });
check('monthly rows, zeros kept', sends.rows.map(r => [r.label, r.Advisory, r['Utility Bill Mgmt']]), [['Sep 26', 2, 2], ['Oct 26', 2, 0]]);
check('sends total', sends.total, 6);

const people = outreachSeries({ events: ev, services: ['Advisory', 'Utility Bill Mgmt'], period: 'month', metric: 'contacts', from, to });
check('people: a group row counts each address', people.rows[1].Advisory, 3);
check('people total is distinct across services', people.total, 4);
check('people per-service total is distinct', people.totals.Advisory, 4);

const cos = outreachSeries({ events: ev, services: ['Advisory'], period: 'quarter', metric: 'companies', from, to });
check('companies distinct per quarter', cos.rows.map(r => [r.label, r.Advisory]), [['Q3 2026', 1], ['Q4 2026', 2]]);

const rep = outreachSeries({ events: ev, services: ['Advisory'], period: 'month', metric: 'replies', from, to });
check('replies dated by reply', rep.rows.map(r => r._total), [0, 2]);

const narrow = outreachSeries({ events: ev, services: ['Advisory'], period: 'week', metric: 'sends', from: D('2026-09-15'), to: D('2026-09-21') });
check('window filters; week starts Monday', narrow.rows.map(r => [r.period, r.Advisory]), [['2026-09-14', 1], ['2026-09-21', 0]]);

check('periodStart quarter', periodStart(D('2026-11-20'), 'quarter').getMonth(), 9);
check('periodLabel week', periodLabel(D('2026-11-16'), 'week'), 'Nov 16');

const now = D('2026-11-20');
const w3 = rangeWindow('3m', { now });
check('3M window', [w3.from.getMonth(), w3.from.getDate(), w3.to.getDate()], [7, 21, 20]);
check('YTD window', rangeWindow('ytd', { now }).from.getMonth(), 0);
check('All starts at first send', rangeWindow('all', { now, events: ev }).from.getMonth(), 8);
check('Custom', rangeWindow('custom', { now, customFrom: '2026-01-05', customTo: '2026-02-01' }).to.getMonth(), 1);

check('shares', asShares([{ A: 1, B: 3 }, { A: 0, B: 0 }], ['A', 'B']).map(r => [r.A, r.B]), [[25, 75], [0, 0]]);
check('empty input', outreachSeries({ events: [], services: [], from, to }).rows.length, 2);

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
