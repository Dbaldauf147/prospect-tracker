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
