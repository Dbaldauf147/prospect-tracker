// Daily Success Log — IndexedDB-backed per-day journal of bullets a
// user wants to accomplish, with check-ins at 1 PM and 5 PM.
//
// Each record:
//   {
//     date: 'YYYY-MM-DD',      // local time
//     bullets: [{ id, text, doneMid, doneEnd }],
//     morningCreatedAt: number, // ms epoch — set when the morning
//                               // modal is first submitted
//     shownMid: boolean,
//     shownEnd: boolean,
//     snoozeUntil: number,     // ms epoch — morning modal hidden
//                              // until this time
//   }

import { dbGet, dbGetAllEntries, dbPut } from '../../utils/db';
import { registerMirroredDbKey, mirrorDbPut } from '../../utils/localMirrorSync';

const STORE = 'daily-success-log';

// The whole log is kept as ONE record, { [date]: entry }, under ALL_KEY, so
// the single-record mirror (utils/localMirrorSync) can give it a copy in
// the account, like the goals beside it. It used to be one record per day,
// which no mirror carried: clearing site data or moving machines lost every
// day of it. Those per-day records are folded in once (LEGACY_MERGED_KEY
// marks it done) and then left where they are, untouched.
const ALL_KEY = 'all';
const LEGACY_MERGED_KEY = 'legacy-merged';
export const DAILY_LOG_EVENT = 'daily-success-log-changed';

const isMap = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const entryStamp = (e) => Math.max(0, Number(e?.updatedAt) || 0, Number(e?.morningCreatedAt) || 0);

// Every day either side has; where both have one, the later-edited entry
// wins (the account's on a tie). Used when a browser that already has a log
// first meets the account's copy, so neither side's days are dropped.
export function mergeDailyLogs(local, remote) {
  if (!isMap(remote)) return isMap(local) ? local : remote;
  if (!isMap(local)) return remote;
  const out = { ...remote };
  for (const [date, entry] of Object.entries(local)) {
    if (!(date in out) || entryStamp(entry) > entryStamp(out[date])) out[date] = entry;
  }
  return out;
}

registerMirroredDbKey(STORE, ALL_KEY, DAILY_LOG_EVENT, { merge: mergeDailyLogs });

async function loadLog() {
  const stored = await dbGet(STORE, ALL_KEY);
  let log = isMap(stored) ? stored : {};
  if (await dbGet(STORE, LEGACY_MERGED_KEY)) return log;
  const legacy = {};
  for (const { key, value } of await dbGetAllEntries(STORE)) {
    if (key === ALL_KEY || key === LEGACY_MERGED_KEY) continue;
    if (isMap(value) && typeof value.date === 'string') legacy[value.date] = value;
  }
  if (Object.keys(legacy).length) {
    log = mergeDailyLogs(legacy, log);
    await mirrorDbPut(STORE, ALL_KEY, log);
  }
  await dbPut(STORE, true, LEGACY_MERGED_KEY);
  return log;
}

// Writes are read-modify-write of the one record, so they queue: two
// check-ins landing together would otherwise each save a log without the
// other's change.
let writeChain = Promise.resolve();
function serialWrite(fn) {
  const run = writeChain.then(fn);
  writeChain = run.catch(() => {});
  return run;
}

export function todayKey(d = new Date()) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function isWeekday(d = new Date()) {
  const dow = d.getDay();
  return dow >= 1 && dow <= 5;
}

export async function getEntry(date) {
  const log = await loadLog();
  return log[date] || null;
}

export async function getAllEntries() {
  const log = await loadLog();
  return Object.values(log).sort((a, b) => (a.date < b.date ? 1 : -1));
}

export function upsertEntry(date, patch) {
  return serialWrite(async () => {
    const log = await loadLog();
    const existing = log[date] || { date, bullets: [], shownMid: false, shownEnd: false };
    // updatedAt is what mergeDailyLogs compares when two copies meet.
    const next = { ...existing, ...patch, date, updatedAt: Date.now() };
    await mirrorDbPut(STORE, ALL_KEY, { ...log, [date]: next });
    return next;
  });
}

export function deleteEntry(date) {
  return serialWrite(async () => {
    const { [date]: _gone, ...rest } = await loadLog();
    await mirrorDbPut(STORE, ALL_KEY, rest);
  });
}

export function newBullet(text = '') {
  return {
    id: `b_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    text,
    doneMid: false,
    doneEnd: false,
  };
}

// Decide which modal (if any) should be shown right now.
// Returns 'morning' | 'mid' | 'end' | null.
export function pickPhase(entry, now = new Date()) {
  const hour = now.getHours();
  if (!entry || !entry.morningCreatedAt) {
    if (entry && entry.snoozeUntil && now.getTime() < entry.snoozeUntil) return null;
    return 'morning';
  }
  if (hour >= 17 && !entry.shownEnd) return 'end';
  if (hour >= 13 && hour < 17 && !entry.shownMid) return 'mid';
  // Even past 5 PM, if mid never showed (e.g. logged in late), still
  // surface the end check-in once instead of skipping straight past.
  if (hour >= 17 && !entry.shownMid) return 'end';
  return null;
}

export function completionStats(entry) {
  if (!entry || !entry.bullets || entry.bullets.length === 0) return { total: 0, doneMid: 0, doneEnd: 0 };
  const total = entry.bullets.length;
  const doneMid = entry.bullets.filter(b => b.doneMid).length;
  const doneEnd = entry.bullets.filter(b => b.doneEnd).length;
  return { total, doneMid, doneEnd };
}
