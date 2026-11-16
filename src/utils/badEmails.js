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
let published = { map: {}, clear: null };
const listeners = new Set();
export function publishBadEmails(map, clear) {
  if (published.map === map && published.clear === clear) return;
  published = { map: map && typeof map === 'object' ? map : {}, clear: clear || null };
  for (const l of listeners) l();
}
export function subscribeBadEmails(l) { listeners.add(l); return () => listeners.delete(l); }
export function getPublishedBadEmails() { return published; }
