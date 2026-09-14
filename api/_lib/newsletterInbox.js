// Industry newsletters as a deal source, read out of the app's own mailbox.
//
// The RSS feeds this digest runs on index the public web. A large share of
// PE deal flow lands first — sometimes only — in the trade newsletters,
// behind a login no crawler sees. PE Hub Wire and Axios Pro Rata carry
// add-ons and platform deals days before they surface in general news, and
// some never surface at all. They are the same shape as a feed once you
// stop thinking of them as email: curated, dated, headline plus link.
//
// Nothing new had to be paid for or signed up to. The mailbox the digest
// already sends from is a real Gmail account, and the GMAIL_APP_PASSWORD
// already in the environment unlocks IMAP on it as well as SMTP.
//
// ---- On reading someone's mail ------------------------------------------
// This code can read exactly one Gmail label and nothing else. It opens
// NEWSLETTER_LABEL (default "deal-news"), never INBOX, and inside that
// label it still only reads messages whose sender is on an allow-list. Two
// gates, because a feature that can read a mailbox is worth being paranoid
// about, and because the owner of the mailbox should be able to see at a
// glance which mail this can reach: the ones they filtered into that label.
//
// A missing label, a wrong password, a mailbox that can't be reached — all
// of it comes back as an error the digest carries on without. Newsletters
// add to the feeds; they are not load-bearing.

import { decodeEntities } from './newsFeeds.js';

export const DEFAULT_LABEL = 'deal-news';

// Senders whose mail may be read inside that label. Domains, matched on the
// right-hand side of the address, so a newsletter that changes its
// send-from prefix keeps working.
export const DEFAULT_SENDERS = [
  'pehub.com',
  'axios.com',
  'buyoutsinsider.com',
  'peimedia.com',
];

// What to call each source in the email, so a deal says where it came from.
const SOURCE_NAMES = [
  [/pehub\.com$/i, 'PE Hub Wire'],
  [/axios\.com$/i, 'Axios Pro Rata'],
  [/buyoutsinsider\.com$/i, 'Buyouts'],
  [/peimedia\.com$/i, 'Private Equity International'],
];

export function senderList() {
  const raw = String(process.env.NEWSLETTER_SENDERS || '').trim();
  if (!raw) return DEFAULT_SENDERS;
  return raw.split(/[,\s]+/).map(s => s.trim().toLowerCase().replace(/^@/, '')).filter(Boolean);
}

export function labelName() {
  return String(process.env.NEWSLETTER_LABEL || '').trim() || DEFAULT_LABEL;
}

export function isAllowedSender(address, allowed = senderList()) {
  const a = String(address || '').trim().toLowerCase();
  if (!a.includes('@')) return false;
  const domain = a.split('@').pop();
  return allowed.some(d => domain === d || domain.endsWith(`.${d}`));
}

export function sourceNameFor(address, fallback = 'Newsletter') {
  const domain = String(address || '').toLowerCase().split('@').pop() || '';
  for (const [re, name] of SOURCE_NAMES) if (re.test(domain)) return name;
  return String(fallback || 'Newsletter').slice(0, 60) || 'Newsletter';
}

// ---- Pulling headlines out of a newsletter -------------------------------
// Deliberately structural rather than per-publication. Both of these
// newsletters lay an item out the same way — a link, with the sentence
// around it carrying the actual news — and so does every other one. A
// parser written to PE Hub's current table markup would be a parser that
// breaks the next time PE Hub restyles its email, and would teach nothing
// about Axios. Reading the shape instead means one extractor for all of
// them, and a new newsletter costs an entry in the allow-list.

// Chrome that is never news, however deal-shaped the words around it.
const CHROME = /\b(unsubscribe|manage (your )?preferences|view (this )?(email )?in browser|privacy policy|terms of (use|service)|follow us|sponsored by|advertise with|was this forwarded|sign up here|update your|©\s*\d{4}|all rights reserved|contact us|about us)\b/i;

// Links that go somewhere other than an article.
const NON_ARTICLE = /(unsubscribe|mailto:|\/preferences|\/privacy|\/terms|twitter\.com|x\.com\/|linkedin\.com|facebook\.com|instagram\.com|youtube\.com|\.gif|\.png|\.jpg)/i;

const BLOCK_SPLIT = /<\/(?:p|div|td|tr|li|h[1-6]|table|blockquote)\s*>|<br\s*\/?>/i;

function textOf(html) {
  return decodeEntities(String(html || '').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    // Stripping a tag between a word and its punctuation leaves a gap —
    // "Acme Facilities , a Texas-based provider" — and that gap lands in
    // the middle of a company name when the target is read off it.
    .replace(/\s+([,.;:!?)])/g, '$1')
    .replace(/([(])\s+/g, '$1')
    // Newsletters lead items with a decorative glyph or bullet.
    .replace(/^[^\p{L}\p{N}$€£"']+/u, '')
    .trim();
}

/**
 * Every plausible headline in one newsletter body, as { title, link }.
 *
 * The title is the text of the block the link sits in, not the link's own
 * text: in Axios Pro Rata the anchor is often just the company name while
 * the sentence around it is the story ("Blackstone acquired Acme
 * Facilities, a Texas-based provider…"). Falling back to anchor text alone
 * would throw the news away and keep the company name.
 */
export function extractHeadlines(html) {
  const out = [];
  const seen = new Set();

  for (const rawBlock of String(html || '').split(BLOCK_SPLIT)) {
    if (!rawBlock) continue;

    // Every link in this block, with its own text.
    const anchors = [];
    for (const m of rawBlock.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
      const href = decodeEntities(m[1]).trim();
      if (!/^https?:\/\//i.test(href)) continue;
      if (NON_ARTICLE.test(href)) continue;
      anchors.push({ href, text: textOf(m[2]) });
    }
    if (anchors.length === 0) continue;

    const blockText = textOf(rawBlock);
    if (!blockText || CHROME.test(blockText)) continue;

    // The sentence around the link, when there is one; the link's own text
    // when the block is just the link.
    const title = blockText.length >= 25 && blockText.length <= 400
      ? blockText
      : anchors.map(a => a.text).find(t => t.length >= 25) || '';
    if (title.length < 25 || title.length > 400) continue;

    const key = title.toLowerCase().slice(0, 120);
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({ title, link: anchors[0].href });
    if (out.length >= 120) break;
  }
  return out;
}

// ---- Reading the label ---------------------------------------------------

/**
 * Newsletter headlines from the allow-listed senders in the configured
 * label, published inside the digest window.
 *
 * Returns { items, error }. Never throws: a mailbox this cannot reach is a
 * source the digest goes without, not a digest that fails.
 */
export async function fetchNewsletterItems(since, until, {
  user = process.env.GMAIL_USER,
  pass = process.env.GMAIL_APP_PASSWORD,
  label = labelName(),
  allowed = senderList(),
  // Seam for the tests: they need to drive this without a mailbox.
  connect = defaultConnect,
} = {}) {
  if (!user || !pass) return { items: [], error: null, configured: false };

  let session;
  try {
    session = await connect({ user, pass, label });
  } catch (err) {
    return { items: [], error: `Newsletter inbox unavailable: ${String(err?.message || err).slice(0, 140)}`, configured: true };
  }

  const items = [];
  try {
    for await (const msg of session.messages(new Date(since))) {
      const from = String(msg.from || '').toLowerCase();
      if (!isAllowedSender(from, allowed)) continue;
      const at = Number(msg.date);
      if (!Number.isFinite(at) || at < since || at > until) continue;

      const source = sourceNameFor(from, msg.fromName);
      for (const h of extractHeadlines(msg.html || '')) {
        items.push({
          title: h.title,
          link: h.link,
          publishedAt: at,
          source,
          description: '',
          fromNewsletter: true,
        });
      }
    }
  } catch (err) {
    // Partial is better than nothing: keep whatever was read before the
    // connection gave out.
    return { items, error: `Newsletter read stopped early: ${String(err?.message || err).slice(0, 140)}`, configured: true };
  } finally {
    try { await session.close(); } catch { /* closing a dead session is not an error */ }
  }

  return { items, error: null, configured: true };
}

// The real IMAP session. Kept behind the `connect` seam so everything above
// is testable without a mailbox, and so the dependency loads only when the
// feature is actually configured.
async function defaultConnect({ user, pass, label }) {
  const { ImapFlow } = await import('imapflow');
  const { simpleParser } = await import('mailparser');

  const client = new ImapFlow({
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: { user, pass },
    logger: false,
    // A cron has a budget; a mailbox that will not answer must not eat it.
    socketTimeout: 20_000,
    greetingTimeout: 10_000,
  });
  await client.connect();

  let lock;
  try {
    // The one mailbox this may open. Anything else - INBOX included - is
    // not reachable from here by construction.
    lock = await client.getMailboxLock(label);
  } catch (err) {
    try { await client.logout(); } catch { /* already gone */ }
    throw new Error(`label "${label}" not found (${String(err?.message || err).slice(0, 60)})`);
  }

  return {
    async *messages(sinceDate) {
      for await (const msg of client.fetch({ since: sinceDate }, { source: true, envelope: true })) {
        const parsed = await simpleParser(msg.source);
        const addr = parsed.from?.value?.[0] || {};
        yield {
          from: addr.address || '',
          fromName: addr.name || '',
          date: (parsed.date || msg.envelope?.date || new Date(0)).getTime(),
          html: parsed.html || parsed.textAsHtml || '',
        };
      }
    },
    async close() {
      try { lock.release(); } finally { await client.logout(); }
    },
  };
}
