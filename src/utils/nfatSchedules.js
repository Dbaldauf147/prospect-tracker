// The "No Further Action Today" clear schedules — one per mark type.
//
// A schedule is { enabled, days, time, lastRunAt }: which Eastern weekdays,
// what Eastern wall-clock time, and when it last fired. They live on user
// settings (`settings.nfatSchedules`) so they apply on every browser the
// tracker is open in.
//
// Split out of OppsView2 so the scheduling arithmetic — which is all
// timezone and clock reasoning, and wrong in ways nothing on screen would
// show — can be tested directly rather than through a 13k-line component.
//
// The one rule worth stating up front: `lastRunAt` is bookkeeping the app
// writes to itself, and `enabled` / `days` / `time` are the user's. A run
// stamp must never travel with a copy of the configuration (see
// nfatRunStampPaths).

import { userLsGet, userLsSet } from './userLs.js';

// The pre-settings storage key. Read once, to promote a schedule left in a
// browser from before these moved to Firestore-backed settings.
export const NFAT_SCHEDULES_KEY = 'opps2-nfat-schedules';

// The three things a schedule can clear from the tristate column:
// ✓ checks, ✗ X marks, or any non-blank value. Each gets its own
// independent schedule.
export const NFAT_SCHEDULE_TYPES = ['check', 'x', 'any'];
export const NFAT_TYPE_LABELS = { check: '✓ Check marks', x: '✗ X marks', any: 'Any value' };

export const NFAT_SETTINGS_KEY = 'nfatSchedules';
export const NFAT_DEFAULT_TIME = '06:00';

// The per-browser copy of the newest configuration this browser has seen.
// See nfatConfigRepairPaths for what it's for.
export const NFAT_SHADOW_KEY = 'opps2-nfat-shadow';

export function defaultNfatSchedules() {
  const base = { enabled: false, days: [1, 2, 3, 4, 5], time: NFAT_DEFAULT_TIME, lastRunAt: 0, updatedAt: 0 };
  return { check: { ...base }, x: { ...base }, any: { ...base } };
}

// A stored config merged onto defaults, so a partial or older shape still
// yields a complete schedule for every type.
export function normalizeNfatSchedules(stored) {
  const def = defaultNfatSchedules();
  for (const t of NFAT_SCHEDULE_TYPES) {
    if (stored && stored[t]) def[t] = { ...def[t], ...stored[t] };
  }
  return def;
}

// The pre-settings schedule, if this browser still has one.
export function loadLegacyNfatSchedules() {
  try {
    const raw = userLsGet(NFAT_SCHEDULES_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

// True when any type is set to clear on a schedule — surfaced on the
// toolbar button so a schedule that isn't configured is visible rather
// than silent.
export function anyNfatScheduleEnabled(schedules) {
  return NFAT_SCHEDULE_TYPES.some(t => schedules?.[t]?.enabled);
}

// ---- Eastern-time arithmetic --------------------------------------------

// A wall-clock time in America/New_York as a UTC ms instant. Schedules are
// Eastern for every user regardless of browser timezone, so a schedule set
// on a laptop in Denver fires at the same moment as one set in New York.
export function easternWallToUtcMs(year, month, day, hour, minute) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const parts = {};
  for (const p of fmt.formatToParts(new Date(guess))) {
    if (p.type !== 'literal') parts[p.type] = p.value;
  }
  const obs = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour) % 24, Number(parts.minute),
  );
  return guess + (guess - obs);
}

// Eastern calendar parts (+ weekday, 0=Sun..6=Sat) for a UTC ms instant.
export function easternDayParts(ms) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short',
  });
  const out = {};
  for (const p of fmt.formatToParts(new Date(ms))) {
    if (p.type !== 'literal') out[p.type] = p.value;
  }
  const dow = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[out.weekday];
  return { year: Number(out.year), month: Number(out.month), day: Number(out.day), dow };
}

// The most recent scheduled occurrence (UTC ms) at or before `nowMs` for a
// schedule that fires on the given Eastern weekdays at "HH:MM" Eastern.
// Returns null when nothing matches within the last week. Compared against
// the schedule's lastRunAt: a newer occurrence means the clear is due —
// which also lets it catch up a time that passed while the app was closed.
export function mostRecentNfatScheduleMs(days, time, nowMs = Date.now()) {
  if (!Array.isArray(days) || !days.length) return null;
  const [hh, mm] = String(time || '').split(':').map(n => parseInt(n, 10));
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  for (let k = 0; k < 8; k++) {
    const p = easternDayParts(nowMs - k * 24 * 60 * 60 * 1000);
    if (!days.includes(p.dow)) continue;
    const occ = easternWallToUtcMs(p.year, p.month, p.day, hh, mm);
    if (occ <= nowMs) return occ;
  }
  return null;
}

// ---- What's due, and how a run gets recorded -----------------------------

// The types whose clear is due right now: enabled, with a scheduled
// occurrence newer than the last run. Returns [{ type, occurrence }].
// `alreadyFired` is the in-session record of occurrences handled while a
// settings write was still in flight, so a minute tick can't double-fire.
export function nfatTypesDue(schedules, nowMs = Date.now(), alreadyFired = {}) {
  const due = [];
  for (const type of NFAT_SCHEDULE_TYPES) {
    const s = schedules?.[type];
    if (!s?.enabled) continue;
    const occurrence = mostRecentNfatScheduleMs(s.days, s.time, nowMs);
    if (occurrence == null) continue;
    if ((s.lastRunAt || 0) >= occurrence) continue;
    if ((alreadyFired[type] || 0) >= occurrence) continue;
    due.push({ type, occurrence });
  }
  return due;
}

// The dotted settings paths that record a run — and nothing else.
//
// This is the fix for schedules that "didn't survive the day". The runner
// used to persist its advanced lastRunAt by writing the WHOLE
// `nfatSchedules` object back, built from the copy that tab happened to be
// holding. That copy carries `time`, `days` and `enabled` too, so an
// automatic background job was rewriting the user's configuration on every
// fire — and the settings merge resolves scalar conflicts ours-wins, so a
// tab still holding the old 06:00 (one left open on another machine, or one
// whose snapshot hadn't caught up) put 06:00 back over a time changed
// elsewhere, permanently. Overnight there is always such a tab, which is
// why a change made in the morning was gone by the next day.
//
// A path write can't carry a sibling field: `nfatSchedules.check.lastRunAt`
// touches that leaf and nothing else, so the run stamp physically cannot
// clobber the configuration, whatever the writing tab believes it to be.
export function nfatRunStampPaths(types, atMs) {
  const out = {};
  for (const t of (types || [])) {
    if (!NFAT_SCHEDULE_TYPES.includes(t)) continue;
    out[`${NFAT_SETTINGS_KEY}.${t}.lastRunAt`] = atMs;
  }
  return out;
}

// ---- Surviving a stale writer -------------------------------------------
//
// Stopping the run stamp from restating the configuration (above) closed the
// hole this app had. It cannot close the one another app has: a tab still
// running an older build of this page keeps writing the WHOLE nfatSchedules
// object from the copy it is holding, and a browser that slept through the
// night wakes holding yesterday's copy — its schedule runner fires on the
// first minute tick, before the Firestore listener has reconnected. Whatever
// that write says wins, because the settings merge resolves scalar conflicts
// ours-wins and the writing tab genuinely believes its copy. A schedule set
// on Monday is back to 06:00 on Tuesday, and nothing in this app did it.
//
// So the configuration carries the time it was set. `updatedAt` is stamped on
// each type when the user saves, the browser keeps a local shadow of the
// newest configuration it has seen (from any device), and a cloud copy that
// comes back with an OLDER stamp but DIFFERENT values is a restatement of
// something stale rather than an edit — the shadow goes back, as leaf paths.
//
// The comparison is what keeps this from fighting the user: a real edit
// always carries a newer stamp than the shadow, so it is adopted, never
// undone. Only a write that says something older than what this browser
// already knows gets repaired. A stale writer that restates a configuration
// unchanged is left alone too — it has taken nothing away.

// The user's part of a schedule. `lastRunAt` is the app's own bookkeeping and
// is deliberately not here: a repair must never move a run stamp.
export const NFAT_CONFIG_FIELDS = ['enabled', 'days', 'time'];

function nfatConfigOf(s) {
  return {
    enabled: !!s?.enabled,
    days: Array.isArray(s?.days) ? [...s.days].sort((a, b) => a - b) : [],
    time: String(s?.time || NFAT_DEFAULT_TIME),
  };
}

export function sameNfatConfig(a, b) {
  const x = nfatConfigOf(a);
  const y = nfatConfigOf(b);
  return x.enabled === y.enabled && x.time === y.time && String(x.days) === String(y.days);
}

// The user's save, stamped as an edit made at `atMs`.
export function stampNfatConfig(schedules, atMs) {
  const out = {};
  for (const t of NFAT_SCHEDULE_TYPES) out[t] = { ...(schedules?.[t] || {}), updatedAt: atMs };
  return out;
}

// The shadow after seeing `cloud`: for each type, whichever copy carries the
// newer edit stamp. Returns the same object when nothing is newer, so callers
// can skip the write.
export function mergeNfatShadow(shadow, cloud) {
  let out = shadow;
  for (const t of NFAT_SCHEDULE_TYPES) {
    const at = Number(cloud?.[t]?.updatedAt || 0);
    if (!at || at <= Number(shadow?.[t]?.updatedAt || 0)) continue;
    if (out === shadow) out = { ...(shadow || {}) };
    out[t] = { ...nfatConfigOf(cloud[t]), updatedAt: at };
  }
  return out;
}

// Dotted paths that put the shadow's configuration back for every type it
// holds a newer edit for. Empty when the cloud copy is current — which is the
// normal case, on every load.
export function nfatConfigRepairPaths(cloud, shadow) {
  const out = {};
  for (const t of NFAT_SCHEDULE_TYPES) {
    const mine = shadow?.[t];
    const at = Number(mine?.updatedAt || 0);
    if (!at || at <= Number(cloud?.[t]?.updatedAt || 0)) continue;
    if (sameNfatConfig(mine, cloud?.[t])) continue;
    const cfg = nfatConfigOf(mine);
    for (const f of NFAT_CONFIG_FIELDS) out[`${NFAT_SETTINGS_KEY}.${t}.${f}`] = cfg[f];
    out[`${NFAT_SETTINGS_KEY}.${t}.updatedAt`] = at;
  }
  return out;
}

export function loadNfatShadow() {
  try {
    const raw = userLsGet(NFAT_SHADOW_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export function saveNfatShadow(shadow) {
  try { userLsSet(NFAT_SHADOW_KEY, JSON.stringify(shadow || {})); } catch { /* quota — ignore */ }
}
