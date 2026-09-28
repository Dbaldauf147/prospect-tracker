// Assertion tests for the acquisition-news digest writing its deals onto
// the company records' Acquisitions & Dispositions log.
// Plain Node - no test framework (the project has none). Run:
//   node scripts/companyNewsAutoLog.test.mjs
//
// The digest window overlaps from one week to the next, so the same deal
// comes back more than once; what matters here is that it lands on the log
// once, that nothing typed by hand is lost, and that one bad record does
// not stop the rest.
import { dealToTransaction, mergeDealsIntoLog, logDealsToRecords, buildNewsEmailHtml } from '../api/_lib/companyNews.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed += 1; } else { failed += 1; console.error(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}

const deal = {
  target: 'Acme Services', buyer: 'Tilt Holdings', dealType: 'Add-on', sector: 'Industrial Services',
  sites: '14', value: '$120M', summary: 'Tilt buys Acme.', announcedOn: '2026-09-21',
  sourceTitle: 'Business Wire', sourceUrl: 'https://example.com/acme',
};

// ── one deal as a log row ─────────────────────────────────────────────────
{
  const row = dealToTransaction(deal, 'Blackstone', 1000);
  eq([row.kind, row.date, row.asset, row.entity, row.dealType, row.notes, row.source, row.loggedAt],
    ['Acquisition', '2026-09-21', 'Acme Services', 'Tilt Holdings', 'Add-on', 'Tilt buys Acme.', 'digest', 1000],
    'deal fields carried onto the row');
  eq(dealToTransaction({ ...deal, buyer: 'blackstone' }, 'Blackstone').entity, '', 'buyer that is the company itself leaves Through blank');
}

// ── merging into an existing log ──────────────────────────────────────────
{
  const typed = { id: 't1', asset: 'Riverside Office Park', date: '2026-08-14', kind: 'Disposition' };
  const already = { id: 't2', asset: 'ACME services ', date: '2026-09-21' };
  const other = { ...deal, target: 'Beta Logistics', announcedOn: '2026-09-18' };
  const { next, added } = mergeDealsIntoLog([typed, already], [deal, other, other], 'Blackstone');
  eq(added, 1, 'only the deal not already logged is added, and only once');
  eq(next.map(r => r.id === 't1' || r.id === 't2' ? r.id : r.asset), ['Beta Logistics', 't1', 't2'], 'hand-typed rows kept, new row first');
  const same = [typed];
  eq(mergeDealsIntoLog(same, [], 'X').next === same, true, 'nothing new hands back the same array');
  eq(mergeDealsIntoLog(undefined, [deal], 'X').added, 1, 'a record with no log yet gets one');
}

// ── writing to Firestore (a fake one) ─────────────────────────────────────
{
  const docs = {
    'prospects/p1': { company: 'Blackstone', portfolioTransactions: [{ id: 't1', asset: 'Riverside', date: '2026-08-14' }] },
    'users/u2/prospects/p2': { company: 'KKR' },
  };
  const writes = [];
  const makeCol = (prefix) => ({ doc: (id) => ({ path: `${prefix}/${id}` }) });
  const db = {
    collection: (name) => ({
      ...makeCol(name),
      doc: (id) => (name === 'users'
        ? { collection: (sub) => makeCol(`users/${id}/${sub}`) }
        : { path: `${name}/${id}` }),
    }),
    runTransaction: async (fn) => fn({
      get: async (ref) => {
        if (ref.path.endsWith('boom')) throw new Error('boom');
        return { exists: ref.path in docs, data: () => docs[ref.path] };
      },
      update: (ref, patch) => { writes.push([ref.path, Object.keys(patch)]); Object.assign(docs[ref.path], patch); },
    }),
  };
  const results = [
    { id: 'p1', company: 'Blackstone', deals: [deal] },
    { id: 'boom', company: 'Broken', deals: [deal] },
    { id: 'gone', company: 'Deleted', deals: [deal] },
    { id: 'p3', company: 'Quiet', deals: [] },
  ];
  const origErr = console.error; console.error = () => {};
  const out = await logDealsToRecords(db, 'u1', 'baldaufdan@gmail.com', results);
  console.error = origErr;
  eq(out, { logged: 1, failed: 1 }, 'one logged, the broken record counted and skipped');
  eq(writes, [['prospects/p1', ['portfolioTransactions']]], 'only portfolioTransactions is written, only where something is new');
  eq(docs['prospects/p1'].portfolioTransactions.map(r => r.asset), ['Acme Services', 'Riverside'], 'deal added ahead of the typed row');
  const again = await logDealsToRecords(db, 'u1', 'baldaufdan@gmail.com', results.slice(0, 1));
  eq(again.logged, 0, 'next week the same deal is not logged twice');

  const out2 = await logDealsToRecords(db, 'u2', 'someone@example.com', [{ id: 'p2', company: 'KKR', deals: [deal] }]);
  eq([out2.logged, docs['users/u2/prospects/p2'].portfolioTransactions.length], [1, 1], "a non-admin's deals go to their own records");
}

// ── the email says so ─────────────────────────────────────────────────────
{
  const html = buildNewsEmailHtml([{ company: 'Blackstone', deals: [deal], unsure: [] }], { since: 0, until: 1, logged: 2 });
  eq(html.includes('2 new deals were added'), true, 'footer counts the deals logged');
  eq(buildNewsEmailHtml([], { since: 0, until: 1 }).includes('Acquisitions &amp; Dispositions log'), false, 'and says nothing when none were');
}

console.log(`${failed ? 'FAIL' : 'PASS'}  companyNewsAutoLog: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
