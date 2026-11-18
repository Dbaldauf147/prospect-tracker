// Assertion tests for the Targets tab's "Search web" menu: the company-name
// cleaning, the domain, and the Google links built from
// config/targetWebSearches. Plain Node, no framework. Run:
//   node scripts/targetWebSearch.test.mjs
import { cleanSearchName, bareDomain, googleSearchUrl, fillSearchTemplate, buildTargetSearchLinks } from '../src/utils/targetWebSearch.js';
import { TARGET_WEB_SEARCHES } from '../src/config/targetWebSearches.js';

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n      got:  ${JSON.stringify(actual)}\n      want: ${JSON.stringify(expected)}`}`);
}

// Name cleaning.
const names = [
  ['Prologis', 'Prologis'],
  ['Prologis, Inc.', 'Prologis'],
  ['Prologis Inc', 'Prologis'],
  ['Acme LLC', 'Acme'],
  ['Acme Ltd.', 'Acme'],
  ['Simon Property Group, L.P.', 'Simon Property Group'],
  ['Foo Co., Ltd.', 'Foo'],
  ['Unibail-Rodamco-Westfield SE', 'Unibail-Rodamco-Westfield SE'],
  ['Vonovia SE', 'Vonovia SE'],
  ['Klépierre S.A.', 'Klépierre'],
  ['Allianz AG', 'Allianz'],
  ['Heineken N.V.', 'Heineken'],
  ['Landsec plc', 'Landsec'],
  ['Kimco Realty Corporation', 'Kimco Realty'],
  ['Ventas Corp.', 'Ventas'],
  ['Goldman Sachs & Co.', 'Goldman Sachs'],
  ['AT&T Inc.', 'AT&T'],
  ['Macy\'s, Inc.', 'Macy\'s'],
  ['Jones Lang LaSalle (JLL)', 'Jones Lang LaSalle'],
  ['Société Générale SA', 'Société Générale'],
  ['  Extra   Space   Storage Inc.  ', 'Extra Space Storage'],
  ['The "Best" Company Inc', 'The Best Company'],
  ['Corp', 'Corp'],
  ['Costco', 'Costco'],
  ['Coca-Cola Co', 'Coca-Cola'],
  ['', ''],
  [null, ''],
];
for (const [raw, want] of names) check(`name: ${JSON.stringify(raw)}`, cleanSearchName(raw), want);

// Domain.
check('domain: full URL', bareDomain('https://www.prologis.com/about-us?x=1'), 'prologis.com');
check('domain: bare www', bareDomain('www.simon.com'), 'simon.com');
check('domain: no protocol, path', bareDomain('jll.com/en-us'), 'jll.com');
check('domain: email domain', bareDomain('@tiaa.org'), 'tiaa.org');
check('domain: subdomain kept', bareDomain('http://investors.acme.co.uk/'), 'investors.acme.co.uk');
check('domain: junk', [bareDomain('not a site'), bareDomain(''), bareDomain(undefined)], ['', '', '']);

// URL builder: the query is encoded whole, so &, apostrophes, quotes and
// non-ASCII survive the round trip.
const roundTrip = q => new URL(googleSearchUrl(q)).searchParams.get('q');
for (const q of ['"AT&T" net zero', '"Macy\'s" SBTi', '"Klépierre" CDP climate score', '"Société Générale" ESG', '"東急不動産" net zero', 'site:a.com "net zero" OR ESG']) {
  check(`url: round trip ${q}`, roundTrip(q), q);
}
check('url: & does not start a new parameter', [...new URL(googleSearchUrl('"AT&T" x=1')).searchParams.keys()], ['q']);
check('url: exact encoding', googleSearchUrl('"AT&T" Macy\'s é'), 'https://www.google.com/search?q=%22AT%26T%22%20Macy\'s%20%C3%A9');
check('template: name quoted, domain filled', fillSearchTemplate('{name} on site:{domain}', { name: 'AT&T', domain: 'att.com' }), '"AT&T" on site:att.com');

// The menu items.
const q = href => new URL(href).searchParams.get('q');
{
  const items = buildTargetSearchLinks({ company: 'Prologis, Inc.', website: 'https://www.prologis.com' });
  check('links: labels in order, divider before the dashboard', items.map(i => i.label || '---'), [
    'All targets', 'SBTi status', 'Sustainability report (PDF)', 'On their website', 'CRREM / real estate pathway',
    'GRESB', 'CDP', 'TCFD / climate risk', 'RE100 / renewable electricity', '---', 'SBTi Target Dashboard',
  ]);
  check('links: all targets query', q(items[0].href), '"Prologis" net zero OR emissions reduction target scope 1 2 3 base year');
  check('links: website query', q(items[3].href), 'site:prologis.com sustainability OR ESG OR "net zero"');
  check('links: dashboard is the fixed URL', items[10].href, 'https://sciencebasedtargets.org/target-dashboard');
  check('links: every search is google', items.filter(i => i.href && i.label !== 'SBTi Target Dashboard').every(i => i.href.startsWith('https://www.google.com/search?q=')), true);
}
{
  const items = buildTargetSearchLinks({ company: 'Macy\'s, Inc.' });
  check('links: no website, no website search', items.some(i => i.label === 'On their website'), false);
  check('links: apostrophe kept in the query', q(items[1].href), '"Macy\'s" SBTi science based targets validated OR committed');
  check('links: email domain stands in for the website', buildTargetSearchLinks({ company: 'TIAA', emailDomain: 'tiaa.org' }).some(i => i.label === 'On their website'), true);
}
check('links: no company, no items', buildTargetSearchLinks({ company: '  ' }), []);
check('links: dividers never lead, trail or double', buildTargetSearchLinks({ company: 'A' }, [
  { divider: true }, { label: 'x', query: '{name}' }, { divider: true }, { divider: true }, { label: 'y', query: 'site:{domain}', requiresDomain: true }, { divider: true },
]).map(i => i.label || '---'), ['x']);
check('config: every entry is a search, a link or a divider', TARGET_WEB_SEARCHES.every(s => s.divider || (s.label && (s.query || s.url))), true);

if (failures) { console.log(`\n${failures} failure(s)`); process.exit(1); }
console.log('All target web search tests passed.');
