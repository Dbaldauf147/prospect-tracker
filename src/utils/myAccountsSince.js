// When each account joined the My Accounts page, for its "Days in My
// Accounts" column.
//
// Which accounts are "mine" is worked out on the fly (CDM, tier, open opps),
// so nothing records the day one arrived. MyAccountsView stamps it here each
// time its account set recomputes: an account seen for the first time gets
// today's date and keeps it from then on. An account that drops off is not
// forgotten, so a list that briefly loads short (opps not in yet) can't
// restart anybody's count.
//
// Backfill: on the first day the record exists, every account already on the
// page predates it, so its date is taken from when the company was added to
// the tracker (createdAt) and marked `est`. After that day a new arrival is
// stamped with the day it showed up.
//
// Stored shape:
//   { startedOn: 'YYYY-MM-DD',
//     accounts: { [companyDedupeKey]: { since: 'YYYY-MM-DD', company, est? } } }
//
// Stored in localStorage under the user's key and mirrored to Firestore;
// two machines' copies merge to the earliest date per account.

import { companyDedupeKey } from './companyKey.js';
import { userLsGet, userLsSet } from './userLs.js';
import { registerMirroredKey, queueMirrorPush } from './localMirrorSync.js';

export const MY_ACCOUNTS_SINCE_KEY = 'my-accounts:since';
export const MY_ACCOUNTS_SINCE_EVENT = 'my-accounts-since-changed';

const DAY_RX = /^\d{4}-\d{2}-\d{2}$/;

export function sinceDayKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function emptyStore() {
  return { startedOn: '', accounts: {} };
}

export function parseMyAccountsSince(raw) {
  try {
    const v = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!v || typeof v !== 'object' || Array.isArray(v)) return emptyStore();
    const accounts = (v.accounts && typeof v.accounts === 'object' && !Array.isArray(v.accounts)) ? v.accounts : {};
    return { startedOn: DAY_RX.test(v.startedOn || '') ? v.startedOn : '', accounts };
  } catch { return emptyStore(); }
}

// Earliest date wins; on a tie a recorded date beats an estimate.
function earlier(a, b) {
  if (!a?.since) return b;
  if (!b?.since) return a;
  if (a.since !== b.since) return a.since < b.since ? a : b;
  return a.est ? b : a;
}

export function mergeMyAccountsSince(local, remote) {
  const l = parseMyAccountsSince(local);
  const r = parseMyAccountsSince(remote);
  const startedOn = [l.startedOn, r.startedOn].filter(Boolean).sort()[0] || '';
  const accounts = { ...r.accounts };
  for (const [k, row] of Object.entries(l.accounts)) accounts[k] = earlier(row, accounts[k]);
  return { startedOn, accounts };
}

registerMirroredKey(MY_ACCOUNTS_SINCE_KEY, MY_ACCOUNTS_SINCE_EVENT, { merge: mergeMyAccountsSince });

// A prospect's createdAt comes back as an ISO string, a Firestore Timestamp,
// or the plain { seconds } a cached roster restores it as. Local day or ''.
export function createdDay(createdAt) {
  if (!createdAt) return '';
  let d = null;
  if (typeof createdAt === 'string' || typeof createdAt === 'number') d = new Date(createdAt);
  else if (typeof createdAt.toDate === 'function') d = createdAt.toDate();
  else if (typeof createdAt.seconds === 'number') d = new Date(createdAt.seconds * 1000);
  return d && !Number.isNaN(d.getTime()) ? sinceDayKey(d) : '';
}

// The store with every account in `accounts` stamped. Returns the same
// object when nothing changed so the caller can skip the write.
export function withMyAccountsStamped(store, accounts, today) {
  const s = parseMyAccountsSince(store);
  const startedOn = s.startedOn || today;
  const backfilling = startedOn === today;
  let next = null;
  for (const a of accounts || []) {
    const key = companyDedupeKey(a?.company || '');
    if (!key || s.accounts[key]) continue;
    const created = backfilling ? createdDay(a.createdAt) : '';
    const row = created && created < today
      ? { since: created, company: a.company, est: true }
      : { since: today, company: a.company };
    if (!next) next = { ...s.accounts };
    next[key] = row;
  }
  if (!next && s.startedOn) return store;
  return { startedOn, accounts: next || s.accounts };
}

// Whole days from `since` to `today` (both YYYY-MM-DD), or null.
export function daysBetween(since, today) {
  if (!DAY_RX.test(since || '') || !DAY_RX.test(today || '')) return null;
  const [y1, m1, d1] = since.split('-').map(Number);
  const [y2, m2, d2] = today.split('-').map(Number);
  return Math.max(0, Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000));
}

export function sinceFor(store, company) {
  const key = companyDedupeKey(company || '');
  return key ? (store?.accounts?.[key] || null) : null;
}

export function loadMyAccountsSince() {
  return parseMyAccountsSince(userLsGet(MY_ACCOUNTS_SINCE_KEY));
}

export function saveMyAccountsSince(store) {
  try {
    userLsSet(MY_ACCOUNTS_SINCE_KEY, JSON.stringify(store));
    queueMirrorPush(MY_ACCOUNTS_SINCE_KEY);
    window.dispatchEvent(new Event(MY_ACCOUNTS_SINCE_EVENT));
  } catch (err) {
    console.warn('Failed to persist My Accounts since-dates', err);
  }
}
