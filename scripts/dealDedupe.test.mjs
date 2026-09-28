// Assertion tests for matching one deal reported two ways (dealDedupe.js),
// in the digest and on a company's Acquisitions & Dispositions log.
// Plain Node - no test framework (the project has none). Run:
//   node scripts/dealDedupe.test.mjs
import { sameDeal, dedupeDeals, dealTokens } from '../api/_lib/dealDedupe.js';
import { classifyByRules, mergeDealsIntoLog } from '../api/_lib/companyNews.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed += 1; } else { failed += 1; console.error(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}

eq(dealTokens('Stake in BMG music rights'), ['bmg'], 'filler words dropped, the name kept');
eq(sameDeal({ target: 'Stake in BMG Unit', date: '2026-09-17' }, { target: 'stake in BMG music rights', date: '2026-09-17' }), true, 'BMG worded two ways is one deal');
eq(sameDeal({ target: 'Acme Logistics', date: '2026-09-10' }, { target: 'Acme Logistics Inc', date: '2026-09-15' }), true, 'a few days apart is still one deal');
eq(sameDeal({ target: 'Acme Logistics', date: '2026-08-01' }, { target: 'Acme Logistics', date: '2026-09-15' }), false, 'weeks apart is a second deal');
eq(sameDeal({ target: 'Acme Logistics', date: '2026-09-15' }, { target: 'Beta Logistics', date: '2026-09-15' }), false, 'a shared generic word is not enough');
eq(sameDeal({ target: 'a stake', date: '2026-09-15' }, { target: 'the stake', date: '2026-09-15' }), false, 'nothing distinctive matches only itself');

{
  const merged = dedupeDeals([
    { target: 'Stake in BMG Unit', announcedOn: '2026-09-17', value: '' },
    { target: 'stake in BMG music rights', announcedOn: '2026-09-17', value: '$1.25B' },
    { target: 'Acme', announcedOn: '2026-09-17' },
  ]);
  eq(merged.map(d => [d.target, d.value || '']), [['Stake in BMG Unit', '$1.25B'], ['Acme', '']], 'first report kept, the value filled from the second');
}

// The digest: the two BMG headlines come out as one deal.
{
  const items = [
    ['Apollo Provides $1.25 Billion to Support BMG, Concord Merger; Acquires Stake in BMG Unit - marketscreener.com', '2026-09-17'],
    ['Apollo acquires stake in BMG music rights for $1.25 billion By Investing.com - Investing.com India', '2026-09-17'],
  ].map(([title, d]) => ({ title, publishedAt: Date.parse(d), link: 'https://example.com', source: 'S' }));
  const out = classifyByRules({ company: 'Apollo Global Management', isPe: true }, items);
  eq(out.deals.length, 1, 'digest: one BMG deal, not two');
}

// The log: a deal already there under other wording is not added again.
{
  const log = [{ id: 't1', asset: 'Stake in BMG Unit', date: '2026-09-17' }];
  const { added } = mergeDealsIntoLog(log, [
    { target: 'stake in BMG music rights', announcedOn: '2026-09-19', buyer: 'Apollo' },
    { target: 'Acme Logistics', announcedOn: '2026-09-19', buyer: 'Apollo' },
  ], 'Apollo Global Management');
  eq(added, 1, 'log: the reworded BMG deal is skipped, the new one added');
  const { rows } = mergeDealsIntoLog([], [{ target: 'Acme', announcedOn: '2026-09-19', buyer: 'Apollo' }], 'Apollo Global Management');
  eq(rows[0].entity, '', 'log: "Apollo" for Apollo Global Management leaves Through blank');
}

console.log(`${failed ? 'FAIL' : 'PASS'}  dealDedupe: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
