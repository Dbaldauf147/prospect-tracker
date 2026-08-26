// Scheduled opps — the queue of New Opp payloads waiting on a date.
//
// The New Opp modal can defer the create instead of committing the row
// straight away: the whole payload is parked on user settings
// (`settings.scheduledOpps`) with an Eastern due date + time, and a minute
// tick on the Opps tab materializes it once that time passes, including
// catching up a time that went by while the app was closed. Settings are
// Firestore-backed, so an opp scheduled on the laptop still lands when the
// desktop is the tab that's open.
//
// Split out of OppsView2 because the queue is no longer only that tab's
// business: the company card's Services Explored board reads it too, so a
// service someone has already booked an opp for shows as spoken for
// instead of looking untouched. One implementation, so the two boards
// can't disagree about what is queued.
//
// Nothing is ever spliced out of the array. The cross-device settings
// merge unions id-keyed arrays (see utils/settingsMerge.js), so an entry
// removed here but still sitting in another device's copy would be
// appended right back — and fire a second time. Firing and cancelling
// stamp `firedAt` / `canceledAt` instead; a stamped entry is dropped only
// once it's older than the retention window, by which point every device
// has long since seen the stamp.

import { easternWallToUtcMs } from './nfatSchedules.js';
import { companiesMatch } from './listFlags.js';
import { scopeTokens, scopeTokenMatchesService } from './scopeMatch.js';

export const SCHEDULED_OPP_RETENTION_MS = 60 * 24 * 60 * 60 * 1000; // 60 days
export const SCHEDULED_OPP_DEFAULT_TIME = '08:00';

export const SCHEDULED_OPPS_SETTINGS_KEY = 'scheduledOpps';

// A stored queue, forgiving of shape. An entry without a parseable due
// date is dropped: it can never come due, and it would sit in the list
// forever claiming it was about to.
export function normalizeScheduledOpps(stored) {
  if (!Array.isArray(stored)) return [];
  return stored
    .filter(e => e && typeof e === 'object' && e.id && /^\d{4}-\d{2}-\d{2}$/.test(String(e.dueDate || '')))
    .map(e => ({
      id: String(e.id),
      company: String(e.company || ''),
      source: String(e.source || ''),
      peOwner: String(e.peOwner || ''),
      type: String(e.type || ''),
      // The services the opp is being opened for, in the Scope column's
      // own format, and the note that goes in Notes. Both optional, and
      // both replayed onto the row when the entry fires.
      scope: String(e.scope || ''),
      notes: String(e.notes || ''),
      // The New Opp modal's pull-through toggle, replayed onto the row
      // when the entry fires so a deferred opp lands with the same
      // answer the user gave when they queued it.
      pullThrough: !!e.pullThrough,
      frameworks: Array.isArray(e.frameworks) ? e.frameworks : [],
      frameworksEdited: !!e.frameworksEdited,
      addToTableView: !!e.addToTableView,
      hqRegion: String(e.hqRegion || ''),
      dueDate: String(e.dueDate),
      dueTime: /^\d{1,2}:\d{2}$/.test(String(e.dueTime || '')) ? String(e.dueTime) : SCHEDULED_OPP_DEFAULT_TIME,
      createdAt: Number(e.createdAt) || null,
      firedAt: Number(e.firedAt) || null,
      canceledAt: Number(e.canceledAt) || null,
    }));
}

// When a scheduled opp is due, as a UTC ms instant. The stored date +
// time are Eastern wall clock for every user regardless of browser
// timezone, so the same entry fires at the same moment everywhere.
export function scheduledOppDueMs(entry) {
  const [y, m, d] = String(entry?.dueDate || '').split('-').map(n => parseInt(n, 10));
  const [hh, mm] = String(entry?.dueTime || SCHEDULED_OPP_DEFAULT_TIME).split(':').map(n => parseInt(n, 10));
  if (![y, m, d, hh, mm].every(Number.isFinite)) return null;
  return easternWallToUtcMs(y, m, d, hh, mm);
}

// Still waiting to be created: neither fired nor cancelled.
export function scheduledOppPending(entry) {
  return !!entry && !entry.firedAt && !entry.canceledAt;
}

// "Mon, Sep 1, 8:00 AM ET" — always rendered in Eastern, because that's
// the timezone the stored wall time means.
export function formatScheduledOppWhen(entry) {
  const ms = scheduledOppDueMs(entry);
  if (ms == null) return '';
  const s = new Date(ms).toLocaleString('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
  return `${s} ET`;
}

// "Aug 14" — the same instant with everything a chip has no room for
// taken off. The full version is the tooltip.
export function formatScheduledOppDay(entry) {
  const ms = scheduledOppDueMs(entry);
  if (ms == null) return '';
  return new Date(ms).toLocaleString('en-US', {
    timeZone: 'America/New_York', month: 'short', day: 'numeric',
  });
}

// Drop fired / cancelled entries once they're past the retention window,
// so the settings list doesn't grow without bound. Pending entries are
// always kept, however far out they're scheduled.
export function pruneScheduledOpps(list, nowMs = Date.now()) {
  return list.filter(e => {
    const done = e.firedAt || e.canceledAt;
    return !done || (nowMs - done) < SCHEDULED_OPP_RETENTION_MS;
  });
}

export function newScheduledOppId() {
  return `so-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// The still-waiting entries for one company, soonest first. Company
// matching goes through companiesMatch, the same normalization the opps
// table uses to tie a row's Account to a Table View record, so "EOS
// Hospitality" and "EOS Hospitality, Inc." are one company here too.
export function pendingScheduledOppsForCompany(company, entries) {
  const name = String(company || '').trim();
  if (!name) return [];
  return (entries || [])
    .filter(e => scheduledOppPending(e) && companiesMatch(e.company, name))
    .sort((a, b) => (scheduledOppDueMs(a) || 0) - (scheduledOppDueMs(b) || 0));
}

// item → the soonest pending scheduled opp whose Scope names it.
//
// This is what puts a queued opp on the company card's services board.
// Scope is typed shorthand, so the tokens go through the shared
// scopeMatch rule rather than a substring test — the same rule that
// decides which services a LIVE opp covers, so a service doesn't change
// meaning the moment its opp is created.
export function scheduledServicesForCompany(company, entries, items) {
  const out = new Map();
  const pending = pendingScheduledOppsForCompany(company, entries);
  if (!pending.length) return out;
  for (const entry of pending) {
    for (const token of scopeTokens(entry.scope)) {
      for (const item of (items || [])) {
        if (!scopeTokenMatchesService(token, item)) continue;
        // Sorted soonest first, so the first entry to claim an item is
        // the one the user is waiting on.
        if (!out.has(item)) out.set(item, entry);
      }
    }
  }
  return out;
}

// Amber, matching the "in flight" family already on these boards — a
// queued opp is neither won, lost, nor live yet.
/**
 * Where the scheduled-opp placeholder lines sit among the real rows.
 *
 * Under the opps that have a Call In, above everything else. Those rows are
 * the day's actual callbacks and keep the top of the table; a queued opp is
 * the next-most-live thing on the page but nothing is owed on it today, and
 * at the bottom it would be lost among the recently-closed history.
 *
 * The cut is found from the last row `hasCallIn` accepts rather than from an
 * assumed sort order, so no row with a callback can end up beneath a
 * placeholder — including in a view where the call-in rows aren't contiguous.
 * With no placeholders (or no rows) this is the row list unchanged.
 */
export function placeScheduledRows(rows = [], placeholders = [], hasCallIn = () => false) {
  if (!placeholders.length) return rows;
  let cut = 0;
  rows.forEach((r, i) => { if (hasCallIn(r)) cut = i + 1; });
  return [...rows.slice(0, cut), ...placeholders, ...rows.slice(cut)];
}

export const SCHEDULED_OPP_COLORS = { bg: '#FEF3C7', color: '#92400E', border: '#FDE68A' };

export function scheduledOppChipTitle(entry, item) {
  const when = formatScheduledOppWhen(entry);
  const company = String(entry?.company || '').trim();
  return `A new opp naming ${item} is scheduled${company ? ` for ${company}` : ''} on ${when}. `
    + 'Nothing exists on the Opps table until then — manage it from Scheduled Opps in the Opps toolbar.';
}
