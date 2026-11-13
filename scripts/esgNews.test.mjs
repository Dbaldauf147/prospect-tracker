// Assertion tests for Prospecting > News (utils/esgNews). Plain Node. Run:
//   node scripts/esgNews.test.mjs
import { normalizeFilters, normalizeRoundup, parseInline, parseRoundupMarkdown, MAX_FILTER_LENGTH } from '../src/utils/esgNews.js';

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n      got:  ${JSON.stringify(actual)}\n      want: ${JSON.stringify(expected)}`}`);
}

check('filters: trimmed, blanks and case duplicates dropped, order kept',
  normalizeFilters(['  Sponsored ', '', 'webinars', 'sponsored', null, 'SAF  deals']),
  ['Sponsored', 'webinars', 'SAF deals']);
check('filters: not an array is empty', normalizeFilters('x'), []);
check('filters: long entry capped', normalizeFilters(['a'.repeat(500)])[0].length, MAX_FILTER_LENGTH);

const at = '2026-11-13T12:00:00.000Z';
check('roundup: bad date refused', normalizeRoundup({ date: 'Nov 13', markdown: 'x' }).error, 'date must be YYYY-MM-DD');
check('roundup: empty markdown refused', normalizeRoundup({ date: '2026-11-13', markdown: '  ' }).error, 'markdown is required');
check('roundup: defaults the title, keeps an https doc link', normalizeRoundup({ date: '2026-11-13', markdown: '# Hi', docUrl: 'https://docs.google.com/x' }, at).roundup,
  { date: '2026-11-13', title: 'ESG News Roundup - 2026-11-13', markdown: '# Hi', docUrl: 'https://docs.google.com/x', receivedAt: at });
check('roundup: a non-https doc link is dropped', normalizeRoundup({ date: '2026-11-13', markdown: 'x', docUrl: 'javascript:alert(1)' }, at).roundup.docUrl, '');

check('inline: bold and links', parseInline('A **big** deal [Article](https://x.com/a) end'),
  [{ text: 'A ' }, { text: 'big', bold: true }, { text: ' deal ' }, { text: 'Article', href: 'https://x.com/a' }, { text: ' end' }]);
check('inline: a non-http link stays text', parseInline('[x](javascript:alert(1))'), [{ text: '[x](javascript:alert(1))' }]);

const md = [
  '# ESG News Roundup', '', 'Covering the update', 'of Nov 12.', '',
  '## 1. Reporting', '1. First', '2. Second', '* Bullet a', '* Bullet b', 'After',
].join('\n');
check('markdown: blocks', parseRoundupMarkdown(md), [
  { type: 'heading', level: 1, text: 'ESG News Roundup' },
  { type: 'para', text: 'Covering the update of Nov 12.' },
  { type: 'heading', level: 2, text: '1. Reporting' },
  { type: 'list', ordered: true, items: ['First', 'Second'] },
  { type: 'list', ordered: false, items: ['Bullet a', 'Bullet b'] },
  { type: 'para', text: 'After' },
]);

if (failures) { console.log(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nAll passed');
