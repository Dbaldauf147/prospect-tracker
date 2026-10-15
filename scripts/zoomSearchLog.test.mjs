// Assertion tests for the Zoom Search Log's parsing and roll-up.
//   node scripts/zoomSearchLog.test.mjs
import {
  splitPastedTable, parseZoomPaste, splitTitles, readLog, makeSearch, companyLog, buildProspectMatcher, cleanZoomId,
} from '../src/utils/zoomSearchLog.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.log(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}

// --- pasted table --------------------------------------------------------
check('tabs split cells, blank lines dropped',
  splitPastedTable('a\tb\n\n1\t2\n'), [['a', 'b'], ['1', '2']]);
check('quoted cell keeps its tab and line break',
  splitPastedTable('a\tb\n"x\ty\nz"\t2'), [['a', 'b'], ['x\ty\nz', '2']]);
check('csv when there is no tab', splitPastedTable('a,b\n"1,5",2'), [['a', 'b'], ['1,5', '2']]);
check('excel number formatting on an id', cleanZoomId('1113193043.0'), '1113193043');
check('a non-number is not an id', cleanZoomId('n/a'), '');

// --- ZoomInfo export ------------------------------------------------------
{
  const text = [
    'ZoomInfo Contact ID\tFirst Name\tJob Title\tZoomInfo Company ID\tCompany Name\tWebsite',
    '1\tAnn\tVP Sustainability\t1113193043\tAmerican Homes 4 Rent\twww.ah4r.com',
    '2\tBob\tDirector, Energy\t1113193043\tAmerican Homes 4 Rent\t',
    '3\tCy\tVP Sustainability\t1113193043\tAmerican Homes 4 Rent\t',
    '4\tDee\tCFO\t6065973\tAmeriprise Financial\twww.ameriprise.com',
    '5\tEd\tCFO\t\tNo Id Co\t',
  ].join('\n');
  const out = parseZoomPaste(text);
  check('one entry per company, contacts counted', out.companies.map(c => [c.name, c.zoomId, c.contacts]),
    [['American Homes 4 Rent', '1113193043', 3], ['Ameriprise Financial', '6065973', 1], ['No Id Co', '', 1]]);
  check('titles collected once each', out.companies[0].titles, ['VP Sustainability', 'Director, Energy']);
  check('first non-empty website kept', out.companies[0].website, 'www.ah4r.com');
  check('contact total', out.contactCount, 5);
  check('no error', out.error, '');
}
check('header with no company column is refused',
  parseZoomPaste('First Name\tLast Name\nA\tB').error !== '', true);
check('header only is refused', parseZoomPaste('ZoomInfo Company ID').companies, []);
check('a company-only export (no titles) parses',
  parseZoomPaste('Company ID\tCompany Name\n81166904\tSilver Lake').companies.map(c => c.zoomId), ['81166904']);

// --- titles ---------------------------------------------------------------
check('titles split on lines and commas, deduped',
  splitTitles('CFO, Controller\ncfo\n\nVP Finance'), ['CFO', 'Controller', 'VP Finance']);

// --- stored log -----------------------------------------------------------
check('bad storage reads as empty', readLog('not json'), { searches: [] });
check('missing storage reads as empty', readLog(null), { searches: [] });
check('company search drops tag and titles',
  makeSearch({ id: 'a', type: 'company', date: '2026-10-01', tag: 'ESG', titles: ['x'], companies: [{ zoomId: '1.0', name: 'A', website: 'w' }] }),
  { id: 'a', type: 'company', date: '2026-10-01', tag: '', titles: [], companies: [{ zoomId: '1', name: 'A' }], contacts: 0, note: '' });

{
  const searches = [
    makeSearch({ id: '1', type: 'company', date: '2026-10-01', companies: [{ zoomId: '7', name: 'URW' }, { zoomId: '', name: 'Acme Inc' }] }),
    makeSearch({ id: '2', type: 'title', date: '2026-10-05', tag: 'Capital Planning', titles: ['VP Capital Planning'], companies: [{ zoomId: '7', name: 'URW' }] }),
    makeSearch({ id: '3', type: 'company', date: '2026-10-09', companies: [{ zoomId: '7', name: 'URW' }] }),
    makeSearch({ id: '4', type: 'title', date: '2026-10-02', tag: 'ESG', titles: ['CSO'], companies: [{ name: 'Acme' }] }),
  ];
  const rows = companyLog(searches);
  check('one row per company, name-only ones matched by name', rows.map(r => r.name), ['Acme', 'URW']);
  check('company searches newest first', rows[1].companySearches, ['2026-10-09', '2026-10-01']);
  check('title searches carry tag and titles', rows[1].titleSearches, [{ tag: 'Capital Planning', titles: ['VP Capital Planning'], date: '2026-10-05' }]);
  check('name-only company keeps both kinds', [rows[0].companySearches, rows[0].titleSearches.map(t => t.tag)], [['2026-10-01'], ['ESG']]);
}

// --- Table View match -----------------------------------------------------
{
  const match = buildProspectMatcher([
    { id: 'p1', company: 'Unibail-Rodamco-Westfield', zoomCompanyId: '7' },
    { id: 'p2', company: 'Kilroy Realty', zoomCompanyId: '' },
    { id: 'p3', company: 'Other', zoomCompanyName: 'Silver Lake Partners' },
  ]);
  check('by zoom id first', match({ zoomId: '7', name: 'URW' })?.id, 'p1');
  check('by name with corporate suffix set aside', match({ zoomId: '99', name: 'Kilroy Realty Corp' })?.id, 'p2');
  check('by the zoom company name', match({ name: 'Silver Lake Partners' })?.id, 'p3');
  check('no match is null', match({ zoomId: '5', name: 'Nobody' }), null);
}

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
