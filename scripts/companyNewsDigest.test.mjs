// Assertion tests for the acquisition-news digest's scheduling behaviour.
// Plain Node — no test framework (the project has none). Run:
//   node scripts/companyNewsDigest.test.mjs
//
// The bug these guard against produced a *plausible-looking* email every
// week: "0 acquisitions across 0 of 21 tracked companies". Nothing in it
// said that only one company had actually been searched, or that it was
// the same company every single time. Three ways that can come back:
//
//   - researchAll going sequential again, so one slow firm eats the whole
//     budget and everyone after it is reported as "not searched";
//   - the rotation cursor not advancing (or advancing past companies that
//     were never searched), stranding the tail of the list forever;
//   - the email collapsing "found nothing", "search failed" and "never
//     searched" back into one indistinguishable line.
import {
  classifyByRules,
  classifierMode,
  researchCompanyAcquisitions,
  researchAll,
  rotateForRun,
  nextCursor,
  buildNewsEmailHtml,
  digestWindow,
  dealsFromHeadlines,
  haltReasonFor,
  ResearchHaltedError,
} from '../api/_lib/companyNews.js';
import {
  nameVariants,
  feedQuery,
  siteQuery,
  hostOf,
  parseRssItems,
  fetchHeadlines,
  mentionsCompany,
} from '../api/_lib/newsFeeds.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}
function ok(cond, name) { eq(!!cond, true, name); }

const firms = (n) => Array.from({ length: n }, (_, i) => ({
  company: `Firm ${String(i).padStart(2, '0')}`,
  isPe: true,
}));

// A stand-in for one Claude web-search pass: takes `ms`, and honours the
// abort signal the way a real aborted fetch does.
const stubResearch = (ms, deals = () => []) => (entry, since, until, { signal } = {}) =>
  new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ deals: deals(entry), error: null }), ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve({ deals: [], error: 'Research timed out' });
    });
  });

// ---- Concurrency ---------------------------------------------------------
{
  // 8 companies, 100ms each, 1s budget. Sequential would manage ~8 but the
  // point is the pool: with concurrency 4 this finishes in ~2 rounds.
  const started = [];
  const t0 = Date.now();
  const results = await researchAll(firms(8), 0, 0, {
    budgetMs: 60_000,
    concurrency: 4,
    research: (entry, ...rest) => { started.push(entry.company); return stubResearch(100)(entry, ...rest); },
  });
  const elapsed = Date.now() - t0;

  eq(results.length, 8, 'concurrency: every company gets a result slot');
  eq(results.filter((r) => r.skipped).length, 0, 'concurrency: nothing skipped inside a generous budget');
  ok(elapsed < 400, `concurrency: 8×100ms finishes in ~2 rounds, not 8 (took ${elapsed}ms)`);
  eq(results.map((r) => r.company), firms(8).map((f) => f.company), 'concurrency: results stay in list order');
}

{
  // Results must land at the right index even when workers finish out of
  // order — a push()-based pool would scramble these.
  const results = await researchAll(firms(6), 0, 0, {
    budgetMs: 60_000,
    concurrency: 3,
    research: (entry, ...rest) => {
      const slow = entry.company.endsWith('00') ? 200 : 10;
      return stubResearch(slow)(entry, ...rest);
    },
  });
  eq(results.map((r) => r.company), firms(6).map((f) => f.company), 'concurrency: out-of-order completion keeps indices');
}

{
  // The per-company cap is what stops one firm consuming a whole run. With
  // a 60s budget and a company that never returns, the abort must still
  // fire — here via a budget shorter than the stub's runtime.
  const results = await researchAll(firms(2), 0, 0, {
    budgetMs: 9_000,
    concurrency: 1,
    research: stubResearch(60_000),
  });
  eq(results[0].error, 'Research timed out', 'per-company cap: a hung search is aborted, not left to run');
}

{
  // Below MIN_SLICE_MS nothing new is started — those companies are marked
  // skipped rather than launched into a search that cannot finish.
  const results = await researchAll(firms(5), 0, 0, {
    budgetMs: 5_000,
    concurrency: 1,
    research: stubResearch(10),
  });
  eq(results.every((r) => r.skipped), true, 'budget: too little time left means skipped, not attempted');
  eq(results.every((r) => r.error === null), true, 'budget: a skipped company is not an error');
}

// ---- Rotation ------------------------------------------------------------
{
  const names = (list) => list.map((f) => f.company);
  eq(names(rotateForRun(firms(4), 0)), ['Firm 00', 'Firm 01', 'Firm 02', 'Firm 03'], 'rotate: cursor 0 is the plain list');
  eq(names(rotateForRun(firms(4), 2)), ['Firm 02', 'Firm 03', 'Firm 00', 'Firm 01'], 'rotate: cursor 2 wraps around');
  eq(names(rotateForRun(firms(4), 4)), ['Firm 00', 'Firm 01', 'Firm 02', 'Firm 03'], 'rotate: a full lap is cursor 0');
  eq(names(rotateForRun(firms(4), 6)), ['Firm 02', 'Firm 03', 'Firm 00', 'Firm 01'], 'rotate: cursor past the end wraps');
  eq(rotateForRun([], 3), [], 'rotate: an empty list stays empty');
  eq(names(rotateForRun(firms(3), undefined)), ['Firm 00', 'Firm 01', 'Firm 02'], 'rotate: a missing cursor starts at 0');
  eq(names(rotateForRun(firms(3), -1)), ['Firm 00', 'Firm 01', 'Firm 02'], 'rotate: a junk cursor starts at 0');
}

{
  const res = (n, skippedFrom) => Array.from({ length: n }, (_, i) => ({ skipped: i >= skippedFrom }));
  eq(nextCursor(0, res(21, 12)), 12, 'cursor: advances by the number actually searched');
  eq(nextCursor(12, res(21, 9)), 0, 'cursor: wraps exactly at the end of the list');
  eq(nextCursor(18, res(21, 6)), 3, 'cursor: wraps past the end');
  eq(nextCursor(0, res(21, 21)), 0, 'cursor: a full sweep returns to the start');
  eq(nextCursor(7, res(21, 0)), 7, 'cursor: a run that searched nothing does not advance');
  eq(nextCursor(5, []), 0, 'cursor: no companies means no cursor');
}

{
  // The whole point, end to end: three short runs must cover all 7 firms,
  // not re-search the first 3 forever.
  const seen = new Set();
  let cursor = 0;
  const all = firms(7);
  for (let run = 0; run < 3; run++) {
    const ordered = rotateForRun(all, cursor);
    const results = ordered.map((f, i) => ({ ...f, skipped: i >= 3 }));
    results.filter((r) => !r.skipped).forEach((r) => seen.add(r.company));
    cursor = nextCursor(cursor, results);
  }
  eq([...seen].sort(), all.map((f) => f.company), 'rotation: three partial runs cover the whole list');
}

// ---- The digest window ---------------------------------------------------
// A deal only lands if web search has indexed it, and indexing lags the
// announcement by days. A window that started exactly where the last one
// ended meant a late-indexed deal fell between two digests and was never
// seen by either — so every window now reaches back at least 14 days, and
// consecutive digests deliberately overlap.
{
  const DAY = 24 * 60 * 60 * 1000;
  const now = Date.parse('2026-09-08T00:00:00Z');
  const days = (w) => Math.round((w.until - w.since) / DAY);

  eq(days(digestWindow(null, now)), 14, 'window: a first run looks back 14 days');
  eq(days(digestWindow(0, now)), 14, 'window: a never-sent schedule looks back 14 days');
  eq(days(digestWindow(now - 7 * DAY, now)), 14, 'window: a weekly schedule is widened to 14 days');
  eq(days(digestWindow(now - 1 * DAY, now)), 14, 'window: a daily schedule is widened to 14 days');
  eq(days(digestWindow(now - 30 * DAY, now)), 30, 'window: a longer gap keeps its own anchor');
  eq(days(digestWindow(now - 365 * DAY, now)), 60, 'window: a long-paused schedule is still capped at 60 days');
  eq(digestWindow(now - 7 * DAY, now).until, now, 'window: always ends now');

  // Consecutive weekly runs must overlap — that overlap is the whole point.
  const first = digestWindow(now - 7 * DAY, now);
  const second = digestWindow(now, now + 7 * DAY);
  ok(second.since < first.until, 'window: consecutive weekly digests overlap rather than abut');

  // A typed test lookback is taken literally, not widened.
  eq(days(digestWindow(now - 3 * DAY, now, { minLookbackDays: 3 })), 3, 'window: an explicit 3-day test lookback stays 3 days');
  eq(days(digestWindow(now - 7 * DAY, now, { minLookbackDays: 0 })), 7, 'window: a zero minimum honours the anchor exactly');
  eq(days(digestWindow(now - 7 * DAY, now, { minLookbackDays: NaN })), 14, 'window: a junk minimum falls back to the default');
}

// ---- Email copy ----------------------------------------------------------
{
  const results = [
    { company: 'Quiet Co', isPe: true, deals: [], error: null, skipped: false },
    { company: 'Broken Co', isPe: true, deals: [], error: 'Research timed out', skipped: false },
    { company: 'Unreached Co', isPe: true, deals: [], error: null, skipped: true },
  ];
  const html = buildNewsEmailHtml(results, { since: 0, until: 86_400_000 });

  ok(html.includes('No acquisitions found (1)'), 'email: searched-and-empty gets its own count');
  ok(html.includes('Search failed (1)'), 'email: a failure is not filed under "no acquisitions found"');
  ok(html.includes('Research timed out'), 'email: the failure reason is actually printed');
  ok(html.includes('Not searched this run'), 'email: unreached companies are called out');
  ok(html.includes('2 companies searched'), 'email: the header counts searched companies, not tracked ones');
  ok(html.includes('(3 tracked)'), 'email: the header still says how many are tracked');
  ok(html.includes('this run reached'), 'email: an empty digest says it did not cover everything');
}

{
  // A full sweep should not nag about partial coverage.
  const results = [
    { company: 'Quiet Co', isPe: true, deals: [], error: null, skipped: false },
    { company: 'Also Quiet', isPe: true, deals: [], error: null, skipped: false },
  ];
  const html = buildNewsEmailHtml(results, { since: 0, until: 86_400_000 });
  ok(!html.includes('tracked)'), 'email: a full sweep drops the "(n tracked)" caveat');
  ok(!html.includes('this run reached'), 'email: a full sweep does not claim partial coverage');
  ok(!html.includes('Not searched'), 'email: a full sweep has no "not searched" block');
}

{
  // Error text is company-controlled only in the sense that it echoes an API
  // response — escape it anyway.
  const results = [{ company: 'X<script>', isPe: false, deals: [], error: '<img onerror=1>', skipped: false }];
  const html = buildNewsEmailHtml(results, { since: 0, until: 1 });
  ok(!html.includes('<script>'), 'email: company names are escaped');
  ok(!html.includes('<img onerror'), 'email: error text is escaped');
}


// ---- Company names -------------------------------------------------------
// Tracked names are typed by hand and carry parentheticals. Searching the
// literal string finds nothing, because no headline writes it that way —
// and the acronym in the brackets is often the *only* way the press names
// the firm.
{
  eq(nameVariants('Blackstone'), ['Blackstone'], 'names: a plain name is left alone');
  eq(nameVariants('Clayton, Dubilier & Rice (CD&R)'),
    ['Clayton, Dubilier & Rice', 'CD&R'],
    'names: an acronym in brackets becomes a second search term');
  eq(nameVariants('Strategic Value Partners (SVP) Global'),
    ['Strategic Value Partners Global', 'SVP'],
    'names: a mid-name acronym is lifted out and the rest closes up');
  eq(nameVariants('TowerBrook Capital Partners (a Blue Owl co.)'),
    ['TowerBrook Capital Partners'],
    'names: a prose aside is dropped, not searched for');
  eq(nameVariants('Pritzker Private Capital (PPC)'),
    ['Pritzker Private Capital', 'PPC'], 'names: PPC is an alias');
  eq(nameVariants('  '), [], 'names: a blank company yields nothing');

  ok(feedQuery('Ara Partners').includes('"Ara Partners"'), 'query: the name is quoted');
  ok(feedQuery('Clayton, Dubilier & Rice (CD&R)').includes('"CD&R"'), 'query: the alias is searched too');
  eq(feedQuery(''), '', 'query: a blank company has no query');
}

{
  // Bing matches loosely, so an item has to actually name the company.
  const v = nameVariants('Berkshire Partners');
  ok(mentionsCompany('Berkshire Partners acquires Foo', v), 'match: an exact mention counts');
  ok(!mentionsCompany('Blackstone acquires Foo', v), 'match: an unrelated firm does not');
  // "Capital"/"Partners" are too common to carry a match on their own.
  ok(!mentionsCompany('Acme Partners buys Foo', v), 'match: a shared generic word is not a match');
  ok(mentionsCompany('CD&R to acquire Foo', nameVariants('Clayton, Dubilier & Rice (CD&R)')),
    'match: the alias matches on its own');
}

// ---- RSS parsing ---------------------------------------------------------
const RSS = `<?xml version="1.0"?><rss version="2.0"><channel>
  <item>
    <title>Blackstone to acquire Acme Facilities - Reuters</title>
    <link>https://example.com/a</link>
    <pubDate>Mon, 07 Sep 2026 12:00:00 GMT</pubDate>
    <source url="https://reuters.com">Reuters</source>
    <description>&lt;p&gt;Deal values Acme at &amp;pound;450m&lt;/p&gt;</description>
  </item>
  <item>
    <title><![CDATA[Blackstone names new CFO]]></title>
    <link>https://example.com/b</link>
    <pubDate>Tue, 08 Sep 2026 09:00:00 GMT</pubDate>
  </item>
  <item>
    <title>Undated item</title><link>https://example.com/c</link>
  </item>
</channel></rss>`;

{
  const items = parseRssItems(RSS);
  eq(items.length, 3, 'rss: every item is read');
  eq(items[0].title, 'Blackstone to acquire Acme Facilities - Reuters', 'rss: the title comes through');
  eq(items[0].source, 'Reuters', 'rss: <source> gives the publisher');
  eq(items[0].publishedAt, Date.parse('Mon, 07 Sep 2026 12:00:00 GMT'), 'rss: pubDate is parsed');
  eq(items[1].title, 'Blackstone names new CFO', 'rss: CDATA is unwrapped');
  eq(items[2].publishedAt, null, 'rss: a missing pubDate is null, not NaN or now');
  // Escaped markup in a description must not survive into the prompt.
  ok(!items[0].description.includes('<p>'), 'rss: escaped HTML is stripped from the description');
  eq(parseRssItems('').length, 0, 'rss: junk yields no items');
}

// ---- Feed candidates -----------------------------------------------------
const WINDOW = { since: Date.parse('2026-09-01T00:00:00Z'), until: Date.parse('2026-09-14T00:00:00Z') };
const feedOf = (xml) => async () => ({ ok: true, status: 200, text: async () => xml });

{
  const { items, error } = await fetchHeadlines(
    { company: 'Blackstone', isPe: true }, WINDOW.since, WINDOW.until,
    { fetchImpl: feedOf(RSS) },
  );
  eq(error, null, 'feeds: a reachable feed is not an error');
  eq(items.length, 1, 'feeds: only the acquisition headline survives the gate');
  eq(items[0].link, 'https://example.com/a', 'feeds: the surviving item is the right one');
}

{
  // The distinction the old digest could not make: a feed that answered
  // "nothing" is a real answer and must cost no model call, while a feed
  // that could not be reached is a failure that has to say so.
  const empty = '<rss><channel></channel></rss>';
  const quiet = await fetchHeadlines({ company: 'Ara Partners' }, WINDOW.since, WINDOW.until,
    { fetchImpl: feedOf(empty) });
  eq(quiet.items.length, 0, 'feeds: a quiet feed returns nothing');
  eq(quiet.error, null, 'feeds: a quiet feed is not a failure');

  const dead = await fetchHeadlines({ company: 'Ara Partners' }, WINDOW.since, WINDOW.until,
    { fetchImpl: async () => { throw new Error('ECONNREFUSED'); } });
  eq(dead.items.length, 0, 'feeds: an unreachable feed returns nothing');
  ok(dead.error, 'feeds: an unreachable feed IS a failure');

  // Google first, Bing second — one blocked host must not take it down.
  let calls = 0;
  const flaky = async (url) => {
    calls++;
    if (url.includes('news.google.com')) throw new Error('403');
    return { ok: true, status: 200, text: async () => RSS };
  };
  const viaBing = await fetchHeadlines({ company: 'Blackstone' }, WINDOW.since, WINDOW.until,
    { fetchImpl: flaky });
  eq(calls, 2, 'feeds: a blocked Google falls through to Bing');
  eq(viaBing.items.length, 1, 'feeds: the fallback feed still yields the deal');
}

{
  // Out-of-window items are dropped before they reach the model — the
  // window is the one thing the digest promises.
  const stale = RSS.replace('Mon, 07 Sep 2026', 'Mon, 07 Jul 2026');
  const { items } = await fetchHeadlines({ company: 'Blackstone' }, WINDOW.since, WINDOW.until,
    { fetchImpl: feedOf(stale) });
  eq(items.length, 0, 'feeds: an item published outside the window is dropped');
}

// ---- Classifier output ---------------------------------------------------
// The point of feeding headlines in is that the facts come back out of the
// feed. The model picks an index; the date, link and publisher are ours.
{
  const items = parseRssItems(RSS);
  const deals = dealsFromHeadlines(
    [{ index: 0, target: 'Acme Facilities', dealType: 'Add-on', summary: 'Facilities services roll-up.' }],
    items,
  );
  eq(deals.length, 1, 'deals: a valid index yields a deal');
  eq(deals[0].sourceUrl, 'https://example.com/a', 'deals: the URL comes from the feed, not the model');
  eq(deals[0].announcedOn, '2026-09-07', 'deals: the date comes from the feed, not the model');
  eq(deals[0].sourceTitle, 'Reuters', 'deals: the publisher comes from the feed');

  eq(dealsFromHeadlines([{ index: 99, target: 'Ghost Co' }], items).length, 0,
    'deals: an index outside the list is dropped, not guessed at');
  eq(dealsFromHeadlines([{ index: 0 }], items).length, 0, 'deals: a deal with no target is dropped');
  eq(dealsFromHeadlines([{ index: 0, target: 'X' }, { index: 0, target: 'X' }], items).length, 1,
    'deals: the same deal twice is listed once');
  eq(dealsFromHeadlines([{ index: 0, target: 'X', dealType: 'Rumour' }], items)[0].dealType, 'Acquisition',
    'deals: an off-list deal type falls back to "Acquisition"');
  eq(dealsFromHeadlines('nope', items).length, 0, 'deals: a non-array answer yields nothing');
}

// ---- Account-wide failures -----------------------------------------------
// The run that prompted this: fourteen firms each reporting the same
// truncated billing error, and nothing anywhere saying the account was out
// of credit. It is one fact, it stops everything, and it says so once.
{
  ok(haltReasonFor(400, '{"error":{"message":"Your credit balance is too low to access the Anthropic API."}}'),
    'halt: an empty credit balance halts the run');
  ok(haltReasonFor(401, 'unauthorized'), 'halt: a rejected key halts the run');
  eq(haltReasonFor(429, 'rate limited'), null, 'halt: a rate limit is per-call, not fatal');
  eq(haltReasonFor(400, 'max_tokens too large'), null, 'halt: an ordinary 400 is not fatal');
  eq(haltReasonFor(500, 'oops'), null, 'halt: a server error is not fatal');
}

{
  // One company throws the halt; nobody after it is searched, and the
  // cursor must not advance past companies nobody looked at.
  let attempts = 0;
  const results = await researchAll(firms(6), 0, 0, {
    budgetMs: 60_000,
    concurrency: 1,
    research: async () => {
      attempts++;
      throw new ResearchHaltedError('Anthropic account is out of credit');
    },
  });

  eq(attempts, 1, 'halt: the second company is never attempted');
  eq(results.length, 6, 'halt: every company still gets a result slot');
  eq(results.filter((r) => r.halted).length, 6, 'halt: all six are marked as blocked by the halt');
  eq(nextCursor(0, results), 0, 'halt: the cursor does not advance past unsearched companies');

  const html = buildNewsEmailHtml(results, { since: 0, until: 86_400_000 });
  ok(html.includes('Research stopped early'), 'halt: the email leads with a banner, not a footnote');
  ok(html.includes('out of credit'), 'halt: the banner names the actual problem');
  ok(!html.includes('No acquisitions found'), 'halt: a halted run does not claim it found nothing');
  ok(html.includes('0 companies searched'), 'halt: the header admits nothing was searched');
}

{
  // A halt part-way through keeps what it already found.
  let n = 0;
  const results = await researchAll(firms(4), 0, 0, {
    budgetMs: 60_000,
    concurrency: 1,
    research: async () => {
      if (n++ === 0) return { deals: [], error: null };
      throw new ResearchHaltedError('Anthropic API key rejected');
    },
  });
  eq(results.filter((r) => !r.skipped).length, 1, 'halt: the company searched before the halt still counts');
  eq(nextCursor(0, results), 1, 'halt: the cursor advances by exactly what was searched');
}

{
  // A web-search fallback that found nothing is a *successful* search.
  // Filing it under "search failed" is the conflation this digest keeps
  // relapsing into, so the fallback gets its own line instead.
  const results = [
    { company: 'Fallback Co', isPe: true, deals: [], error: null, skipped: false, viaWebSearch: true },
  ];
  const html = buildNewsEmailHtml(results, { since: 0, until: 86_400_000 });
  ok(!html.includes('Search failed'), 'fallback: a fallback with no deals is not a failure');
  ok(html.includes('No acquisitions found'), 'fallback: it is filed as searched-and-empty');
  ok(html.includes('fell back to a slower web search'), 'fallback: the email still says the feeds were down');
  ok(html.includes('Fallback Co'), 'fallback: the affected company is named');

  const clean = buildNewsEmailHtml(
    [{ company: 'Quiet Co', deals: [], error: null, skipped: false }],
    { since: 0, until: 86_400_000 },
  );
  ok(!clean.includes('fell back'), 'fallback: a normal run says nothing about fallbacks');
}

// ---- The digest runs on no API at all ------------------------------------
// The point of the rules classifier: the feature has nothing to run out of.
// An empty Anthropic balance stopped this feature dead; a digest built from
// an RSS feed and a regex cannot be stopped that way.
{
  eq(classifierMode(), 'rules', 'mode: rules is the default, so the default spends nothing');

  const items = [
    { title: 'Blackstone to acquire Acme Facilities for $450M - Reuters', link: 'https://ex.com/a',
      publishedAt: Date.parse('2026-09-07T12:00:00Z'), source: 'Reuters' },
    { title: 'Blackstone closes $20bn fund - Bloomberg', link: 'https://ex.com/b',
      publishedAt: Date.parse('2026-09-08T12:00:00Z'), source: 'Bloomberg' },
    { title: 'Blackstone backs management buyout of Delta - PE Hub', link: 'https://ex.com/c',
      publishedAt: Date.parse('2026-09-09T12:00:00Z'), source: 'PE Hub' },
  ];
  const { deals, unsure, error } = classifyByRules({ company: 'Blackstone', isPe: true }, items);

  eq(error, null, 'rules: reading headlines cannot fail');
  eq(deals.length, 1, 'rules: the one real acquisition is found');
  eq(deals[0].target, 'Acme Facilities', 'rules: with the target read off the headline');
  eq(deals[0].value, '$450M', 'rules: and the price, when the headline states one');
  eq(deals[0].sourceUrl, 'https://ex.com/a', 'rules: the link is the feed\u2019s, so it cannot be invented');
  eq(deals[0].announcedOn, '2026-09-07', 'rules: and so is the date');
  eq(unsure.length, 1, 'rules: the shape it could not read is kept, not dropped');
  eq(unsure[0].title, 'Blackstone backs management buyout of Delta', 'rules: and it is the right one');
  // The fund close is neither a deal nor a headline worth the reader's time.
  eq(deals.concat(unsure).some(x => /fund/i.test(x.title || x.summary || '')), false,
    'rules: a disqualified headline is gone from both lists');
}

{
  // The same deal reported by three outlets is one deal in the email.
  const dup = (n, src) => ({
    title: `Blackstone acquires Acme Facilities - ${src}`, link: `https://ex.com/${n}`,
    publishedAt: Date.parse('2026-09-07T12:00:00Z'), source: src,
  });
  const { deals } = classifyByRules({ company: 'Blackstone', isPe: true },
    [dup(1, 'Reuters'), dup(2, 'Bloomberg'), dup(3, 'PE Hub')]);
  eq(deals.length, 1, 'rules: syndicated coverage of one deal is listed once');
}

{
  // End to end with no key and no classifier set: a feed answers, the
  // digest reads it, and fetch is never called against Anthropic.
  const realFetch = globalThis.fetch;
  const key = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  let anthropicCalls = 0;
  globalThis.fetch = async (url) => {
    if (String(url).includes('anthropic.com')) { anthropicCalls++; throw new Error('should not be called'); }
    return { ok: true, status: 200, text: async () => `<rss><channel><item>
      <title>Blackstone acquires Acme Facilities</title><link>https://ex.com/a</link>
      <pubDate>${new Date(Date.parse('2026-09-07T12:00:00Z')).toUTCString()}</pubDate>
      <source url="https://reuters.com">Reuters</source></item></channel></rss>` };
  };

  const out = await researchCompanyAcquisitions(
    { company: 'Blackstone', isPe: true },
    Date.parse('2026-09-01T00:00:00Z'), Date.parse('2026-09-14T00:00:00Z'),
  );
  eq(anthropicCalls, 0, 'no-api: the digest never reaches for the API');
  eq(out.deals.length, 1, 'no-api: and still finds the deal');
  eq(out.error, null, 'no-api: a missing API key is no longer an error');

  // An unreachable feed must not quietly fall back to the paid path.
  globalThis.fetch = async (url) => {
    if (String(url).includes('anthropic.com')) { anthropicCalls++; throw new Error('should not be called'); }
    throw new Error('ECONNREFUSED');
  };
  const dead = await researchCompanyAcquisitions(
    { company: 'Blackstone', isPe: true },
    Date.parse('2026-09-01T00:00:00Z'), Date.parse('2026-09-14T00:00:00Z'),
  );
  eq(anthropicCalls, 0, 'no-api: a dead feed does not silently start spending');
  ok(dead.error, 'no-api: it reports the feed failure instead');

  globalThis.fetch = realFetch;
  if (key) process.env.ANTHROPIC_API_KEY = key;
}

{
  // Headlines the rules could not place are listed under the firm, so a
  // company with only those still gets a section rather than being filed
  // under "no acquisitions found".
  const results = [{
    company: 'Blackstone', isPe: true, deals: [], skipped: false, error: null,
    unsure: [{ title: 'Blackstone backs management buyout of Delta', announcedOn: '2026-09-09',
      sourceTitle: 'PE Hub', sourceUrl: 'https://ex.com/c' }],
  }];
  const html = buildNewsEmailHtml(results, { since: 0, until: 86_400_000 });
  ok(html.includes('Also in the news'), 'email: unplaced headlines get their own block');
  ok(html.includes('management buyout'), 'email: and the headline itself is printed');
  ok(html.includes('https://ex.com/c'), 'email: with a link to the source');
  ok(!html.includes('No acquisitions found'), 'email: a firm with headlines is not filed as empty');
  ok(html.includes('1 headline to check'), 'email: the header counts them');
}

// ---- The firm's own newsroom ---------------------------------------------
// A PE firm announces every deal on its own site, usually before the trade
// press and always without a reporter's hedging. The website is already on
// the prospect record, so this costs a query and nothing else.
{
  eq(hostOf('https://www.blackstone.com/'), 'blackstone.com', 'site: a URL reduces to a bare host');
  eq(hostOf('carlyle.com/news'), 'carlyle.com', 'site: a path is dropped');
  eq(hostOf(''), '', 'site: no website, no host');
  eq(hostOf('not a website'), '', 'site: junk does not become a search operator');

  ok(siteQuery('Blackstone', 'https://www.blackstone.com').startsWith('site:blackstone.com'),
    'site: the query is restricted to the firm\u2019s own domain');
  eq(siteQuery('Blackstone', ''), '', 'site: no website, no second query');
}

{
  // The newsroom's own wording, merged ahead of the press coverage of the
  // same deal — and counted once, not twice.
  const day = (d) => new Date(Date.parse(`2026-09-${d}T12:00:00Z`)).toUTCString();
  const rss = (title, src) => `<rss><channel><item><title>${title}</title>
    <link>https://ex.com/${encodeURIComponent(src)}</link><pubDate>${day('07')}</pubDate>
    <source url="https://x.com">${src}</source></item></channel></rss>`;

  const seenUrls = [];
  const fetchImpl = async (url) => {
    seenUrls.push(String(url));
    const own = String(url).includes('site%3Ablackstone.com');
    return {
      ok: true,
      status: 200,
      text: async () => rss(
        own ? 'Blackstone Announces Acquisition of Acme Facilities' : 'Blackstone acquires Acme Facilities',
        own ? 'Blackstone' : 'Reuters',
      ),
    };
  };

  const { items } = await fetchHeadlines(
    { company: 'Blackstone', isPe: true, website: 'https://www.blackstone.com' },
    Date.parse('2026-09-01T00:00:00Z'), Date.parse('2026-09-14T00:00:00Z'), { fetchImpl },
  );
  ok(seenUrls.some(u => u.includes('site%3Ablackstone.com')), 'site: the newsroom is actually queried');
  eq(items.length, 2, 'site: a differently-worded story from each source survives');
  eq(items[0].source, 'Blackstone', 'site: the firm\u2019s own announcement is put first');

  // A newsroom that cannot be reached must not cost the company its
  // ordinary result.
  const flaky = async (url) => {
    if (String(url).includes('site%3A')) throw new Error('404');
    return { ok: true, status: 200, text: async () => rss('Blackstone acquires Acme Facilities', 'Reuters') };
  };
  const fallback = await fetchHeadlines(
    { company: 'Blackstone', isPe: true, website: 'https://www.blackstone.com' },
    Date.parse('2026-09-01T00:00:00Z'), Date.parse('2026-09-14T00:00:00Z'), { fetchImpl: flaky },
  );
  eq(fallback.items.length, 1, 'site: an unreachable newsroom is not fatal');
  eq(fallback.error, null, 'site: and is not reported as a failure');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
