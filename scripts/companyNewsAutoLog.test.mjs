// Assertion tests for the acquisition-news digest writing its deals onto
// the company records' Acquisitions & Dispositions log.
// Plain Node - no test framework (the project has none). Run:
//   node scripts/companyNewsAutoLog.test.mjs
//
// The digest window overlaps from one week to the next, so the same deal
// comes back more than once; what matters here is that it lands on the log
// once, that nothing typed by hand is lost, and that one bad record does
// not stop the rest.
import { dealToTransaction, mergeDealsIntoLog, logDealsToRecords, buildNewsEmailHtml, checkCompanyNow, classifyByRules, dealsFromHeadlines, dealTableRows, NEWS_TABLE_COLUMNS, newsWorkbook } from '../api/_lib/companyNews.js';
import { parseDigestText } from '../src/utils/portfolioTransactions.js';

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
  eq([out.logged, out.failed], [1, 1], 'one logged, the broken record counted and skipped');
  eq(out.rows.map(r => r.asset), ['Acme Services'], 'and the rows written handed back');
  eq(writes, [['prospects/p1', ['portfolioTransactions', 'updatedAt']]], 'only portfolioTransactions (and its updatedAt stamp) is written, only where something is new');
  eq(docs['prospects/p1'].updatedAt instanceof Date, true, 'stamped as a Date, which Firestore stores as a Timestamp');
  eq(docs['prospects/p1'].portfolioTransactions.map(r => r.asset), ['Acme Services', 'Riverside'], 'deal added ahead of the typed row');
  const again = await logDealsToRecords(db, 'u1', 'baldaufdan@gmail.com', results.slice(0, 1));
  eq(again.logged, 0, 'next week the same deal is not logged twice');

  const out2 = await logDealsToRecords(db, 'u2', 'someone@example.com', [{ id: 'p2', company: 'KKR', deals: [deal] }]);
  eq([out2.logged, docs['users/u2/prospects/p2'].portfolioTransactions.length], [1, 1], "a non-admin's deals go to their own records");
}

// ── checking one company now ─────────────────────────────────────────────
{
  const docs = { 'prospects/apollo': { company: 'Apollo Global Management', type: 'Private Equity' } };
  const ref = (path) => ({
    path,
    get: async () => ({ exists: path in docs, id: path.split('/').pop(), data: () => docs[path] }),
  });
  const db = {
    collection: (name) => ({ doc: (id) => ref(`${name}/${id}`) }),
    runTransaction: async (fn) => fn({
      get: async (r) => ({ exists: r.path in docs, data: () => docs[r.path] }),
      update: (r, patch) => Object.assign(docs[r.path], patch),
    }),
  };
  let asked = null;
  const research = async (entry, since, until) => {
    asked = { company: entry.company, isPe: entry.isPe, days: Math.round((until - since) / 86400000) };
    return { deals: [deal, { ...deal, target: 'Yahoo', announcedOn: '2026-09-18' }], unsure: [], error: null };
  };
  const newsletters = async () => ({ items: [] });
  const now = new Date('2026-09-28T12:00:00Z').getTime();
  const out = await checkCompanyNow(db, 'u1', 'baldaufdan@gmail.com', 'apollo', { lookbackDays: 14, now, research, newsletters });
  eq(asked, { company: 'Apollo Global Management', isPe: true, days: 14 }, 'searches that record over the window asked for');
  eq([out.found, out.logged, out.rows.length], [2, 2, 2], 'both deals logged and handed back');
  eq(docs['prospects/apollo'].portfolioTransactions.length, 2, 'written to the record');
  const again = await checkCompanyNow(db, 'u1', 'baldaufdan@gmail.com', 'apollo', { now, research, newsletters });
  eq([again.found, again.logged], [2, 0], 'checking again finds them but logs nothing new');
  eq((await checkCompanyNow(db, 'u1', 'baldaufdan@gmail.com', 'nope', { research, newsletters })).notFound, true, 'a missing record says so');
}

// ── the email says so ─────────────────────────────────────────────────────
{
  const html = buildNewsEmailHtml([{ company: 'Blackstone', deals: [deal], unsure: [] }], { since: 0, until: 1, logged: 2 });
  eq(html.includes('2 new deals were added'), true, 'footer counts the deals logged');
  eq(buildNewsEmailHtml([], { since: 0, until: 1 }).includes('Acquisitions &amp; Dispositions log'), false, 'and says nothing when none were');
}

// ── dispositions, end to end ─────────────────────────────────────────────
{
  const items = [
    ['Apollo agrees to sell Gamma Logistics to KKR for $2bn - Reuters', '2026-09-20'],
    ['Apollo acquires Acme Services - Reuters', '2026-09-21'],
  ].map(([title, d]) => ({ title, publishedAt: Date.parse(d), link: 'https://example.com/' + d, source: 'Reuters' }));
  const entry = { id: 'apollo', company: 'Apollo Global Management', isPe: true };
  const { deals } = classifyByRules(entry, items);
  const byKind = Object.fromEntries(deals.map(d => [d.kind, d]));
  eq([byKind.Disposition?.target, byKind.Disposition?.counterparty, byKind.Disposition?.dealType, byKind.Disposition?.value],
    ['Gamma Logistics', 'KKR', 'Exit', '$2B'], 'digest: the sale comes through as a disposition, sold to KKR');
  eq(byKind.Acquisition?.target, 'Acme Services', 'digest: alongside the acquisition');

  const html = buildNewsEmailHtml([{ ...entry, deals, unsure: [] }], { since: 0, until: 1 });
  eq(html.includes('1 acquisition, 1 disposition'), true, 'email: the header counts each kind');
  // The email is one table: firm, date, company, its seller.
  eq(NEWS_TABLE_COLUMNS, ['PE Firm', 'Date of Sale', 'Company Purchased', 'Seller of that Company'], 'email: the four columns');
  eq(html.includes('HQ'), false, 'email: no HQ column or footnote');
  eq(NEWS_TABLE_COLUMNS.every(c => html.includes(`>${c}</th>`)), true, 'email: each is a column heading');
  eq((html.match(/<table/g) || []).length, 1, 'email: one table');
  const withSeller = deals.map(d => (d.kind === 'Acquisition' ? { ...d, counterparty: 'Founders' } : d));
  const kkr = { company: 'KKR', deals: [{ kind: 'Acquisition', target: 'Zeta Foods', announcedOn: '2026-09-25', counterparty: 'Bain Capital', sourceUrl: 'https://example.com/zeta' }] };
  const tableRows = dealTableRows([kkr, { ...entry, deals: withSeller }]);
  const expected = [
    ['Apollo Global Management', '2026-09-21', 'Acme Services', 'Founders'],
    ['Apollo Global Management', '2026-09-20', 'Gamma Logistics', 'Apollo'],
    ['KKR', '2026-09-25', 'Zeta Foods', 'Bain Capital'],
  ];
  eq(tableRows.map(r => [r.firm, r.date, r.company, r.seller]), expected,
    'email: by firm A to Z, newest first within a firm; a purchase names who sold it, a sale names the firm as seller');

  // The attachment is that same table.
  const XLSX = await import('xlsx');
  const book = XLSX.read(await newsWorkbook([kkr, { ...entry, deals: withSeller }]), { type: 'buffer' });
  const sheet = book.Sheets[book.SheetNames[0]];
  eq(XLSX.utils.sheet_to_json(sheet, { header: 1 }), [NEWS_TABLE_COLUMNS, ...expected], 'excel: the same columns and rows as the email');
  eq(sheet.C4?.l?.Target, 'https://example.com/zeta', 'excel: the company name links to its article');
  eq(html.includes('href="https://example.com/2026-09-21"'), true, 'email: the company name links to its article');
  eq(html.includes('Apollo agrees to sell'), false, 'email: no summary sentence, just the table');

  const { rows } = mergeDealsIntoLog([], deals, entry.company);
  const sold = rows.find(r => r.kind === 'Disposition');
  eq([sold?.asset, sold?.counterparty, sold?.dealType, sold?.entity], ['Gamma Logistics', 'KKR', 'Exit', ''], 'log: logged as a disposition with its counterparty');
  eq(mergeDealsIntoLog([{ asset: 'Gamma Logistics', date: '2026-09-20', kind: 'Acquisition' }], [byKind.Disposition], entry.company).added, 1,
    'log: an earlier purchase of the same company does not block its sale');

  // Pasting rows of the email's table: a purchase keeps its seller, and a
  // row whose seller is the firm itself is that firm's sale.
  const table = [
    'PE Firm\tDate of Sale\tCompany Purchased\tHQ of Purchased Company\tSeller of that Company',
    'Apollo Global Management\t2026-09-21\tAcme Services\tDallas, TX\tFounders',
    'Apollo Global Management\t2026-09-20\tGamma Logistics\t\tApollo funds',
  ].join('\n');
  eq(parseDigestText(table, [{ text: 'Acme Services', href: 'https://example.com/a' }]).map(d => [d.kind, d.date, d.asset, d.counterparty, d.sourceUrl, d.notes]), [
    ['Acquisition', '2026-09-21', 'Acme Services', 'Founders', 'https://example.com/a', 'HQ: Dallas, TX'],
    ['Disposition', '2026-09-20', 'Gamma Logistics', '', '', ''],
  ], 'paste: table rows of an older email, with its HQ column, read into deals');
  const table4 = [
    'PE Firm\tDate of Sale\tCompany Purchased\tSeller of that Company',
    'Apollo Global Management\t2026-09-21\tAcme Services\tFounders',
    'Apollo Global Management\t2026-09-20\tGamma Logistics\tApollo funds',
  ].join('\n');
  eq(parseDigestText(table4).map(d => [d.kind, d.date, d.asset, d.counterparty, d.notes]), [
    ['Acquisition', '2026-09-21', 'Acme Services', 'Founders', ''],
    ['Disposition', '2026-09-20', 'Gamma Logistics', '', ''],
  ], 'paste: table rows read into deals');

  // Pasting an older email, in its previous layout, still works.
  const text = [
    '2026-09-20', 'SOLDGamma Logistics', 'Exit · $2B', 'Seller: Apollo', 'Sold to: KKR', 'Apollo agrees to sell Gamma.', 'Reuters →',
    '2026-09-21', 'BOUGHT Acme Services', 'Platform', 'Buyer: Apollo', 'Bought from: Founders', 'Reuters →',
  ].join('\n');
  const pasted = parseDigestText(text);
  eq(pasted.map(d => [d.kind, d.asset, d.counterparty, d.dealType]),
    [['Disposition', 'Gamma Logistics', 'KKR', 'Exit'], ['Acquisition', 'Acme Services', 'Founders', 'Platform']], 'paste: kind, name and counterparty read off the email');
}

// The AI path: a disposition answer keeps its kind and gets a disposition type.
{
  const items = [{ title: 'Apollo sells Gamma', publishedAt: Date.parse('2026-09-20'), link: 'https://x', source: 'S' }];
  const [d] = dealsFromHeadlines([{ index: 0, kind: 'Disposition', target: 'Gamma', buyer: 'Apollo', counterparty: 'KKR', dealType: 'Platform' }], items);
  eq([d.kind, d.counterparty, d.dealType], ['Disposition', 'KKR', 'Divestiture'], 'ai: kind kept, an acquisition-only type replaced');
}

console.log(`${failed ? 'FAIL' : 'PASS'}  companyNewsAutoLog: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
