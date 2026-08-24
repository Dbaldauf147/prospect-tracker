// Acquisition-news digest for companies the user has flagged on the
// company popup ("Track acquisition news"). Each flagged company gets one
// Claude web-search pass looking for acquisitions *that company made* in
// the digest window; the results are grouped into an HTML email.
//
// The focus is deliberately narrow — who bought whom — because that's the
// signal that creates an opp: a PE firm adding a platform or a bolt-on
// means new sites to serve. Funding rounds, earnings and leadership moves
// are out of scope; see NEWS_SYSTEM_PROMPT.
//
// PE firms are called out first in the email and searched with extra
// budget, since a firm's add-ons are the densest source of new accounts.

import { sendEmail } from './mailer.js';
import { researchBudgetMs } from './researchBudget.js';

// A prospect opts in with `trackAcquisitionNews: true`, written by the
// checkbox on the company popup (ProspectModal).
export const NEWS_FLAG = 'trackAcquisitionNews';

// How far back the very first digest looks when a schedule has never
// sent. After that the window starts at the previous successful send.
const FIRST_RUN_LOOKBACK_DAYS = 7;

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
// Starts at the schedule's last successful send so a skipped or failed
// week is picked up by the next one rather than silently dropped.
export function digestWindow(lastSentAt, now = Date.now()) {
  const maxMs = MAX_LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
  const firstRunMs = FIRST_RUN_LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
  const last = Number(lastSentAt);
  const since = Number.isFinite(last) && last > 0
    ? Math.max(last, now - maxMs)
    : now - firstRunMs;
  return { since, until: now };
}

function isoDate(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

export function formatWindow(since, until) {
  return `${isoDate(since)} → ${isoDate(until)}`;
}

// ---- Claude research ----------------------------------------------------
const NEWS_SYSTEM_PROMPT = `You are an M&A research assistant. You find acquisitions that a specific company ANNOUNCED or COMPLETED inside a date window, using web search.

Scope — include ONLY these:
- The company acquiring another company, business unit, or asset portfolio.
- For a private equity / investment firm: new platform investments, add-on / bolt-on acquisitions made by its portfolio companies, take-privates, and majority recapitalizations. An add-on counts even when the buyer of record is the portfolio company, as long as the firm is named as the sponsor.

Exclude ALL of the following, even when reported in the same article:
- The company itself being acquired, or a stake in it being sold.
- Minority investments with no control, venture rounds, and funding rounds the company merely participated in.
- Fund closes, capital raises, dry powder announcements.
- Exits, divestitures, and sales of portfolio companies.
- Earnings, leadership changes, expansions, partnerships, product launches, litigation.
- Rumoured, "exploring", "in talks", or unconfirmed deals.

Date rule: the announcement date must fall inside the window given by the user. A deal announced before the window does not belong, even if it closed inside it. If you cannot establish an announcement date inside the window from a source, leave the deal out.

Return ONLY a JSON object (no prose, no markdown fences) of this exact shape:
{
  "deals": [
    {
      "target": "name of the company/asset acquired",
      "announcedOn": "YYYY-MM-DD",
      "buyer": "the acquiring entity — the portfolio company for an add-on, otherwise the company itself",
      "dealType": one of "Platform", "Add-on", "Take-private", "Asset purchase", "Acquisition",
      "sector": "short sector label for the target, e.g. Industrial Services",
      "sites": "site/facility count or footprint if reported, else empty string",
      "value": "reported deal value if disclosed, e.g. \\"$450M\\", else empty string",
      "summary": "one sentence, max 220 characters, on what the target does and why it was bought",
      "sourceTitle": "publication or headline",
      "sourceUrl": "direct link to the article"
    }
  ]
}

Every deal MUST have a sourceUrl you actually found via search. If there are no qualifying acquisitions in the window, return {"deals": []}. Never invent a deal, a date, or a URL.`;

// One research pass for one company. Returns { deals, error } — a failure
// on one company must never sink the whole digest, so errors come back as
// data rather than thrown.
export async function researchCompanyAcquisitions(entry, since, until, { signal } = {}) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { deals: [], error: 'ANTHROPIC_API_KEY not configured' };

  const peHint = entry.isPe
    ? ` "${entry.company}" is a private equity firm: search for its new platform investments AND the add-on acquisitions its portfolio companies made with it as sponsor.`
    : '';
  const siteHint = entry.website ? ` Its website is ${entry.website}.` : '';

  const userPrompt = `Find every acquisition made by "${entry.company}" announced between ${isoDate(since)} and ${isoDate(until)} (inclusive).${peHint}${siteHint}

Search the web before answering — do not answer from memory alone. Return the JSON object as specified.`;

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
        system: NEWS_SYSTEM_PROMPT,
        // A PE firm's add-ons are spread across its portfolio companies,
        // so it needs more searches than an operating company whose deals
        // all carry its own name.
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
      return { deals: [], error: `Claude API error ${resp.status}: ${errText.slice(0, 300)}` };
    }

    const data = await resp.json();
    // A safety decline arrives as HTTP 200 with stop_reason "refusal" and
    // no usable content, so check it before parsing.
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

    return { deals: normalizeDeals(parsed.deals, since, until), error: null };
  } catch (err) {
    if (err?.name === 'AbortError') return { deals: [], error: 'Research timed out' };
    return { deals: [], error: String(err?.message || err).slice(0, 200) };
  }
}

// Keep only deals that carry a target, a source URL, and an announcement
// date inside the window. The date check is repeated here because the
// model occasionally returns a well-sourced deal from just outside it,
// and a digest that quietly widens its own window is worse than a short one.
function normalizeDeals(raw, since, until) {
  if (!Array.isArray(raw)) return [];
  const str = (v, max) => String(v ?? '').trim().slice(0, max);
  // Compare on the calendar day so a deal announced on the window's first
  // or last day survives the timestamp-vs-date mismatch.
  const lo = isoDate(since);
  const hi = isoDate(until);

  const out = [];
  const seen = new Set();
  for (const d of raw) {
    if (!d || typeof d !== 'object') continue;
    const target = str(d.target, 200);
    const sourceUrl = str(d.sourceUrl || d.url, 500);
    const announcedOn = str(d.announcedOn, 10);
    if (!target || !sourceUrl) continue;
    if (!/^https?:\/\//i.test(sourceUrl)) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(announcedOn)) continue;
    if (announcedOn < lo || announcedOn > hi) continue;

    // The same deal often surfaces from two outlets; key on the target and
    // date so the email lists it once.
    const key = `${target.toLowerCase()}|${announcedOn}`;
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({
      target,
      announcedOn,
      buyer: str(d.buyer, 200),
      dealType: str(d.dealType, 40) || 'Acquisition',
      sector: str(d.sector, 80),
      sites: str(d.sites, 60),
      value: str(d.value, 40),
      summary: str(d.summary, 220),
      sourceTitle: str(d.sourceTitle, 200) || 'Source',
      sourceUrl,
    });
  }
  out.sort((a, b) => b.announcedOn.localeCompare(a.announcedOn));
  return out.slice(0, 25);
}

// Research every tracked company, one after another. Sequential on
// purpose: the whole run shares one function timeout, and a burst of
// parallel web-search calls is the fastest way to trip Anthropic's rate
// limit and lose the entire digest instead of its tail.
export async function researchAll(companies, since, until) {
  const deadline = Date.now() + researchBudgetMs();
  const results = [];

  for (const entry of companies) {
    const remaining = deadline - Date.now();
    // Below this there isn't time for a search loop to finish; record the
    // rest as skipped so the email says what it didn't cover.
    if (remaining < 8000) {
      results.push({ ...entry, deals: [], error: null, skipped: true });
      continue;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), remaining);
    try {
      const { deals, error } = await researchCompanyAcquisitions(entry, since, until, { signal: controller.signal });
      results.push({ ...entry, deals, error, skipped: false });
    } finally {
      clearTimeout(timer);
    }
  }
  return results;
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
           ? 'Not searched this run — the digest ran out of time before reaching it.'
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
    </div>`;
}

export function buildNewsEmailHtml(results, { since, until, message } = {}) {
  const withDeals = results.filter((r) => r.deals.length > 0);
  const withoutDeals = results.filter((r) => r.deals.length === 0);
  const totalDeals = withDeals.reduce((n, r) => n + r.deals.length, 0);

  const intro = message
    ? `<p style="color:#334155;font-size:14px;white-space:pre-wrap;margin:0 0 18px">${escapeHtml(message)}</p>`
    : '';

  // Companies with nothing to report are collapsed into one line rather
  // than given a heading each — the point of the email is the deals.
  const quietList = withoutDeals.length
    ? `<div style="margin-top:26px;padding-top:14px;border-top:1px solid #E2E8F0">
         <div style="color:#64748B;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;margin-bottom:6px">
           No acquisitions found (${withoutDeals.length})
         </div>
         <div style="color:#94A3B8;font-size:13px;line-height:1.6">
           ${withoutDeals.map((r) => escapeHtml(r.company) + (r.skipped ? ' (not searched)' : r.error ? ' (error)' : '')).join(' · ')}
         </div>
       </div>`
    : '';

  return `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:720px;margin:0 auto;padding:8px">
      <h2 style="color:#009530;margin:0 0 4px;font-size:20px">Company Acquisition News</h2>
      <div style="color:#64748B;font-size:12px;margin:0 0 18px">
        ${escapeHtml(formatWindow(since, until))} ·
        ${totalDeals} acquisition${totalDeals === 1 ? '' : 's'} across ${withDeals.length} of ${results.length} tracked ${results.length === 1 ? 'company' : 'companies'}
      </div>
      ${intro}
      ${withDeals.length
        ? withDeals.map(companySection).join('')
        : '<div style="color:#94A3B8;font-size:14px;padding:12px 0">No acquisitions were found for any tracked company in this window.</div>'}
      ${quietList}
      <div style="margin-top:26px;padding-top:12px;border-top:1px solid #E2E8F0;color:#94A3B8;font-size:11px;line-height:1.5">
        Companies are tracked by ticking “Track acquisition news” on the company popup in Prospect Tracker.
        Deals are found by web search and can be incomplete — always confirm against the linked source before acting.
      </div>
    </div>`;
}

export function newsSubject(results, since, until) {
  const total = results.reduce((n, r) => n + r.deals.length, 0);
  return total
    ? `Acquisition news — ${total} deal${total === 1 ? '' : 's'} (${isoDate(since)} → ${isoDate(until)})`
    : `Acquisition news — no deals (${isoDate(since)} → ${isoDate(until)})`;
}

export async function sendCompanyNewsEmail({ to, subject, html, replyTo }) {
  return sendEmail({ to, subject, html, replyTo });
}

// One end-to-end digest: load the tracked companies, research them, build
// the email. Shared by the cron and the "send now" route so both produce
// exactly the same message. Returns null when there's nothing to send and
// the caller asked to skip empty runs.
export async function buildDigest(db, uid, email, { lastSentAt, message, skipWhenEmpty } = {}) {
  const companies = await loadTrackedCompanies(db, uid, email);
  if (companies.length === 0) {
    return { empty: true, reason: 'no-tracked-companies', companies: 0, deals: 0, html: null };
  }

  const { since, until } = digestWindow(lastSentAt);
  const results = await researchAll(companies, since, until);
  const deals = results.reduce((n, r) => n + r.deals.length, 0);

  if (deals === 0 && skipWhenEmpty) {
    return { empty: true, reason: 'no-deals', companies: companies.length, deals: 0, html: null };
  }

  return {
    empty: false,
    reason: null,
    companies: companies.length,
    deals,
    since,
    until,
    results,
    html: buildNewsEmailHtml(results, { since, until, message }),
    defaultSubject: newsSubject(results, since, until),
  };
}
