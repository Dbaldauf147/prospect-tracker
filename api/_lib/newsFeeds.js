// Free, keyless news feeds for the acquisition digest.
//
// The digest used to ask Claude to *find* the deals: one agentic web-search
// pass per tracked company, eight searches deep for a PE firm. That is the
// most expensive way to answer "did this firm buy anything in the last two
// weeks", and it failed in all three directions at once — it burned the API
// credit balance, it blew the per-company time budget on the firms with the
// most portfolio activity, and every date and URL in the answer came out of
// the model rather than out of a source.
//
// So the search moves here. A news feed already knows what was published,
// when, and by whom — those are facts, not inferences — and asking for them
// costs an HTTP GET and no tokens at all. Claude is still needed, but only
// to read headlines we already hold and say which ones are this company
// buying something. A company with no matching headlines needs no model
// call whatsoever, which is most companies most weeks.
//
// Both feeds are public RSS with no API key: Google News first because its
// coverage and its `when:` filter are better, Bing as a fallback so one
// blocked host doesn't take the feature down.

// Titles have to clear this before they cost a classification token. It is
// deliberately loose on direction — "acquired by" is in here even though it
// is the wrong way round — because deciding who bought whom is the model's
// job and a headline is too little context to do it with a regex.
const DEAL_WORDS = /\b(acquir\w*|acquisition|buys?|bought|purchas\w*|takeover|take-private|merger|merges?|bolt-?on|add-?on|majority stake|controlling stake|recapitaliz\w*|snaps? up|to buy)\b/i;

// How many feed items are worth classifying for one company. Past this the
// tail is duplicate coverage of the same two or three deals.
const MAX_ITEMS_PER_COMPANY = 25;

// Google News caps `when:` at 100 days; the digest window never approaches
// that, but clamp anyway rather than emit a query the feed will reject.
const MAX_WHEN_DAYS = 100;

// ---- Company names -------------------------------------------------------
// Tracked names are typed by hand and carry parentheticals: "Clayton,
// Dubilier & Rice (CD&R)", "Strategic Value Partners (SVP) Global",
// "TowerBrook Capital Partners (a Blue Owl co.)". Searching the literal
// string finds nothing, because no headline writes it that way.
//
// A parenthetical is an alias only when it reads like one — an acronym or
// short trading name. "(CD&R)" is how the press names that firm; "(a Blue
// Owl co.)" is a note to ourselves and searching for it would poison the
// query.
function isAlias(inner) {
  const s = inner.trim();
  if (!s || s.length > 12) return false;
  // Acronym-shaped: capitals, digits and the punctuation acronyms carry.
  return /^[A-Z0-9][A-Z0-9&.\-/]*$/.test(s);
}

export function nameVariants(company) {
  const raw = String(company || '').trim();
  if (!raw) return [];

  const aliases = [];
  // Strip every parenthetical from the base name, keeping the ones that
  // look like aliases as separate search terms.
  const base = raw.replace(/\(([^)]*)\)/g, (_, inner) => {
    if (isAlias(inner)) aliases.push(inner.trim());
    return ' ';
  }).replace(/\s+/g, ' ').trim();

  const out = [];
  const seen = new Set();
  for (const v of [base || raw, ...aliases]) {
    const key = v.toLowerCase();
    if (v && !seen.has(key)) { seen.add(key); out.push(v); }
  }
  return out;
}

// Does this item plausibly concern the company at all? Google's query
// already constrains it, but Bing matches loosely and will happily return
// an article about somebody else entirely.
export function mentionsCompany(text, variants) {
  const hay = String(text || '').toLowerCase();
  return variants.some((v) => {
    const needle = v.toLowerCase();
    if (hay.includes(needle)) return true;
    // "Clayton, Dubilier & Rice" is written a dozen ways. Fall back to the
    // longest distinctive word in the name — enough to keep "Blackstone"
    // out of an article that never mentions it, without demanding an exact
    // rendering of the punctuation.
    const words = needle.split(/[^a-z0-9]+/).filter((w) => w.length > 4 && !STOP_WORDS.has(w));
    return words.length > 0 && words.every((w) => hay.includes(w));
  });
}

const STOP_WORDS = new Set([
  'capital', 'partners', 'group', 'global', 'management', 'holdings',
  'investments', 'equity', 'private', 'infrastructure', 'company',
]);

// ---- Query ---------------------------------------------------------------
export function feedQuery(company) {
  const variants = nameVariants(company);
  if (variants.length === 0) return '';
  const names = variants.map((v) => `"${v.replace(/"/g, '')}"`).join(' OR ');
  const terms = '(acquires OR acquisition OR "to acquire" OR acquired OR "bolt-on" OR "add-on" OR takeover OR merger)';
  return `(${names}) ${terms}`;
}

export function googleNewsUrl(query, days) {
  const d = Math.max(1, Math.min(MAX_WHEN_DAYS, Math.ceil(Number(days) || 14)));
  const q = encodeURIComponent(`${query} when:${d}d`);
  return `https://news.google.com/rss/search?q=${q}&hl=en-US&gl=US&ceid=US:en`;
}

export function bingNewsUrl(query) {
  return `https://www.bing.com/news/search?q=${encodeURIComponent(query)}&format=RSS&count=50`;
}

// ---- RSS parsing ---------------------------------------------------------
// Both feeds are plain RSS 2.0 and the project has no XML dependency, so
// this reads the handful of tags we need rather than pulling in a parser.
function decodeEntities(s) {
  return String(s)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    // Ampersand last: decoding it first would turn "&amp;lt;" into "<".
    .replace(/&amp;/g, '&');
}

function tagText(block, tag) {
  const m = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i'));
  if (!m) return '';
  const inner = m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  return decodeEntities(inner).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

export function parseRssItems(xml) {
  const text = String(xml || '');
  const out = [];
  for (const m of text.matchAll(/<item\b[\s\S]*?<\/item>/gi)) {
    const block = m[0];
    const title = tagText(block, 'title');
    const link = tagText(block, 'link');
    if (!title || !link) continue;
    const published = Date.parse(tagText(block, 'pubDate'));
    out.push({
      title,
      link,
      // Google puts the publisher in <source>; Bing has no such tag, so fall
      // back to the trailing " - Publisher" that Google also appends.
      source: tagText(block, 'source') || (title.match(/\s[-–]\s([^-–]{2,40})$/)?.[1] || '').trim(),
      description: tagText(block, 'description'),
      publishedAt: Number.isFinite(published) ? published : null,
    });
  }
  return out;
}

// ---- Fetching ------------------------------------------------------------
async function getFeed(url, { signal, fetchImpl = fetch }) {
  const resp = await fetchImpl(url, {
    signal,
    headers: {
      // A default Node user-agent gets a 403 from both hosts.
      'User-Agent': 'Mozilla/5.0 (compatible; ProspectTracker/1.0; +https://vercel.com)',
      Accept: 'application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8',
    },
  });
  if (!resp.ok) throw new Error(`feed HTTP ${resp.status}`);
  return resp.text();
}

// Candidate headlines for one company, already filtered to the window.
//
// Returns { items, error }. `error` is set only when no feed could be
// reached at all — an empty `items` with a null error is a real answer
// ("nothing was published"), and the caller must not spend a model call on
// it. Telling those two apart is the whole point: the previous version
// reported "no acquisitions found" for both, which is how a digest that
// was actually broken looked identical to a quiet fortnight.
export async function fetchHeadlines(entry, since, until, { signal, fetchImpl = fetch } = {}) {
  const query = feedQuery(entry?.company);
  if (!query) return { items: [], error: null };

  const days = Math.ceil((until - since) / 86_400_000);
  const variants = nameVariants(entry.company);
  const urls = [googleNewsUrl(query, days), bingNewsUrl(query)];

  const failures = [];
  for (const url of urls) {
    let xml;
    try {
      xml = await getFeed(url, { signal, fetchImpl });
    } catch (err) {
      if (err?.name === 'AbortError') return { items: [], error: 'Feed lookup timed out' };
      failures.push(String(err?.message || err));
      continue;
    }

    const items = parseRssItems(xml);
    const kept = [];
    const seen = new Set();
    for (const it of items) {
      // An item with no date can't be placed in the window, and the window
      // is the one thing the digest promises. Google's `when:` already
      // bounds its results; an undated item is a parse failure, not a hit.
      if (it.publishedAt === null) continue;
      if (it.publishedAt < since || it.publishedAt > until) continue;
      const haystack = `${it.title} ${it.description}`;
      if (!DEAL_WORDS.test(haystack)) continue;
      if (!mentionsCompany(haystack, variants)) continue;
      // Outlets syndicate the same headline; key on it so the classifier
      // sees each story once.
      const key = it.title.toLowerCase().replace(/\s+/g, ' ').slice(0, 120);
      if (seen.has(key)) continue;
      seen.add(key);
      kept.push(it);
      if (kept.length >= MAX_ITEMS_PER_COMPANY) break;
    }

    // A feed that answered is authoritative even when it kept nothing —
    // don't fall through to Bing just because Google found no deals.
    return { items: kept, error: null };
  }

  return { items: [], error: `No news feed reachable (${failures.join('; ').slice(0, 120)})` };
}

export const __testing = { DEAL_WORDS, MAX_ITEMS_PER_COMPANY };
