// Bad email addresses: ones a delivery-failure notice came back for, from
// the notices Dan forwards to the app's mailbox (api/bounce-inbox.js, read
// by BouncedEmailWatcher). Stored per user as
// settings.badEmails = { [lowercased address]: { at, subject, reason,
// clearedAt? } }.
//
// "Mark fixed" on the contact popup stamps clearedAt rather than deleting
// the entry, so the next inbox scan, which finds the same old notice again,
// doesn't flag it straight back. Only a notice newer than the stamp does.

export const normEmail = (e) => String(e || '').trim().toLowerCase();

/** The entry while it stands (a bounce after any Mark fixed), else null. */
export function badEmailInfo(map, email) {
  const e = map && typeof map === 'object' ? map[normEmail(email)] : null;
  if (!e || !e.at) return null;
  if (e.clearedAt && Date.parse(e.clearedAt) >= Date.parse(e.at)) return null;
  return e;
}

/**
 * The map with `bounces` ([{ address, at, subject, reason }]) folded in:
 * each address keeps its newest notice. Returns null when nothing changes.
 */
export function withBounces(map, bounces) {
  const cur = map && typeof map === 'object' && !Array.isArray(map) ? map : {};
  const out = { ...cur };
  let changed = false;
  for (const b of bounces || []) {
    const key = normEmail(b?.address);
    if (!key || !b.at) continue;
    const prev = out[key];
    if (prev && Date.parse(prev.at) >= Date.parse(b.at)) continue;
    out[key] = {
      at: b.at,
      subject: String(b.subject || '').slice(0, 200),
      reason: String(b.reason || '').slice(0, 200),
      ...(prev?.clearedAt ? { clearedAt: prev.clearedAt } : {}),
    };
    changed = true;
  }
  return changed ? out : null;
}

/** updateSettings() function folding bounces in, built on the settings at save time. */
export function badEmailsUpdate(bounces) {
  return (settings) => {
    const next = withBounces(settings?.badEmails, bounces);
    return next ? { badEmails: next } : null;
  };
}

/** updateSettings() function for Mark fixed on one address. */
export function clearBadEmailUpdate(email, nowIso = new Date().toISOString()) {
  return (settings) => {
    const key = normEmail(email);
    const cur = settings?.badEmails?.[key];
    if (!cur) return null;
    return { badEmails: { ...settings.badEmails, [key]: { ...cur, clearedAt: nowIso } } };
  };
}

// ---- Failed addresses a contact has moved off -------------------------------
// A bad-email flag is keyed by the address, so replacing a bounced address on
// the contact popup used to lose it: the new address is clean and nothing on
// the contact said the old one had failed. The popup now files the old
// address here when it saves the change:
// settings.contactFailedEmails = { [contactId]: [{ email, at, reason,
// replacedAt }] }, newest first, one entry per address.

/** The failed addresses on record for a contact, newest first. */
export function contactFailedEmails(map, contactId) {
  const list = map && typeof map === 'object' ? map[String(contactId ?? '')] : null;
  return Array.isArray(list) ? list.filter(x => x && x.email) : [];
}

/**
 * Every address of a contact that has bounced, for the popup's Failed
 * emails line: the address it has now (while its bad-email flag stands),
 * the ones it moved off (`failed`, from contactFailedEmails), and any in
 * its Old Emails box that a bounce notice names. One entry per address,
 * the current one first, then newest bounce first:
 * [{ email, at, reason, replacedAt?, current?, recorded? }]. `recorded`
 * marks the entries stored on the contact, which are the ones that can be
 * taken off it; the rest are flags on the address itself (Mark fixed).
 */
export function contactBouncedEmails(failed, map, { current = '', oldEmails = '' } = {}) {
  const out = [];
  const seen = new Set();
  const add = (email, entry) => {
    const key = normEmail(email);
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push({ ...entry, email: key });
  };
  const cur = badEmailInfo(map, current);
  if (cur) add(current, { at: cur.at, reason: cur.reason || '', current: true });
  const rest = [];
  for (const x of failed || []) if (x?.email) rest.push({ ...x, recorded: true });
  for (const e of String(oldEmails || '').split(/[\s,;]+/)) {
    const info = e.includes('@') ? badEmailInfo(map, e) : null;
    if (info) rest.push({ email: e, at: info.at, reason: info.reason || '' });
  }
  const time = (x) => Date.parse(x.at) || 0;
  // Stable sort, so a stored entry wins over the same address in Old Emails.
  rest.sort((a, b) => time(b) - time(a));
  for (const x of rest) add(x.email, x);
  return out;
}

/**
 * updateSettings() function filing `email` as a failed address of the
 * contact. `info` is its bad-email entry (for the bounce date and reason).
 */
export function recordFailedEmailUpdate(contactId, email, info, nowIso = new Date().toISOString()) {
  return (settings) => {
    const id = String(contactId ?? '');
    const key = normEmail(email);
    if (!id || !key) return null;
    const all = settings?.contactFailedEmails && typeof settings.contactFailedEmails === 'object' ? settings.contactFailedEmails : {};
    const cur = contactFailedEmails(all, id);
    const entry = { email: key, at: info?.at || '', reason: String(info?.reason || '').slice(0, 200), replacedAt: nowIso };
    const same = cur.find(x => normEmail(x.email) === key);
    if (same && same.at === entry.at) return null;
    return { contactFailedEmails: { ...all, [id]: [entry, ...cur.filter(x => normEmail(x.email) !== key)] } };
  };
}

/** updateSettings() function taking one failed address off a contact. */
export function removeFailedEmailUpdate(contactId, email) {
  return (settings) => {
    const id = String(contactId ?? '');
    const key = normEmail(email);
    const all = settings?.contactFailedEmails;
    const cur = contactFailedEmails(all, id);
    if (!cur.some(x => normEmail(x.email) === key)) return null;
    const rest = cur.filter(x => normEmail(x.email) !== key);
    const next = { ...all };
    if (rest.length) next[id] = rest; else delete next[id];
    return { contactFailedEmails: next };
  };
}

/**
 * The contact (from `contacts`) that moved off `email` after it failed, or
 * null. A campaign row or a To chip keeps the address the email went to, so
 * looking the contact up by it finds nobody once the address is replaced,
 * and the popup used to open a blank record holding the bad address again.
 * `map` defaults to the published settings.contactFailedEmails.
 */
export function contactMovedOffEmail(email, contacts, map = published.failedByContact) {
  const key = normEmail(email);
  if (!key || !map || typeof map !== 'object') return null;
  const ids = new Set(Object.keys(map).filter(id => contactFailedEmails(map, id).some(x => normEmail(x.email) === key)));
  if (!ids.size) return null;
  return (contacts || []).find(c => ids.has(String(c?.id ?? c?.vid ?? ''))) || null;
}

/** The tooltip line for a failed address a contact has moved off. */
export function failedEmailChipTitle(entry) {
  if (!entry) return '';
  const day = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); };
  const bounced = day(entry.at);
  const replaced = day(entry.replacedAt);
  const where = entry.current ? ' This is the address on the contact now.' : replaced ? ` Replaced on ${replaced}.` : '';
  return `Bounced${bounced ? ` on ${bounced}` : ''}${entry.reason ? `: ${entry.reason}` : ''}.${where}`;
}

/** The tooltip line for a flagged address. */
export function badEmailTitle(info) {
  if (!info) return '';
  const day = (() => { const d = new Date(info.at); return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); })();
  return `Bounced${day ? ` on ${day}` : ''}${info.reason ? `: ${info.reason}` : ''}${info.subject ? ` (notice: "${info.subject}")` : ''}`;
}

// ---- App-wide access -------------------------------------------------------
// The contact popup opens from a dozen pages, each wiring its own props;
// rather than thread settings.badEmails through all of them, App publishes
// the map (and the Mark fixed save) here through BouncedEmailWatcher, and
// useBadEmails() in components/badEmailsHook reads it.
let published = { map: {}, clear: null, failedByContact: {}, recordFailed: null, removeFailed: null };
const listeners = new Set();
export function publishBadEmails(map, clear, failed = {}) {
  const failedByContact = failed.failedByContact && typeof failed.failedByContact === 'object' ? failed.failedByContact : published.failedByContact;
  const recordFailed = failed.recordFailed || null;
  const removeFailed = failed.removeFailed || null;
  if (published.map === map && published.clear === clear && published.failedByContact === failedByContact
    && published.recordFailed === recordFailed && published.removeFailed === removeFailed) return;
  published = { map: map && typeof map === 'object' ? map : {}, clear: clear || null, failedByContact, recordFailed, removeFailed };
  for (const l of listeners) l();
}
export function subscribeBadEmails(l) { listeners.add(l); return () => listeners.delete(l); }
export function getPublishedBadEmails() { return published; }
