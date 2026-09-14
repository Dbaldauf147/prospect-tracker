// Acquisition-news digest for companies the user has flagged on the
// company popup ("Track acquisition news"). Each flagged company is looked
// up in public news feeds for the digest window, and Claude reads the
// headlines that come back to pick out acquisitions *that company made*;
// the results are grouped into an HTML email.
//
// The focus is deliberately narrow — who bought whom — because that's the
// signal that creates an opp: a PE firm adding a platform or a bolt-on
// means new sites to serve. Funding rounds, earnings and leadership moves
// are out of scope; see NEWS_SYSTEM_PROMPT.
//
// PE firms are called out first in the email and searched with extra
// budget, since a firm's add-ons are the densest source of new accounts.

import { sendEmail } from './mailer.js';
import { companyNewsBudgetMs } from './researchBudget.js';
import { fetchHeadlines, nameVariants } from './newsFeeds.js';
import { classifyHeadline, stripPublisher } from './dealHeadline.js';

// A prospect opts in with `trackAcquisitionNews: true`, written by the
// checkbox on the company popup (ProspectModal).
export const NEWS_FLAG = 'trackAcquisitionNews';

// How far back the very first digest looks when a schedule has never sent.
const FIRST_RUN_LOOKBACK_DAYS = 14;

// Every window reaches back at least this far, even when the last send was
// more recent. A deal has to be *findable by web search* to make the digest,
// and indexing lags announcements by days — a window that ended where the
// last one started meant a deal indexed late was never seen by any digest,
// because no window ever covered it twice.
//
// The cost is overlap: a weekly schedule re-reports deals the previous
// digest already carried. That is the intended trade — a repeat is obvious
// to the reader, a permanently missed deal is not.
const MIN_LOOKBACK_DAYS = 14;

// Never let a window grow unbounded — a schedule paused for months would
// otherwise ask for a year of history in one search.
const MAX_LOOKBACK_DAYS = 60;

// Companies researched per digest. Each is a separate Claude call with
// web search, so this is the main cost/latency lever.
const MAX_COMPANIES = 40;

const ADMIN_EMAIL = 'baldaufdan@gmail.com';

// ---- Loading the opted-in companies -------------------------------------
// Same collection layout as peOpps.loadPeFirms: admin reads the shared
// `prospects` collection, everyone else their own subcollection.
export async function loadTrackedCompanies(db, uid, email) {
  const col = email === ADMIN_EMAIL
    ? db.collection('prospects')
    : db.collection('users').doc(uid).collection('prospects');

  let snap;
  try { snap = await col.get(); } catch { return []; }

  const out = [];
  for (const d of snap.docs) {
    const p = d.data() || {};
    if (p[NEWS_FLAG] !== true) continue;
    const company = String(p.company || '').trim();
    if (!company) continue;
    out.push({
      id: d.id,
      company,
      // Drives the "PE firm" grouping and the deeper search budget.
      isPe: p.type === 'Private Equity',
      type: String(p.type || '').trim(),
      website: String(p.website || '').trim(),
      peOwner: String(p.peOwner || '').trim(),
    });
  }

  // PE firms first, then alphabetical, so the email's densest section is
  // also the one the search budget was spent on.
  out.sort((a, b) => (Number(b.isPe) - Number(a.isPe)) || a.company.localeCompare(b.company));
  return out.slice(0, MAX_COMPANIES);
}

// ---- The digest window --------------------------------------------------
// Starts at the schedule's last successful send so a skipped or failed week
// is picked up by the next one rather than silently dropped — then widened
// to MIN_LOOKBACK_DAYS so late-indexed deals still get a chance, and capped
// at MAX_LOOKBACK_DAYS so a long-paused schedule can't ask for a year.
//
// `minLookbackDays` is an override for a test send, where the user typed an
// exact number of days and should get exactly that.
export function digestWindow(lastSentAt, now = Date.now(), { minLookbackDays } = {}) {
  const day = 24 * 60 * 60 * 1000;
  const maxMs = MAX_LOOKBACK_DAYS * day;
  const rawMin = Number(minLookbackDays);
  const minMs = (Number.isFinite(rawMin) && rawMin >= 0 ? rawMin : MIN_LOOKBACK_DAYS) * day;
  const firstRunMs = FIRST_RUN_LOOKBACK_DAYS * day;

  const last = Number(lastSentAt);
  if (!Number.isFinite(last) || last <= 0) return { since: now - firstRunMs, until: now };

  // Clamp the anchor into [now - max, now - min]: never shorter than the
  // minimum, never longer than the maximum, and honouring the anchor between.
  const since = Math.min(Math.max(last, now - maxMs), now - minMs);
  return { since, until: now };
}

function isoDate(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

export function formatWindow(since, until) {
  return `${isoDate(since)} → ${isoDate(until)}`;
}

// ---- Claude research ----------------------------------------------------
// Two-stage, and the split is the point. A news feed says what was
// published and when (see newsFeeds.js); Claude reads those headlines and
// says which of them are this company buying something. Dates, URLs and
// publishers come from the feed, so the model can no longer invent one —
// and a company whose feed is quiet costs nothing at all.
const NEWS_SYSTEM_PROMPT = `You are an M&A research assistant. You are given a company name and a numbered list of news headlines about it, already restricted to one date window. Decide which headlines report an acquisition THAT COMPANY MADE.

Count as a qualifying acquisition:
- The company acquiring another company, business unit, or asset portfolio.
- For a private equity / investment firm: new platform investments, add-on / bolt-on acquisitions made by its portfolio companies, take-privates, and majority recapitalizations. An add-on counts even when the buyer of record is the portfolio company, as long as the firm is named as the sponsor.

Do NOT count, even when the headline is about the company:
- The company itself being acquired, or a stake in it being sold.
- Minority investments with no control, venture rounds, and funding rounds the company merely participated in.
- Fund closes, capital raises, dry powder announcements.
- Exits, divestitures, and sales of portfolio companies.
- Earnings, leadership changes, expansions, partnerships, product launches, litigation.
- Rumoured, "exploring", "in talks", or unconfirmed deals.

Work only from the headlines given. Do not add deals you remember from elsewhere - a deal that is not in the list does not go in the answer. When several headlines cover the same deal, return the clearest one only.

Return ONLY a JSON object (no prose, no markdown fences) of this exact shape:
{
  "deals": [
    {
      "index": the number of the headline this deal comes from,
      "target": "name of the company/asset acquired",
      "buyer": "the acquiring entity - the portfolio company for an add-on, otherwise the company itself",
      "dealType": one of "Platform", "Add-on", "Take-private", "Asset purchase", "Acquisition",
      "sector": "short sector label for the target, e.g. Industrial Services, or empty string",
      "sites": "site/facility count or footprint if the headline reports one, else empty string",
      "value": "reported deal value if disclosed, e.g. \\"$450M\\", else empty string",
      "summary": "one sentence, max 220 characters, on what was bought and why"
    }
  ]
}

If none of the headlines report an acquisition the company made, return {"deals": []}.`;

// The digest's own errors, so callers can tell "this company had a bad day"
// from "the whole run is dead". A wrong or unfunded API key is the second
// kind: it fails identically for every remaining company, and the run that
// prompted this rewrite spent fourteen slots discovering that fourteen times.
export class ResearchHaltedError extends Error {
  constructor(reason) {
    super(reason);
    this.name = 'ResearchHaltedError';
    this.reason = reason;
  }
}

// 401/403 are a bad key; a 400 mentioning credit is an unfunded account.
// Both are account-wide and neither improves by asking again.
export function haltReasonFor(status, body) {
  const text = String(body || '');
  if (status === 401 || status === 403) return 'Anthropic API key rejected - check ANTHROPIC_API_KEY';
  if (status === 400 && /credit balance is too low/i.test(text)) {
    return 'Anthropic account is out of credit - top up at console.anthropic.com/settings/billing';
  }
  return null;
}

// One classification pass over headlines we already hold. No web_search
// tool: the searching is done, this is a read. Effort is low because
// picking acquisitions out of labelled headlines is not a reasoning task,
// and the digest fans this out across every tracked company.
async function classifyHeadlines(entry, items, { signal }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { deals: [], error: 'ANTHROPIC_API_KEY not configured' };

  const list = items
    .map((it, i) => `${i}. [${isoDate(it.publishedAt)}] ${it.title}${it.source ? ` (${it.source})` : ''}`)
    .join('\n');

  const peHint = entry.isPe
    ? `\n"${entry.company}" is a private equity firm, so add-ons announced by its portfolio companies count when it is named as the sponsor.`
    : '';

  const userPrompt = `Company: "${entry.company}"${peHint}

Headlines:
${list}

Return the JSON object as specified.`;

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-opus-5',
      // The answer is a few hundred tokens, but thinking counts toward
      // max_tokens too — leave room, or a truncated reply comes back
      // looking like malformed JSON rather than like a cut-off one.
      max_tokens: 8000,
      output_config: { effort: 'low' },
      system: NEWS_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    }),
    signal,
  });

  if (!resp.ok) {
    const errText = await resp.text();
    const halt = haltReasonFor(resp.status, errText);
    if (halt) throw new ResearchHaltedError(halt);
    return { deals: [], error: `Claude API error ${resp.status}: ${errText.slice(0, 300)}` };
  }

  const data = await resp.json();
  // A safety decline arrives as HTTP 200 with stop_reason "refusal" and no
  // usable content, so check it before parsing.
  if (data.stop_reason === 'refusal') {
    return { deals: [], error: 'Claude declined this research request' };
  }
  if (data.stop_reason === 'max_tokens') {
    return { deals: [], error: 'Answer was cut off before it finished' };
  }

  const text = (data.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();

  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return { deals: [], error: 'No JSON in response' };

  let parsed;
  try { parsed = JSON.parse(match[0]); }
  catch { return { deals: [], error: 'Malformed JSON in response' }; }

  return { deals: dealsFromHeadlines(parsed.deals, items), unsure: [], error: null };
}

// Which classifier reads the headlines the feed returned.
//
// "rules" is the default and costs nothing: dealHeadline.js reads the
// BUYER VERB TARGET shape that news headlines are written to, and the
// digest makes no API call at any point. "claude" is the opt-in, for a
// reader who would rather pay for the shapes rules don't catch.
//
// The default matters beyond the bill. An API key can be rejected or run
// out of credit, and when it does this feature stops entirely — which is
// exactly what it did. A digest built out of an RSS feed and a regex has
// nothing to run out of.
export function classifierMode() {
  return String(process.env.COMPANY_NEWS_CLASSIFIER || '').trim().toLowerCase() === 'claude'
    ? 'claude'
    : 'rules';
}

// One research pass for one company. Returns { deals, unsure, error } — a
// failure on one company must never sink the whole digest, so errors come
// back as data rather than thrown. The exception is ResearchHaltedError,
// which is meant to stop the run and is deliberately rethrown.
export async function researchCompanyAcquisitions(entry, since, until, { signal } = {}) {
  const { items, error: feedError } = await fetchHeadlines(entry, since, until, { signal });

  if (feedError) {
    // No feed, and no paid fallback unless one was asked for: spending
    // money to answer for one unreachable company is how the whole
    // feature's budget went last time.
    if (classifierMode() !== 'claude') {
      return { deals: [], unsure: [], error: feedError };
    }
    return researchViaWebSearch(entry, since, until, { signal, feedError });
  }

  // A quiet feed is an answer, and answering it costs nothing.
  if (items.length === 0) return { deals: [], unsure: [], error: null };

  if (classifierMode() !== 'claude') return classifyByRules(entry, items);

  try {
    return await classifyHeadlines(entry, items, { signal });
  } catch (err) {
    if (err instanceof ResearchHaltedError) throw err;
    if (err?.name === 'AbortError') return { deals: [], unsure: [], error: 'Research timed out' };
    return { deals: [], unsure: [], error: String(err?.message || err).slice(0, 200) };
  }
}

// The no-API path: read each headline with dealHeadline's rules.
//
// Anything the rules can't place comes back as `unsure` rather than being
// dropped. Rules will always miss shapes a model would catch; what they
// must not do is lose them silently, so those headlines are listed under
// the firm for the reader to glance at. Two seconds to dismiss, against a
// missed platform acquisition.
export function classifyByRules(entry, items) {
  const variants = nameVariants(entry.company);
  const deals = [];
  const unsure = [];
  const seen = new Set();

  for (const item of items) {
    const verdict = classifyHeadline(item, entry, variants);
    if (verdict.skip) continue;

    if (verdict.unsure) {
      unsure.push({
        title: stripPublisher(item.title),
        announcedOn: isoDate(item.publishedAt),
        sourceTitle: item.source || 'Source',
        sourceUrl: item.link,
      });
      continue;
    }

    const d = verdict.deal;
    if (!d?.target) continue;
    const key = `${d.target.toLowerCase()}|${isoDate(item.publishedAt)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    deals.push({
      target: d.target,
      buyer: d.buyer || entry.company,
      dealType: d.dealType || 'Acquisition',
      sector: '',
      sites: '',
      value: d.value || '',
      summary: d.summary || '',
      announcedOn: isoDate(item.publishedAt),
      sourceTitle: item.source || stripPublisher(item.title).slice(0, 200) || 'Source',
      sourceUrl: item.link,
    });
  }

  deals.sort((a, b) => b.announcedOn.localeCompare(a.announcedOn));
  unsure.sort((a, b) => b.announcedOn.localeCompare(a.announcedOn));
  return { deals: deals.slice(0, 25), unsure: unsure.slice(0, 8), error: null };
}

// The pre-feed implementation, kept for the case the feeds can't answer:
// Claude with the web-search tool, finding and dating the deals itself.
// Everything that made it a poor default still applies — it is slow, it
// costs many times a classification call, and its dates and URLs are the
// model's rather than a source's — so it runs only as a fallback.
const WEB_SEARCH_SYSTEM_PROMPT = `${NEWS_SYSTEM_PROMPT.split('Work only from the headlines given.')[0]}
Search the web to find these deals. The announcement date must fall inside the window given by the user; a deal announced before the window does not belong, even if it closed inside it. If you cannot establish an announcement date inside the window from a source, leave the deal out.

Return ONLY a JSON object (no prose, no markdown fences) of this exact shape:
{
  "deals": [
    {
      "target": "name of the company/asset acquired",
      "announcedOn": "YYYY-MM-DD",
      "buyer": "the acquiring entity",
      "dealType": one of "Platform", "Add-on", "Take-private", "Asset purchase", "Acquisition",
      "sector": "short sector label for the target",
      "sites": "site/facility count or footprint if reported, else empty string",
      "value": "reported deal value if disclosed, else empty string",
      "summary": "one sentence, max 220 characters",
      "sourceTitle": "publication or headline",
      "sourceUrl": "direct link to the article"
    }
  ]
}

Every deal MUST have a sourceUrl you actually found via search. If there are no qualifying acquisitions in the window, return {"deals": []}. Never invent a deal, a date, or a URL.`;

export async function researchViaWebSearch(entry, since, until, { signal, feedError } = {}) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { deals: [], error: 'ANTHROPIC_API_KEY not configured' };

  const peHint = entry.isPe
    ? ` "${entry.company}" is a private equity firm: search for its new platform investments AND the add-on acquisitions its portfolio companies made with it as sponsor.`
    : '';
  const siteHint = entry.website ? ` Its website is ${entry.website}.` : '';

  const userPrompt = `Find every acquisition made by "${entry.company}" announced between ${isoDate(since)} and ${isoDate(until)} (inclusive).${peHint}${siteHint}

Search the web before answering - do not answer from memory alone. Return the JSON object as specified.`;

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-opus-5',
        max_tokens: 8000,
        system: WEB_SEARCH_SYSTEM_PROMPT,
        tools: [{
          type: 'web_search_20260209',
          name: 'web_search',
          max_uses: entry.isPe ? 8 : 4,
        }],
        messages: [{ role: 'user', content: userPrompt }],
      }),
      signal,
    });

    if (!resp.ok) {
      const errText = await resp.text();
      const halt = haltReasonFor(resp.status, errText);
      if (halt) throw new ResearchHaltedError(halt);
      return { deals: [], error: `Claude API error ${resp.status}: ${errText.slice(0, 300)}` };
    }

    const data = await resp.json();
    if (data.stop_reason === 'refusal') {
      return { deals: [], error: 'Claude declined this research request' };
    }

    const text = (data.content || [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();

    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return { deals: [], error: 'No JSON in response' };

    let parsed;
    try { parsed = JSON.parse(match[0]); }
    catch { return { deals: [], error: 'Malformed JSON in response' }; }

    // Flag the fallback rather than reporting it as this company's error:
    // the search ran and answered, and filing "found nothing" under
    // "search failed" is the exact conflation this digest keeps relapsing
    // into. The email notes it in one line at the bottom instead, so a
    // digest quietly falling back every week is still visible.
    return { deals: normalizeDeals(parsed.deals, since, until), unsure: [], error: null, viaWebSearch: true, feedError };
  } catch (err) {
    if (err instanceof ResearchHaltedError) throw err;
    if (err?.name === 'AbortError') return { deals: [], error: 'Research timed out' };
    return { deals: [], error: String(err?.message || err).slice(0, 200) };
  }
}

const DEAL_TYPES = ['Platform', 'Add-on', 'Take-private', 'Asset purchase', 'Acquisition'];
const str = (v, max) => String(v ?? '').trim().slice(0, max);

function baseDeal(d) {
  const dealType = str(d.dealType, 40);
  return {
    target: str(d.target, 200),
    buyer: str(d.buyer, 200),
    dealType: DEAL_TYPES.includes(dealType) ? dealType : 'Acquisition',
    sector: str(d.sector, 80),
    sites: str(d.sites, 60),
    value: str(d.value, 40),
    summary: str(d.summary, 220),
  };
}

// Turn the classifier's answer back into deals, taking every fact it could
// have got wrong — the date, the link, the publication — from the feed item
// it pointed at rather than from the model.
export function dealsFromHeadlines(raw, items) {
  if (!Array.isArray(raw)) return [];

  const out = [];
  const seen = new Set();
  for (const d of raw) {
    if (!d || typeof d !== 'object') continue;
    const i = Number(d.index);
    // An index outside the list means the model answered about a deal it
    // was not shown, which is exactly what feeding it headlines is meant
    // to prevent. Drop it rather than guess which item was meant.
    if (!Number.isInteger(i) || i < 0 || i >= items.length) continue;
    const item = items[i];
    const deal = baseDeal(d);
    if (!deal.target) continue;

    const key = `${deal.target.toLowerCase()}|${isoDate(item.publishedAt)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({
      ...deal,
      announcedOn: isoDate(item.publishedAt),
      sourceTitle: item.source || item.title.slice(0, 200) || 'Source',
      sourceUrl: item.link,
    });
  }
  out.sort((a, b) => b.announcedOn.localeCompare(a.announcedOn));
  return out.slice(0, 25);
}

// Keep only deals that carry a target, a source URL, and an announcement
// date inside the window. Used by the web-search fallback, where all three
// come from the model and none of them can be trusted on sight.
export function normalizeDeals(raw, since, until) {
  if (!Array.isArray(raw)) return [];
  // Compare on the calendar day so a deal announced on the window's first
  // or last day survives the timestamp-vs-date mismatch.
  const lo = isoDate(since);
  const hi = isoDate(until);

  const out = [];
  const seen = new Set();
  for (const d of raw) {
    if (!d || typeof d !== 'object') continue;
    const deal = baseDeal(d);
    const sourceUrl = str(d.sourceUrl || d.url, 500);
    const announcedOn = str(d.announcedOn, 10);
    if (!deal.target || !sourceUrl) continue;
    if (!/^https?:\/\//i.test(sourceUrl)) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(announcedOn)) continue;
    if (announcedOn < lo || announcedOn > hi) continue;

    // The same deal often surfaces from two outlets; key on the target and
    // date so the email lists it once.
    const key = `${deal.target.toLowerCase()}|${announcedOn}`;
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({
      ...deal,
      announcedOn,
      sourceTitle: str(d.sourceTitle, 200) || 'Source',
      sourceUrl,
    });
  }
  out.sort((a, b) => b.announcedOn.localeCompare(a.announcedOn));
  return out.slice(0, 25);
}

// Research the tracked companies against one shared deadline.
//
// This used to run strictly one at a time, and that is what made the digest
// useless: a single PE firm's search loop can take most of a minute, so the
// first company ate the whole budget, the second was aborted mid-flight, and
// every company after it was reported as "not searched" — the same one or two
// names every single run, because the list order never changed.
//
// So: a small worker pool instead. The cap stays low on purpose — the risk
// that motivated the sequential version (a burst of parallel requests
// tripping Anthropic's rate limit) is real, but it is no longer fatal: a 429
// comes back through researchCompanyAcquisitions as that one company's error
// and the rest of the digest still lands.
const RESEARCH_CONCURRENCY = 4;

// No single company may spend more than this, however much budget is left.
// Without it one slow firm can still consume an entire run. A feed lookup
// plus a classification call is a few seconds; the ceiling exists for the
// web-search fallback, which is the only thing here that can approach it.
const PER_COMPANY_MS = 45_000;

// Below this there isn't time for a search loop to finish, so don't start
// one — record the company as skipped and let the cursor pick it up next run.
const MIN_SLICE_MS = 8_000;

export async function researchAll(companies, since, until, {
  budgetMs = companyNewsBudgetMs(),
  concurrency = RESEARCH_CONCURRENCY,
  // Seam for the tests: they need to drive timing without real API calls.
  research = researchCompanyAcquisitions,
} = {}) {
  const deadline = Date.now() + budgetMs;
  const results = new Array(companies.length);
  let next = 0;
  // Set once a company hits an account-wide failure — no key, a rejected
  // key, an empty credit balance. Every company after it would fail the
  // same way, so the run stops instead of spending its remaining slots
  // rediscovering the same fact twenty times over and burying it in a list
  // of per-company errors.
  let halted = null;

  // Workers pull indices in order and the deadline only moves one way, so
  // the companies actually attempted are always a prefix of the list. The
  // rotation cursor depends on that: it advances by the number attempted.
  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= companies.length) return;
      const entry = companies[i];

      // A halted run leaves the rest unsearched, not "searched and empty":
      // the cursor must not advance past companies nobody looked at.
      if (halted) {
        results[i] = { ...entry, deals: [], unsure: [], error: halted, skipped: true, halted: true };
        continue;
      }

      const remaining = deadline - Date.now();
      if (remaining < MIN_SLICE_MS) {
        results[i] = { ...entry, deals: [], unsure: [], error: null, skipped: true };
        continue;
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Math.min(remaining, PER_COMPANY_MS));
      try {
        const { deals, unsure, error, viaWebSearch } = await research(entry, since, until, { signal: controller.signal });
        results[i] = {
          ...entry, deals, unsure: unsure || [], error, skipped: false, viaWebSearch: !!viaWebSearch,
        };
      } catch (err) {
        if (err instanceof ResearchHaltedError) {
          halted = err.reason;
          results[i] = { ...entry, deals: [], unsure: [], error: halted, skipped: true, halted: true };
          continue;
        }
        // researchCompanyAcquisitions answers with an error rather than
        // throwing, but a hole in `results` would crash the email builder
        // and lose the whole digest, so don't rely on that.
        results[i] = { ...entry, deals: [], unsure: [], error: String(err?.message || err).slice(0, 200), skipped: false };
      } finally {
        clearTimeout(timer);
      }
    }
  }

  const workers = Math.max(1, Math.min(concurrency, companies.length));
  await Promise.all(Array.from({ length: workers }, worker));
  return results;
}

// Start the run at `startIndex` and wrap around, so a digest that can only
// reach part of its list covers a different part next time. Without this the
// tail of an alphabetical list is never searched at all.
export function rotateForRun(companies, startIndex) {
  const n = companies.length;
  if (n === 0) return [];
  const raw = Number(startIndex);
  const start = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) % n : 0;
  return start === 0 ? companies.slice() : [...companies.slice(start), ...companies.slice(0, start)];
}

// Where the next run should begin: just past the last company this run
// actually searched. A run that searched nothing leaves the cursor alone
// rather than advancing past companies it never looked at.
export function nextCursor(startIndex, results) {
  const n = results.length;
  if (n === 0) return 0;
  const attempted = results.filter((r) => !r.skipped).length;
  if (attempted === 0) return Number(startIndex) || 0;
  return ((Number(startIndex) || 0) + attempted) % n;
}

// ---- Email ---------------------------------------------------------------
function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function dealRow(deal) {
  const meta = [deal.dealType, deal.sector, deal.value, deal.sites ? `${deal.sites} sites` : '']
    .map((s) => String(s || '').trim())
    .filter(Boolean)
    .map(escapeHtml)
    .join(' · ');

  return `
    <tr>
      <td style="padding:10px 12px;border-top:1px solid #E2E8F0;vertical-align:top;white-space:nowrap;color:#64748B;font-size:12px">
        ${escapeHtml(deal.announcedOn)}
      </td>
      <td style="padding:10px 12px;border-top:1px solid #E2E8F0;vertical-align:top">
        <div style="font-weight:700;color:#0F172A;font-size:14px">${escapeHtml(deal.target)}</div>
        ${meta ? `<div style="color:#475569;font-size:12px;margin-top:2px">${meta}</div>` : ''}
        ${deal.buyer ? `<div style="color:#64748B;font-size:12px;margin-top:2px">Buyer: ${escapeHtml(deal.buyer)}</div>` : ''}
        ${deal.summary ? `<div style="color:#334155;font-size:13px;margin-top:6px;line-height:1.45">${escapeHtml(deal.summary)}</div>` : ''}
        <div style="margin-top:6px">
          <a href="${escapeHtml(deal.sourceUrl)}" style="color:#009530;font-size:12px;text-decoration:none">${escapeHtml(deal.sourceTitle)} →</a>
        </div>
      </td>
    </tr>`;
}

function companySection(result) {
  const badge = result.isPe
    ? '<span style="display:inline-block;padding:1px 7px;border-radius:999px;background:#F3E8FF;color:#7C3AED;font-size:10px;font-weight:700;vertical-align:middle;margin-left:8px">PE</span>'
    : '';

  const body = result.deals.length
    ? `<table style="width:100%;border-collapse:collapse;margin-top:6px">
         <tbody>${result.deals.map(dealRow).join('')}</tbody>
       </table>`
    : `<div style="color:#94A3B8;font-size:13px;padding:6px 0">
         ${result.skipped
           ? (result.halted
               ? 'Not searched - the run stopped before reaching it.'
               : 'Not searched this run - the digest ran out of time before reaching it. It moves to the front of the queue next run.')
           : result.error
             ? `Couldn't be researched: ${escapeHtml(result.error)}`
             : 'No acquisitions announced in this window.'}
       </div>`;

  return `
    <div style="margin:0 0 22px">
      <div style="font-size:15px;font-weight:700;color:#0F172A;border-bottom:2px solid #009530;padding-bottom:5px">
        ${escapeHtml(result.company)}${badge}
        ${result.deals.length ? `<span style="float:right;color:#009530;font-size:12px;font-weight:700">${result.deals.length} deal${result.deals.length === 1 ? '' : 's'}</span>` : ''}
      </div>
      ${body}
      ${unsureBlock(result.unsure)}
    </div>`;
}

// Headlines the rules could not place, listed rather than dropped.
//
// This is the honest half of a rules-based reader. It will miss shapes a
// model would catch - "backs the management buyout of", "agrees terms
// with" — and the failure mode that matters is not missing one, it is
// missing one silently. A line and a link lets the reader decide in two
// seconds, and keeps the digest's promise that what the feed found, the
// reader sees.
function unsureBlock(unsure) {
  if (!Array.isArray(unsure) || unsure.length === 0) return '';
  const rows = unsure.map((u) => `
    <div style="padding:4px 0;font-size:12px;line-height:1.45">
      <span style="color:#94A3B8">${escapeHtml(u.announcedOn)}</span>
      <a href="${escapeHtml(u.sourceUrl)}" style="color:#475569;text-decoration:none">${escapeHtml(u.title)}</a>
      <span style="color:#94A3B8">· ${escapeHtml(u.sourceTitle)}</span>
    </div>`).join('');
  return `
    <div style="margin-top:8px;padding-top:7px;border-top:1px dashed #E2E8F0">
      <div style="color:#64748B;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.04em">
        Also in the news - worth a look
      </div>
      ${rows}
    </div>`;
}

export function buildNewsEmailHtml(results, { since, until, message } = {}) {
  const hasContent = (r) => r.deals.length > 0 || (r.unsure || []).length > 0;
  const withDeals = results.filter(hasContent);
  const withoutDeals = results.filter((r) => !hasContent(r));
  const totalDeals = results.reduce((n, r) => n + r.deals.length, 0);
  const dealFirms = results.filter((r) => r.deals.length > 0).length;
  const totalUnsure = results.reduce((n, r) => n + (r.unsure || []).length, 0);
  const searchedCount = results.filter((r) => !r.skipped).length;

  const intro = message
    ? `<p style="color:#334155;font-size:14px;white-space:pre-wrap;margin:0 0 18px">${escapeHtml(message)}</p>`
    : '';

  // Companies with nothing to report are collapsed rather than given a
  // heading each — but "found nothing", "never searched" and "the search
  // failed" are three different things, and lumping them together is what
  // hid a digest that was quietly timing out after one company. Each
  // outcome gets its own line, and a failure prints its reason.
  const quiet = (label, entries, detail) => (entries.length
    ? `<div style="margin-top:22px;padding-top:14px;border-top:1px solid #E2E8F0">
         <div style="color:#64748B;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;margin-bottom:6px">
           ${escapeHtml(label)} (${entries.length})
         </div>
         <div style="color:#94A3B8;font-size:13px;line-height:1.6">
           ${entries.map((r) => escapeHtml(r.company) + (detail ? detail(r) : '')).join(' · ')}
         </div>
       </div>`
    : '');

  const searchedEmpty = withoutDeals.filter((r) => !r.skipped && !r.error);
  const failed = withoutDeals.filter((r) => !r.skipped && r.error);
  const notSearched = withoutDeals.filter((r) => r.skipped && !r.halted);
  const blocked = withoutDeals.filter((r) => r.halted);

  const quietList = [
    quiet('No acquisitions found', searchedEmpty),
    quiet('Search failed', failed, (r) => ` - ${escapeHtml(String(r.error).slice(0, 160))}`),
    quiet('Not searched this run - first in line next run', notSearched),
    quiet('Not searched - the run stopped before reaching them', blocked),
  ].join('');

  // An account-wide failure is not a per-company footnote. Twenty-one
  // firms each printing the same truncated billing error is how a digest
  // reports "nothing is running" as if it were news, so say it once, at
  // the top, in the words that name the fix.
  const fellBack = results.filter((r) => r.viaWebSearch);
  const haltReason = results.find((r) => r.halted)?.error;
  const haltBanner = haltReason
    ? `<div style="margin:0 0 18px;padding:12px 14px;border-radius:6px;background:#FEF2F2;border:1px solid #FCA5A5">
         <div style="color:#991B1B;font-size:13px;font-weight:700;margin-bottom:3px">Research stopped early</div>
         <div style="color:#7F1D1D;font-size:13px;line-height:1.5">
           ${escapeHtml(haltReason)}. No further companies were searched, so this digest is incomplete -
           the ones it missed are first in line once that is fixed.
         </div>
       </div>`
    : '';

  return `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:720px;margin:0 auto;padding:8px">
      <h2 style="color:#009530;margin:0 0 4px;font-size:20px">Company Acquisition News</h2>
      <div style="color:#64748B;font-size:12px;margin:0 0 18px">
        ${escapeHtml(formatWindow(since, until))} ·
        ${totalDeals
          ? `${totalDeals} acquisition${totalDeals === 1 ? '' : 's'} at ${dealFirms} of ${searchedCount} ${searchedCount === 1 ? 'company' : 'companies'} searched`
          : `no acquisitions · ${searchedCount} ${searchedCount === 1 ? 'company' : 'companies'} searched`}${searchedCount < results.length ? ` (${results.length} tracked)` : ''}${totalUnsure ? ` · ${totalUnsure} headline${totalUnsure === 1 ? '' : 's'} to check` : ''}
      </div>
      ${haltBanner}
      ${intro}
      ${withDeals.length
        ? withDeals.map(companySection).join('')
        : `<div style="color:#94A3B8;font-size:14px;padding:12px 0">No acquisitions were found in this window${searchedCount < results.length ? ` among the ${searchedCount} ${searchedCount === 1 ? 'company' : 'companies'} this run reached` : ''}.</div>`}
      ${quietList}
      ${fellBack.length
        ? `<div style="margin-top:22px;padding-top:12px;border-top:1px solid #E2E8F0;color:#94A3B8;font-size:11px;line-height:1.5">
             No news feed could be reached for ${fellBack.length} ${fellBack.length === 1 ? 'company' : 'companies'}
             (${fellBack.map((r) => escapeHtml(r.company)).join(', ')}), so those fell back to a slower web search.
           </div>`
        : ''}
      <div style="margin-top:26px;padding-top:12px;border-top:1px solid #E2E8F0;color:#94A3B8;font-size:11px;line-height:1.5">
        Companies are tracked by ticking “Track acquisition news” on the company popup in Prospect Tracker.
        Deals are read from public news feed headlines and can be incomplete - always confirm against the linked source before acting.
      </div>
    </div>`;
}

export function newsSubject(results, since, until) {
  const total = results.reduce((n, r) => n + r.deals.length, 0);
  return total
    ? `Acquisition news - ${total} deal${total === 1 ? '' : 's'} (${isoDate(since)} → ${isoDate(until)})`
    : `Acquisition news - no deals (${isoDate(since)} → ${isoDate(until)})`;
}

export async function sendCompanyNewsEmail({ to, subject, html, replyTo }) {
  return sendEmail({ to, subject, html, replyTo });
}

// One end-to-end digest: load the tracked companies, research them, build
// the email. Shared by the cron and the "send now" route so both produce
// exactly the same message. Returns null when there's nothing to send and
// the caller asked to skip empty runs.
export async function buildDigest(db, uid, email, {
  lastSentAt, message, skipWhenEmpty, startIndex = 0, budgetMs, minLookbackDays,
} = {}) {
  const companies = await loadTrackedCompanies(db, uid, email);
  if (companies.length === 0) {
    return { empty: true, reason: 'no-tracked-companies', companies: 0, deals: 0, html: null, nextStartIndex: 0 };
  }

  // Search order rotates run to run; the email lists them in that same
  // order, so the companies this run reached come before the ones it didn't.
  const ordered = rotateForRun(companies, startIndex);
  const { since, until } = digestWindow(lastSentAt, Date.now(), { minLookbackDays });
  const results = await researchAll(ordered, since, until, budgetMs ? { budgetMs } : {});
  const deals = results.reduce((n, r) => n + r.deals.length, 0);
  const nextStartIndex = nextCursor(startIndex, results);

  const halted = results.find((r) => r.halted)?.error || null;
  // Never suppress a halted run: "skip when empty" means "don't mail me a
  // quiet fortnight", not "don't tell me the research stopped working".
  if (deals === 0 && skipWhenEmpty && !halted) {
    return { empty: true, reason: 'no-deals', companies: companies.length, deals: 0, html: null, nextStartIndex };
  }

  return {
    empty: false,
    reason: null,
    companies: companies.length,
    searched: results.filter((r) => !r.skipped).length,
    // An account-wide stop belongs on the schedule row too — the email
    // says it, but the user looking at "why is this empty" in the UI
    // should not have to open the email to find out.
    halted,
    deals,
    since,
    until,
    results,
    nextStartIndex,
    html: buildNewsEmailHtml(results, { since, until, message }),
    defaultSubject: newsSubject(results, since, until),
  };
}
