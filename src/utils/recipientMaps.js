// The contact popup's To Also / CC recipients: two settings maps,
// `toAlsoMap` and `ccMap`, each { [primaryEmail]: [address, ...] }, which
// Draft Emails reads to add those addresses whenever the contact is
// emailed.
//
// They used to be saved the way the popup was handed them: copy the map
// the popup opened with, set this contact's entry, save the copy over the
// whole key. Two things went wrong with that, and between them they wiped
// people's To / CC lines:
//
//   - The copy is the popup's, not the latest. Anything saved since it
//     opened (another contact's CC, from another popup or device) went
//     back to what the copy held, and a copy taken while settings were
//     still loading held nothing at all, so one save emptied every
//     contact's list.
//   - The popup read this contact's recipients once, when it opened, and
//     saved them back on every save, a tag click included. Opened before
//     the maps arrived, it held none, and the first save of anything on
//     the contact deleted its To / CC.
//
// So a save now names one contact's entry and is applied to the settings
// as they are when it lands (setRecipients through updateSettings' function
// form), and the popup writes it only when its To / CC was actually edited.
// recoverRecipientMaps puts back what was lost, from the backups.

export const RECIPIENT_MAP_KEYS = ['toAlsoMap', 'ccMap'];

const clean = (list) => {
  const out = [];
  for (const a of Array.isArray(list) ? list : []) {
    const s = String(a ?? '').trim();
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
};

/** A copy of `map` with `email`'s entry set to `list`, or removed when it is empty. */
export function setRecipients(map, email, list) {
  const key = String(email ?? '').trim();
  const next = { ...(map && typeof map === 'object' ? map : {}) };
  if (!key) return next;
  const addrs = clean(list);
  if (addrs.length) next[key] = addrs;
  else delete next[key];
  return next;
}

/**
 * The onSave handler a popup is given for one of the maps. The popup calls
 * it with (email, list); the entry is set on the latest settings, never on
 * a copy the popup holds. Still takes a whole map, for any older caller,
 * but refuses one that would remove other contacts' entries: a popup only
 * ever edits its own contact, so a map missing others is a stale copy.
 */
export function recipientMapSaver(updateSettings, key) {
  return (emailOrMap, list) => {
    if (!updateSettings) return;
    if (typeof emailOrMap === 'string') {
      updateSettings((s) => ({ [key]: setRecipients(s?.[key], emailOrMap, list) }));
      return;
    }
    const incoming = emailOrMap && typeof emailOrMap === 'object' ? emailOrMap : {};
    updateSettings((s) => {
      const cur = s?.[key] && typeof s[key] === 'object' ? s[key] : {};
      const dropped = Object.keys(cur).filter(k => !(k in incoming));
      if (dropped.length > 1) {
        console.warn(`Refused a ${key} save that would remove ${dropped.length} contacts' recipients`);
        return null;
      }
      return { [key]: incoming };
    });
  };
}

/**
 * What the backups hold that the current maps have lost: for each map, the
 * entries of contacts that have none now, each from the newest backup that
 * has one. A contact that has recipients now is left alone, so nothing set
 * since is undone. `sources` is newest first: [{ label, data: { ccMap, toAlsoMap } }].
 *
 * Returns { patch: { ccMap?, toAlsoMap? }, found: [{ key, email, list, from }] }
 * where each patch value is the current map with the found entries added.
 */
export function recoverRecipientMaps(current, sources) {
  const found = [];
  const patch = {};
  for (const key of RECIPIENT_MAP_KEYS) {
    const cur = current?.[key] && typeof current[key] === 'object' ? current[key] : {};
    const have = new Set(Object.keys(cur).filter(k => clean(cur[k]).length).map(k => k.toLowerCase()));
    const add = {};
    for (const src of sources || []) {
      const map = src?.data?.[key];
      if (!map || typeof map !== 'object') continue;
      for (const [email, list] of Object.entries(map)) {
        const lk = String(email).trim().toLowerCase();
        const addrs = clean(list);
        if (!lk || !addrs.length || have.has(lk)) continue;
        have.add(lk);
        add[email] = addrs;
        found.push({ key, email, list: addrs, from: src.label || '' });
      }
    }
    if (Object.keys(add).length) patch[key] = { ...cur, ...add };
  }
  return { patch, found };
}

const lower = (s) => String(s ?? '').trim().toLowerCase();
const countEntries = (map) => (map && typeof map === 'object'
  ? Object.values(map).filter(l => clean(l).length).length : 0);

/**
 * Entries kept under an address that is no contact's email now, but is one
 * of a contact's Old Emails: the contact's address changed and its To / CC
 * stayed behind under the old one, where nothing looks it up. Moved onto
 * the current address, unless that address already has its own.
 * `contacts` is [{ id or vid, email }]; `oldEmailsById` the contactOldEmails
 * setting, keyed by that id.
 *
 * Returns { patch, moved: [{ key, from, to }] }.
 */
export function rekeyOrphanRecipients(current, contacts, oldEmailsById = {}) {
  const live = new Map(); // lowercased current email -> email as the contact has it
  const byOld = new Map(); // lowercased old email -> current email
  for (const c of contacts || []) {
    const e = String(c?.email ?? '').trim();
    if (!e) continue;
    live.set(lower(e), e);
    const id = c?.id ?? c?.vid;
    const olds = String((id != null && oldEmailsById?.[id]) || '').split(/[\s,;]+/);
    for (const o of olds) if (lower(o) && !byOld.has(lower(o))) byOld.set(lower(o), e);
  }
  const patch = {};
  const moved = [];
  for (const key of RECIPIENT_MAP_KEYS) {
    const cur = current?.[key] && typeof current[key] === 'object' ? current[key] : {};
    const has = new Set(Object.keys(cur).filter(k => clean(cur[k]).length).map(lower));
    let next = null;
    for (const [k, list] of Object.entries(cur)) {
      if (live.has(lower(k)) || !clean(list).length) continue;
      const to = byOld.get(lower(k));
      if (!to || has.has(lower(to))) continue;
      next = next || { ...cur };
      next[to] = clean(list);
      delete next[k];
      has.add(lower(to));
      moved.push({ key, from: k, to });
    }
    if (next) patch[key] = next;
  }
  return { patch, moved };
}

/**
 * What the search saw, for when it finds nothing to put back: how many
 * contacts have To / CC now and how many of those sit under an address no
 * contact on the page has, and the most any backup held.
 */
export function describeRecipientSearch(current, sources, contacts) {
  const live = new Set((contacts || []).map(c => lower(c?.email)).filter(Boolean));
  const now = {};
  for (const key of RECIPIENT_MAP_KEYS) {
    const cur = current?.[key] && typeof current[key] === 'object' ? current[key] : {};
    const keys = Object.keys(cur).filter(k => clean(cur[k]).length);
    now[key] = { total: keys.length, unmatched: keys.filter(k => !live.has(lower(k))).length };
  }
  const most = {};
  for (const key of RECIPIENT_MAP_KEYS) {
    let best = { count: 0, label: '' };
    for (const s of sources || []) {
      const n = countEntries(s?.data?.[key]);
      if (n > best.count) best = { count: n, label: s.label || '' };
    }
    most[key] = best;
  }
  return { now, most, searched: (sources || []).length };
}
