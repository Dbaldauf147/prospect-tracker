// Email draft history: the pure half (no Firebase), so it can be tested in
// plain Node. The Firestore half lives in emailDraftHistoryStore.js.
//
// The Saved Drafts card on the composer only keeps the 5 most recent
// unpinned drafts, because it lives on the settings document and that
// document has a 1 MiB budget shared with everything else. The history is
// the indefinite record: one Firestore document per distinct draft, so it
// can grow without ever touching that budget.
//
// A history entry is keyed by a fingerprint of its content (subject, body,
// recipients, CC, banner). Saving the same draft twice, or sending it, bumps
// the existing entry instead of piling up identical copies; any edit makes a
// new entry, so every version that was ever saved is kept.
//
// An entry can be tied to an email campaign. Campaigns are keyed by their
// primary subject line everywhere else in the app (see campaignSubjects.js),
// so the link is stored as that subject.

import { campaignSubjects, primarySubject, matchedSubject } from './campaignSubjects.js';

// The composer's autosave slot (a mirrored work key, see mirroredWorkKeys).
// Writing a draft here before the composer mounts is how the history tab
// opens one in it.
export const DRAFT_AUTOSAVE_KEY = 'prospect-draft-autosave';

// cyrb53: a fast 53-bit string hash. Two drafts colliding would merge their
// histories, so 32 bits (a few thousand drafts in, a real chance) is not
// enough; 53 bits is.
function cyrb53(str, seed = 0) {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i += 1) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

function recipientKey(c) {
  return String(c?.email || c?.id || c?.name || '').trim().toLowerCase();
}

/** Stable id for a draft's content. Recipient order doesn't count. */
export function draftFingerprint({ subject, body, contacts, cc, bannerId } = {}) {
  const to = (Array.isArray(contacts) ? contacts : []).map(recipientKey).filter(Boolean).sort();
  const ccs = (Array.isArray(cc) ? cc : []).map(x => String(x || '').trim().toLowerCase()).filter(Boolean).sort();
  const text = JSON.stringify([String(subject || '').trim(), String(body || ''), to, ccs, String(bannerId || '')]);
  return `d-${cyrb53(text).toString(36)}`;
}

/** The body as plain text, for the snippet column and for searching. */
export function draftPlainText(html) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/(p|div|li|h\d)>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/** Whether there is anything worth keeping (Quill's empty body is <p><br></p>). */
export function draftHasContent({ subject, body } = {}) {
  return !!(String(subject || '').trim() || draftPlainText(body));
}

// Firestore rejects `undefined` anywhere in a document, and recipient
// objects come from several sources with optional fields. A JSON round trip
// drops them (and anything else that isn't plain data).
function plain(value) {
  try { return JSON.parse(JSON.stringify(value ?? null)); } catch { return null; }
}

/**
 * The document a new history entry is written as. `via` is 'saved' (the
 * Save Draft button) or 'sent' (one of the send/download paths). `campaign`
 * is a campaign's primary subject, or '' for none.
 */
export function buildHistoryEntry(draft, { via = 'saved', campaign = '', now = new Date().toISOString() } = {}) {
  const contacts = plain(Array.isArray(draft?.contacts) ? draft.contacts : []) || [];
  const cc = (Array.isArray(draft?.cc) ? draft.cc : []).map(x => String(x || '').trim()).filter(Boolean);
  const sent = via === 'sent';
  return {
    id: draftFingerprint(draft),
    subject: String(draft?.subject || '').trim(),
    body: String(draft?.body || ''),
    contacts,
    cc,
    bannerId: String(draft?.bannerId || ''),
    createdAt: draft?.createdAt || now,
    lastSavedAt: now,
    saveCount: 1,
    sentCount: sent ? 1 : 0,
    lastSentAt: sent ? now : '',
    campaign: String(campaign || ''),
  };
}

/**
 * What an existing entry becomes when the same draft is saved or sent again.
 * An explicit campaign wins; otherwise the entry keeps the one it had (a link
 * made by hand on the history tab isn't undone by a later save).
 */
export function mergeHistoryEntry(existing, incoming) {
  const sent = incoming.sentCount > 0;
  return {
    lastSavedAt: incoming.lastSavedAt,
    saveCount: (Number(existing?.saveCount) || 1) + 1,
    sentCount: (Number(existing?.sentCount) || 0) + (sent ? 1 : 0),
    lastSentAt: sent ? incoming.lastSentAt : (existing?.lastSentAt || ''),
    campaign: incoming.campaign || existing?.campaign || '',
  };
}

/**
 * The campaign a draft most likely belongs to: the one whose subject line is
 * contained in the draft's subject (the same test the campaign report uses
 * to claim a sent email), longest match winning. '' when none claims it.
 */
export function suggestCampaignFor(campaigns, subject) {
  let best = '';
  let bestLen = 0;
  for (const c of Array.isArray(campaigns) ? campaigns : []) {
    const hit = matchedSubject(c, subject);
    if (hit && hit.length > bestLen) { best = primarySubject(c); bestLen = hit.length; }
  }
  return best;
}

/**
 * The saved campaign a stored link points at, matching any of its subject
 * lines case-insensitively, so a campaign whose first subject was later
 * reordered still resolves. null when it no longer exists.
 */
export function findLinkedCampaign(campaigns, link) {
  const key = String(link || '').trim().toLowerCase();
  if (!key) return null;
  for (const c of Array.isArray(campaigns) ? campaigns : []) {
    if (campaignSubjects(c).some(s => s.toLowerCase() === key)) return c;
  }
  return null;
}

/** Normalize a stored document so a half-written one can't crash the tab. */
export function normalizeHistoryEntry(id, data) {
  const d = data && typeof data === 'object' ? data : {};
  return {
    id: String(id || d.id || ''),
    subject: String(d.subject || ''),
    body: String(d.body || ''),
    contacts: Array.isArray(d.contacts) ? d.contacts : [],
    cc: Array.isArray(d.cc) ? d.cc.map(String) : [],
    bannerId: String(d.bannerId || ''),
    createdAt: String(d.createdAt || d.lastSavedAt || ''),
    lastSavedAt: String(d.lastSavedAt || d.createdAt || ''),
    saveCount: Number(d.saveCount) || 1,
    sentCount: Number(d.sentCount) || 0,
    lastSentAt: String(d.lastSentAt || ''),
    campaign: String(d.campaign || ''),
  };
}
