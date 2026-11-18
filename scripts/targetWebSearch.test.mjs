// Assertion tests for the Targets tab's "Search web" menu: the company-name
// cleaning, the domain, and the Google links built from
// config/targetWebSearches. Plain Node, no framework. Run:
//   node scripts/targetWebSearch.test.mjs
import { cleanSearchName, bareDomain, googleSearchUrl, fillSearchTemplate, buildTargetSearchLinks, targetResearchPrompt } from '../src/utils/targetWebSearch.js';
import { TARGET_WEB_SEARCHES, TARGET_RESEARCH_PROMPT } from '../src/config/targetWebSearches.js';

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
  const by = label => items.find(i => i.label === label);
  check('links: labels in order, AI chats first, divider before the dashboard', items.map(i => i.label || '---'), [
    'Ask ChatGPT for a targets table (free)', 'Ask Claude for a targets table (free)', '---',
    'All targets', 'SBTi status', 'Sustainability report (PDF)', 'On their website', 'CRREM / real estate pathway',
    'GRESB', 'CDP', 'TCFD / climate risk', 'RE100 / renewable electricity', '---', 'SBTi Target Dashboard',
  ]);
  check('links: all targets query', q(by('All targets').href), '"Prologis" net zero OR emissions reduction target scope 1 2 3 base year');
  check('links: website query', q(by('On their website').href), 'site:prologis.com sustainability OR ESG OR "net zero"');
  check('links: dashboard is the fixed URL', by('SBTi Target Dashboard').href, 'https://sciencebasedtargets.org/target-dashboard');
  // The free AI chats: the whole research prompt, prefilled.
  const gpt = new URL(by('Ask ChatGPT for a targets table (free)').href);
  const claude = new URL(by('Ask Claude for a targets table (free)').href);
  const prompt = targetResearchPrompt({ name: 'Prologis', domain: 'prologis.com' });
  check('ai: ChatGPT opens with web search on and the prompt typed in', [gpt.origin + gpt.pathname, gpt.searchParams.get('hints'), gpt.searchParams.get('q') === prompt], ['https://chatgpt.com/', 'search', true]);
  check('ai: Claude opens a new chat with the same prompt', [claude.origin + claude.pathname, claude.searchParams.get('q') === prompt], ['https://claude.ai/new', true]);
  check('ai: prompt names the company and its site, no placeholders left', [prompt.startsWith('Search the web for the climate and energy targets that Prologis (website: prologis.com) has publicly set.'), /\{\w+\}/.test(prompt)], [true, false]);
  check('ai: no website, no site note', targetResearchPrompt({ name: 'Acme', domain: '' }).includes('that Acme has publicly set'), true);
  check('ai: links stay short enough for a browser address bar', gpt.href.length < 4000, true);
  check('links: every search is google', items.filter(i => i.href && i.label !== 'SBTi Target Dashboard' && !i.label.startsWith('Ask ')).every(i => i.href.startsWith('https://www.google.com/search?q=')), true);
}
{
  const items = buildTargetSearchLinks({ company: 'Macy\'s, Inc.' });
  check('links: no website, no website search', items.some(i => i.label === 'On their website'), false);
  check('links: apostrophe kept in the query', q(items.find(i => i.label === 'SBTi status').href), '"Macy\'s" SBTi science based targets validated OR committed');
  check('links: email domain stands in for the website', buildTargetSearchLinks({ company: 'TIAA', emailDomain: 'tiaa.org' }).some(i => i.label === 'On their website'), true);
}
check('links: no company, no items', buildTargetSearchLinks({ company: '  ' }), []);
check('links: dividers never lead, trail or double', buildTargetSearchLinks({ company: 'A' }, [
  { divider: true }, { label: 'x', query: '{name}' }, { divider: true }, { divider: true }, { label: 'y', query: 'site:{domain}', requiresDomain: true }, { divider: true },
]).map(i => i.label || '---'), ['x']);
check('config: every entry is a search, a link or a divider', TARGET_WEB_SEARCHES.every(s => s.divider || (s.label && (s.query || s.url || s.ai))), true);

// The prompt's header row is one Paste targets reads: every column but
// Source maps onto a field.
{
  const { parsePastedTargets } = await import('../src/utils/companyTargets.js');
  const header = TARGET_RESEARCH_PROMPT.split('\n').find(l => l.startsWith('Action |'));
  const answer = ['```', header,
    'Target | Net zero | | 2021 | 2019 | 2050 | | 1, 2 | | Self-declared | | https://example.com/esg',
    'Commitment | | Net-zero | | | | | | | Committed | 2024-04-25 | https://sciencebasedtargets.org/target-dashboard',
    'Target | SBTi near-term | | 2023 | 2020 | 2030 | 2035 | 1, 2, 3 | 1.5°C | Validated Targets | 2023-06-01 | x',
    '```'].join('\n');
  const { rows } = parsePastedTargets(answer);
  const pick = r => [r.action, r.type, r.commitmentType, r.yearSet, r.baseYear, r.targetYear1, r.targetYear2, r.scope1, r.scope2, r.scope3, r.classification, r.status, r.datePublished];
  check('ai answer: Source column becomes the link', rows.map(r => r.sourceUrl), ['https://example.com/esg', 'https://sciencebasedtargets.org/target-dashboard', '']);
  check('ai answer: read by Paste targets, column for column', rows.map(pick), [
    ['Target', 'Net zero', '', '2021', '2019', '2050', '', true, true, false, '', 'Self-declared', ''],
    ['Commitment', 'SBTi commitment', 'Net-zero', '2024', '', '', '', false, false, false, '', 'Committed', '2024-04-25'],
    ['Target', 'SBTi near-term', '', '2023', '2020', '2030', '2035', true, true, true, '1.5°C', 'Validated Targets', '2023-06-01'],
  ]);
  // As a rendered markdown table copied back out, and with no fence.
  const md = ['| Action | Target Type | Base Year | Target Year | Scope |', '|---|---|:--:|---|---|', '| Target | Net-zero | 2019 | 2050 | 1, 2 |'].join('\n');
  check('ai answer: markdown table with a rule row', parsePastedTargets(md).rows.map(r => [r.type, r.baseYear, r.targetYear1, r.scope1, r.scope3]), [['Net zero', '2019', '2050', true, false]]);
  const none = parsePastedTargets([header, '- | No target set'].join('\n')).rows;
  check('ai answer: no target set', none.map(r => [r.action, r.type]), [['', 'No target set']]);
  check('prose with a stray pipe is still read as prose', parsePastedTargets('Realterm aims to achieve net-zero Scope 1 and Scope 2 emissions by 2050 | source').rows.map(r => [r.type, r.targetYear1]), [['Net zero', '2050']]);
}

if (failures) { console.log(`\n${failures} failure(s)`); process.exit(1); }
console.log('All target web search tests passed.');
