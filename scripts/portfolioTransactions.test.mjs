// Assertion tests for the Portfolio tab's Acquisitions & Dispositions log:
// reading deals back out of text copied from the weekly acquisition-news
// digest, and the ordering and counts the page shows.
// Plain Node - no test framework (the project has none). Run:
//   node scripts/portfolioTransactions.test.mjs
import {
  parseDigestText, sortTransactions, summarizeTransactions, transactionKey, blankTransaction,
} from '../src/utils/portfolioTransactions.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed += 1; } else { failed += 1; console.error(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}

// ── a copied digest: header, a company heading, two deals ────────────────
{
  const text = [
    'Company Acquisition News',
    'Blackstone',
    '2026-09-21\tAcme Services',
    'Add-on · Industrial Services · $120M · 14 sites',
    'Buyer: Tilt Holdings',
    'Tilt buys Acme to grow its Midwest footprint.',
    'Business Wire →',
    'KKR',
    '2026-09-18',
    'Beta Logistics',
    'Reuters →',
    'Companies are tracked by ticking the box.',
  ].join('\n');
  const links = [{ text: 'Business Wire →', href: 'https://example.com/acme' }];
  const deals = parseDigestText(text, links);
  eq(deals.length, 2, 'two deals, header and footer skipped');
  eq(deals[0].asset, 'Acme Services', 'target read off the line after the date (tab-separated too)');
  eq([deals[0].dealType, deals[0].sector, deals[0].value, deals[0].sites], ['Add-on', 'Industrial Services', '$120M', '14'], 'meta line split into its parts');
  eq(deals[0].entity, 'Tilt Holdings', 'Buyer line becomes the entity on our side');
  eq(deals[0].notes, 'Tilt buys Acme to grow its Midwest footprint.', 'summary kept as notes');
  eq([deals[0].sourceTitle, deals[0].sourceUrl], ['Business Wire', 'https://example.com/acme'], 'source matched back to its link');
  eq(deals[1].asset, 'Beta Logistics', 'a deal with nothing but a target and a source');
  eq([deals[1].dealType, deals[1].notes, deals[1].sourceUrl], ['', '', ''], 'and nothing invented for it');
  eq(deals.every(d => d.kind === 'Acquisition'), true, 'digest deals come in as acquisitions');
}

// ── meta pieces recognised by shape, not position ────────────────────────
{
  const [d] = parseDigestText('2026-01-02\nX Corp\nPlatform · $1.2bn\nWhy it matters.');
  eq([d.dealType, d.value, d.sector, d.notes], ['Platform', '$1.2bn', '', 'Why it matters.'], 'missing sector and sites are left blank');
}
eq(parseDigestText('no dates in here\njust words'), [], 'text with no date lines yields nothing');
eq(parseDigestText('2026-01-02\nX Corp\nReuters →', [{ text: 'Reuters', href: 'javascript:alert(1)' }])[0].sourceUrl, '', 'a non-http link is not carried over');

// ── ordering and counts ──────────────────────────────────────────────────
{
  const rows = [
    { id: 'a', kind: 'Acquisition', date: '2025-01-01', loggedAt: 1 },
    { id: 'b', kind: 'Disposition', date: '2026-09-01', loggedAt: 2 },
    { id: 'c', kind: 'Acquisition', date: '', loggedAt: 3 },
    { id: 'd', kind: 'Acquisition', date: '2026-06-01', loggedAt: 4 },
  ];
  eq(sortTransactions(rows).map(r => r.id), ['b', 'd', 'a', 'c'], 'newest first, undated last');
  eq(summarizeTransactions(rows, new Date('2026-09-28T12:00:00').getTime()),
    { acquisitions: 3, dispositions: 1, recentAcquisitions: 1, recentDispositions: 1 }, 'totals and last-12-month counts');
  eq(transactionKey({ asset: ' Acme ', date: '2026-01-01' }), transactionKey({ asset: 'acme', date: '2026-01-01' }), 'duplicate key ignores case and spacing');
  eq(blankTransaction('Disposition').kind, 'Disposition', 'blank row takes the kind asked for');
  eq(blankTransaction('Nonsense').kind, 'Acquisition', 'and falls back to Acquisition');
}

console.log(`${failed ? 'FAIL' : 'PASS'}  portfolioTransactions: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
