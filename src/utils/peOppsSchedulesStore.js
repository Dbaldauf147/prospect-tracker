// Client-side CRUD for PE Opps email schedules. Schedules live in the
// top-level `peOppsEmailSchedules` Firestore collection, one doc per
// schedule, owned by `ownerUid`. The hourly cron (api/pe-opps-scheduler)
// reads them with the admin SDK and sends the due ones.
//
// Scheduling is anchored in UTC. The user picks a *local* hour/day in the
// UI; we resolve the first concrete run instant in local time, then derive
// the UTC recurrence fields (hourUtc / dayOfWeek / dayOfMonth) from that
// same instant so the server's recurrence math (api/_lib/peOppsSchedule)
// lines up with what the user intended.

import {
  collection, query, where, onSnapshot, addDoc, updateDoc, deleteDoc, doc, getDocs,
} from 'firebase/firestore';
import { db } from '../firebase';

const COLLECTION = 'peOppsEmailSchedules';

export const FREQUENCIES = ['daily', 'weekly', 'monthly'];
export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// First concrete run at/after `from`, computed in the browser's local
// timezone, as a Date.
export function firstLocalRun({ frequency, hourLocal, dayOfWeekLocal, dayOfMonthLocal }, from = new Date()) {
  const hour = clamp(hourLocal, 0, 23, 9);
  const d = new Date(from);
  d.setHours(hour, 0, 0, 0);

  if (frequency === 'weekly') {
    const target = clamp(dayOfWeekLocal, 0, 6, 1);
    const delta = (target - d.getDay() + 7) % 7;
    d.setDate(d.getDate() + delta);
    if (d.getTime() <= from.getTime()) d.setDate(d.getDate() + 7);
    return d;
  }
  if (frequency === 'monthly') {
    const dom = clamp(dayOfMonthLocal, 1, 28, 1);
    d.setDate(dom);
    if (d.getTime() <= from.getTime()) d.setMonth(d.getMonth() + 1);
    return d;
  }
  // daily
  if (d.getTime() <= from.getTime()) d.setDate(d.getDate() + 1);
  return d;
}

// Build the persisted recurrence fields from the user's local choices.
export function buildRecurrenceFields(local) {
  const first = firstLocalRun(local);
  return {
    frequency: local.frequency,
    hourLocal: clamp(local.hourLocal, 0, 23, 9),
    dayOfWeekLocal: local.frequency === 'weekly' ? clamp(local.dayOfWeekLocal, 0, 6, 1) : null,
    dayOfMonthLocal: local.frequency === 'monthly' ? clamp(local.dayOfMonthLocal, 1, 28, 1) : null,
    // UTC anchors derived from the first concrete instant.
    hourUtc: first.getUTCHours(),
    dayOfWeek: first.getUTCDay(),
    dayOfMonth: Math.min(first.getUTCDate(), 28),
    nextRunAt: first.getTime(),
  };
}

export function describeSchedule(s) {
  const time = `${String(s.hourLocal ?? 9).padStart(2, '0')}:00`;
  if (s.frequency === 'weekly') return `Weekly · ${WEEKDAYS[s.dayOfWeekLocal ?? 1]} at ${time}`;
  if (s.frequency === 'monthly') return `Monthly · day ${s.dayOfMonthLocal ?? 1} at ${time}`;
  return `Daily at ${time}`;
}

export function watchSchedules(uid, cb) {
  if (!uid) { cb([]); return () => {}; }
  const q = query(collection(db, COLLECTION), where('ownerUid', '==', uid));
  return onSnapshot(
    q,
    (snap) => {
      const out = [];
      snap.forEach((d) => out.push({ id: d.id, ...d.data() }));
      out.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
      cb(out);
    },
    (err) => { console.error('peOppsSchedules watch failed', err); cb([]); },
  );
}

export async function listSchedules(uid) {
  if (!uid) return [];
  const q = query(collection(db, COLLECTION), where('ownerUid', '==', uid));
  const snap = await getDocs(q);
  const out = [];
  snap.forEach((d) => out.push({ id: d.id, ...d.data() }));
  return out;
}

export async function createSchedule(uid, email, input) {
  const recurrence = buildRecurrenceFields(input);
  const now = Date.now();
  const docData = {
    ownerUid: uid,
    ownerEmail: email || '',
    name: (input.name || '').trim(),
    recipients: normalizeRecipients(input.recipients),
    subject: (input.subject || 'PE Opportunities').trim(),
    message: (input.message || '').trim(),
    columns: Array.isArray(input.columns) ? input.columns : [],
    skipWhenEmpty: !!input.skipWhenEmpty,
    enabled: input.enabled !== false,
    createdAt: now,
    updatedAt: now,
    lastStatus: null,
    lastSentAt: null,
    ...recurrence,
  };
  const ref = await addDoc(collection(db, COLLECTION), docData);
  return ref.id;
}

export async function updateSchedule(id, input) {
  const recurrence = buildRecurrenceFields(input);
  await updateDoc(doc(db, COLLECTION, id), {
    name: (input.name || '').trim(),
    recipients: normalizeRecipients(input.recipients),
    subject: (input.subject || 'PE Opportunities').trim(),
    message: (input.message || '').trim(),
    columns: Array.isArray(input.columns) ? input.columns : [],
    skipWhenEmpty: !!input.skipWhenEmpty,
    enabled: input.enabled !== false,
    updatedAt: Date.now(),
    ...recurrence,
  });
}

export async function setEnabled(id, enabled) {
  await updateDoc(doc(db, COLLECTION, id), { enabled: !!enabled, updatedAt: Date.now() });
}

export async function removeSchedule(id) {
  await deleteDoc(doc(db, COLLECTION, id));
}

export function normalizeRecipients(raw) {
  const arr = Array.isArray(raw) ? raw : String(raw || '').split(/[,;\n]/);
  const seen = new Set();
  const out = [];
  for (const e of arr) {
    const v = String(e || '').trim();
    if (!v) continue;
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}

export function isValidEmail(e) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || '').trim());
}

function clamp(n, lo, hi, dflt) {
  const v = Number(n);
  if (!Number.isFinite(v)) return dflt;
  return Math.min(hi, Math.max(lo, Math.round(v)));
}
