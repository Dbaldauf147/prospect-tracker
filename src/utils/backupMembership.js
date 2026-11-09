// Which companies joined (or left) My Accounts on a given day, read from
// the nightly cloud backups.
//
// The All Missing History subtab keeps one row of counts per day and no
// names, so a day whose Companies count jumps (Oct 30: 145 -> 321) can't
// say who arrived. The nightly backup (api/daily-backup.js, 11:00 UTC,
// kept 30 days) holds every prospect card, so two of them, one either side
// of the day, can.
//
// The comparison works off what a card says about itself, the part of the
// My Accounts rule that is saved on the card: its CDM is the signed-in CDM
// (matchesCdm) or it is ticked "Not on tier list, but Dan target", and,
// as on the history's count, it is not inactive (Old Client / Hold Off /
// Lost - Not Sold, a substatus reading as Hold Off) and not Qualifying.
// A company pulled onto the page only by an open opp on another rep's
// account is not caught: the opps aren't on the card.
//
// Pure: slimBackup runs in api/backup-fetch.js on the whole backup, so only
// these few fields cross the wire, and the browser diffs two slims.

import { matchesCdm } from './cdmMatch.js';

// The card fields the comparison reads and the popup shows.
export const MEMBERSHIP_FIELDS = ['company', 'cdm', 'tier', 'tierOwnTarget', 'status', 'substatus', 'vertical', 'createdAt'];

const INACTIVE = new Set(['Old Client', 'Hold Off', 'Lost - Not Sold']);

/** The backup cut down to the cards' membership fields and the mapped ids. */
export function slimBackup(backup) {
  const records = backup?.collections?.prospects?.records;
  const prospects = (Array.isArray(records) ? records : []).map((r) => {
    const out = { id: r?.id };
    for (const f of MEMBERSHIP_FIELDS) if (r?.[f] !== undefined && r[f] !== null && r[f] !== '') out[f] = r[f];
    // A Firestore Timestamp comes out of the backup as { _seconds } or { seconds }.
    const ca = out.createdAt;
    if (ca && typeof ca === 'object') {
      const s = ca.seconds ?? ca._seconds;
      out.createdAt = Number.isFinite(s) ? new Date(s * 1000).toISOString() : undefined;
      if (!out.createdAt) delete out.createdAt;
    }
    return out;
  }).filter(p => p.id != null);
  const map = backup?.collections?.userSettings?.targetMap;
  const mapped = map && typeof map === 'object'
    ? Object.keys(map).filter(k => (Array.isArray(map[k]) ? map[k].length > 0 : !!map[k]))
    : [];
  return { generatedAt: backup?.generatedAt || null, prospects, mapped };
}

export function cardStatus(p) {
  return String(p?.substatus ?? '').trim() ? 'Hold Off' : String(p?.status ?? '').trim();
}

/** Whether a card, by itself, puts its company on the counted My Accounts set. */
export function countedOnMyAccounts(p, cdmName) {
  if (!p) return false;
  if (!(matchesCdm(p.cdm, cdmName) || p.tierOwnTarget === true)) return false;
  const status = cardStatus(p);
  if (INACTIVE.has(status)) return false;
  if (status.toLowerCase() === 'qualifying') return false;
  return true;
}

// Why a card moved, in a few words. `b` is the earlier card (or null).
function reasonFor(b, a, cdmName) {
  const parts = [];
  if (!b) return ['New in the tracker'];
  if (!a) return ['Deleted from the tracker'];
  const bMine = matchesCdm(b.cdm, cdmName) || b.tierOwnTarget === true;
  const aMine = matchesCdm(a.cdm, cdmName) || a.tierOwnTarget === true;
  if ((b.cdm || '') !== (a.cdm || '')) parts.push(`CDM ${b.cdm || 'blank'} to ${a.cdm || 'blank'}`);
  if (!!b.tierOwnTarget !== !!a.tierOwnTarget) parts.push(a.tierOwnTarget ? 'Ticked as Dan target' : 'Unticked as Dan target');
  if (cardStatus(b) !== cardStatus(a)) parts.push(`Status ${cardStatus(b) || 'blank'} to ${cardStatus(a) || 'blank'}`);
  if (!parts.length && bMine !== aMine) parts.push('CDM match changed');
  return parts;
}

/**
 * { joined, left } between two slims. Each row:
 *   { id, company, reason, cdmBefore, cdmAfter, tier, vertical, status,
 *     createdAt, newRecord, mappedThatDay }
 * mappedThatDay: the card gained a Targets list mapping between the two.
 */
export function diffMembership(before, after, cdmName) {
  const bById = new Map((before?.prospects || []).map(p => [p.id, p]));
  const aById = new Map((after?.prospects || []).map(p => [p.id, p]));
  const bMapped = new Set(before?.mapped || []);
  const aMapped = new Set(after?.mapped || []);
  const row = (id, b, a) => {
    const card = a || b || {};
    return {
      id,
      company: card.company || '',
      reason: reasonFor(b, a, cdmName).join('; '),
      cdmBefore: b?.cdm || '',
      cdmAfter: a?.cdm || '',
      tier: card.tier || '',
      vertical: card.vertical || '',
      status: cardStatus(card),
      createdAt: card.createdAt || '',
      newRecord: !b,
      mappedThatDay: aMapped.has(id) && !bMapped.has(id),
    };
  };
  const joined = [];
  const left = [];
  for (const id of new Set([...bById.keys(), ...aById.keys()])) {
    const b = bById.get(id) || null;
    const a = aById.get(id) || null;
    const was = countedOnMyAccounts(b, cdmName);
    const is = countedOnMyAccounts(a, cdmName);
    if (is && !was) joined.push(row(id, b, a));
    else if (was && !is) left.push(row(id, b, a));
  }
  const byName = (x, y) => x.company.localeCompare(y.company);
  return { joined: joined.sort(byName), left: left.sort(byName) };
}

// Local midnight at the start of YYYY-MM-DD, in ms.
function dayStart(day) {
  const [y, m, d] = String(day).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1).getTime();
}

/**
 * The two backups that bracket the change between the end of `prevDay`
 * and the end of `day` (both YYYY-MM-DD, local): the first backup taken
 * after each day ended. `files` is [{ name, createdTime }] from
 * /api/backups-list. { before, after } with null for one that isn't kept
 * (older than the 30 the cron holds, or not taken yet).
 */
export function backupsForDay(files, day, prevDay) {
  const list = (files || [])
    .map(f => ({ ...f, t: Date.parse(f.createdTime || '') }))
    .filter(f => Number.isFinite(f.t))
    .sort((x, y) => x.t - y.t);
  const firstAfter = (ms) => list.find(f => f.t >= ms) || null;
  const nextDay = (d) => dayStart(d) + 36 * 3600000; // past any DST hour, then back to midnight
  const endOf = (d) => { const n = new Date(nextDay(d)); return new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime(); };
  const after = firstAfter(endOf(day));
  const before = prevDay ? firstAfter(endOf(prevDay)) : null;
  // A before that isn't earlier than the after brackets nothing.
  if (before && after && before.t >= after.t) return { before: null, after };
  // The before has to be one from before `day` ended, or it isn't "before".
  if (before && before.t >= endOf(day)) return { before: null, after };
  return { before, after };
}
