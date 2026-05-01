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

import { dbGet, dbGetAll, dbPut, dbDelete } from '../../utils/db';

const STORE = 'daily-success-log';

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
  const e = await dbGet(STORE, date);
  return e || null;
}

export async function getAllEntries() {
  const all = await dbGetAll(STORE);
  return [...(all || [])].sort((a, b) => (a.date < b.date ? 1 : -1));
}

export async function upsertEntry(date, patch) {
  const existing = (await dbGet(STORE, date)) || { date, bullets: [], shownMid: false, shownEnd: false };
  const next = { ...existing, ...patch, date };
  await dbPut(STORE, next, date);
  return next;
}

export async function deleteEntry(date) {
  await dbDelete(STORE, date);
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
