// Which companies joined (or left) My Accounts on a given day, read from
// the nightly cloud backups.
//
// The All Missing History subtab keeps one row of counts per day, so a day
// whose Companies count jumps (Oct 30: 145 -> 321) can't say who arrived.
// The nightly backup (api/daily-backup.js, 11:00 UTC, kept 30 days) holds
// every input the My Accounts list is built from: the prospect cards, the
// settings (Targets mappings, dismissed companies, divisions), the Targets
// workbook and the Opps 2 roster. membershipFromBackup runs the page's own
// rule (utils/myAccountsMembership) over one backup, so two of them, one
// either side of the day, say exactly who moved, and the two counts plus
// the moves always add up.
//
// membershipFromBackup runs in api/backup-fetch.js (part=membership), so
// only the small result crosses the wire; the browser diffs two of them.

import { countedMyAccounts, parseTargetAccounts } from './myAccountsMembership.js';
import { decodeValue } from './fullBackup.js';
import { withoutDuplicateRows } from './targetDuplicates.js';

// The card fields kept on every prospect, for saying what changed.
const CARD_FIELDS = ['company', 'cdm', 'tier', 'tierOwnTarget', 'status', 'substatus', 'vertical', 'createdAt'];

function isoOf(v) {
  if (!v) return '';
  if (typeof v === 'string') return v;
  const s = v.seconds ?? v._seconds;
  if (Number.isFinite(s)) return new Date(s * 1000).toISOString();
  return '';
}

// A settings map as stored: an object, or (briefly, Oct 30 2026) the JSON
// string settingsCodec wrote before the maps moved to their own documents.
function settingsMap(v, fallback) {
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch { return fallback; } }
  return v && typeof v === 'object' ? v : fallback;
}

/** The Targets workbook out of the backup's targetAccounts document. */
export function workbookFromBackup(doc) {
  if (!doc) return null;
  let data = null;
  if (typeof doc.json === 'string' && doc.json) {
    try { data = decodeValue(JSON.parse(doc.json)); } catch { data = null; }
  }
  if (!data?.sheets && doc.sheets) data = doc;
  return data?.sheets ? withoutDuplicateRows(data) : null;
}

/**
 * One backup's My Accounts, as the All Missing History count sees it.
 *   { generatedAt, counts: { prospects, opps, targets },
 *     cards: { [id]: slim card }, members: { [id]: why }, mapped: [ids] }
 */
export function membershipFromBackup(backup, cdmName) {
  const c = backup?.collections || {};
  const prospects = Array.isArray(c.prospects?.records) ? c.prospects.records : [];
  const settings = c.userSettings || {};
  const name = cdmName || settings.cdmName || '';
  const oppsRecords = Array.isArray(c.opps2Data?.records) ? c.opps2Data.records : [];
  const { accounts: targetAccounts } = parseTargetAccounts(workbookFromBackup(c.targetAccounts), name, settings.targetCdmColumn);
  const targetMap = settingsMap(settings.targetMap, {});
  const counted = countedMyAccounts({
    prospects,
    cdmName: name,
    targetMap,
    dismissedCompanies: settingsMap(settings.dismissedCompanies, []),
    divisionsMap: settingsMap(settings.divisionsMap, {}),
    targetAccounts,
    oppsRecords,
  });
  const cards = {};
  for (const p of prospects) {
    if (p?.id == null) continue;
    const card = {};
    for (const f of CARD_FIELDS) if (p[f] !== undefined && p[f] !== null) card[f] = f === 'createdAt' ? isoOf(p[f]) : p[f];
    cards[p.id] = card;
  }
  const members = {};
  for (const [id, m] of counted) members[id] = m.why;
  const mapped = Object.keys(targetMap).filter(k => (Array.isArray(targetMap[k]) ? targetMap[k].length > 0 : !!targetMap[k]));
  return {
    generatedAt: backup?.generatedAt || null,
    cdmName: name,
    counts: { prospects: prospects.length, opps: oppsRecords.length, targets: targetAccounts.length },
    cards,
    members,
    mapped,
  };
}

const statusOf = (card) => (String(card?.substatus ?? '').trim() ? 'Hold Off' : String(card?.status ?? '').trim());

function whatChanged(b, a) {
  if (!b) return ['New in the tracker'];
  if (!a) return ['Deleted from the tracker'];
  const parts = [];
  if ((b.cdm || '') !== (a.cdm || '')) parts.push(`CDM ${b.cdm || 'blank'} to ${a.cdm || 'blank'}`);
  if ((b.tier || '') !== (a.tier || '')) parts.push(`Tier ${b.tier || 'blank'} to ${a.tier || 'blank'}`);
  if (!!b.tierOwnTarget !== !!a.tierOwnTarget) parts.push(a.tierOwnTarget ? 'Ticked as Dan target' : 'Unticked as Dan target');
  if (statusOf(b) !== statusOf(a)) parts.push(`Status ${statusOf(b) || 'blank'} to ${statusOf(a) || 'blank'}`);
  return parts;
}

/**
 * Every company on My Accounts on either side, with how it moved.
 * Rows: { id, company, change: 'Added' | 'Left' | 'Stayed', whyBefore,
 * whyAfter, whatChanged, cdmBefore, cdmAfter, tier, vertical, status,
 * createdAt, mappedThatDay }. Sorted Added, Left, Stayed, then by name.
 * Also { before, after, added, left, stayed } counts:
 * before + added - left === after, always.
 */
export function diffMembership(before, after) {
  const bm = before?.members || {};
  const am = after?.members || {};
  const bMapped = new Set(before?.mapped || []);
  const aMapped = new Set(after?.mapped || []);
  const rows = [];
  for (const id of new Set([...Object.keys(bm), ...Object.keys(am)])) {
    const inB = Object.prototype.hasOwnProperty.call(bm, id);
    const inA = Object.prototype.hasOwnProperty.call(am, id);
    const b = before?.cards?.[id] || null;
    const a = after?.cards?.[id] || null;
    const card = a || b || {};
    const change = inA && !inB ? 'Added' : inB && !inA ? 'Left' : 'Stayed';
    let changed = whatChanged(b, a);
    if (!changed.length && change === 'Added' && aMapped.has(id) && !bMapped.has(id)) changed = ['Mapped to the Targets list'];
    if (!changed.length && change === 'Left' && bMapped.has(id) && !aMapped.has(id)) changed = ['Targets mapping removed'];
    if (!changed.length && change !== 'Stayed') changed = ['Not on the card (Targets list or opps changed)'];
    rows.push({
      id,
      company: card.company || '',
      change,
      whyBefore: inB ? bm[id] : '',
      whyAfter: inA ? am[id] : '',
      whatChanged: changed.join('; '),
      cdmBefore: b?.cdm || '',
      cdmAfter: a?.cdm || '',
      tier: card.tier || '',
      vertical: card.vertical || '',
      status: statusOf(card),
      createdAt: card.createdAt || '',
      mappedThatDay: aMapped.has(id) && !bMapped.has(id),
    });
  }
  const order = { Added: 0, Left: 1, Stayed: 2 };
  rows.sort((x, y) => order[x.change] - order[y.change] || x.company.localeCompare(y.company));
  const n = (c) => rows.filter(r => r.change === c).length;
  return {
    rows,
    counts: { before: Object.keys(bm).length, after: Object.keys(am).length, added: n('Added'), left: n('Left'), stayed: n('Stayed') },
  };
}

function endOfDay(day) {
  const [y, m, d] = String(day).split('-').map(Number);
  return new Date(y, (m || 1) - 1, (d || 1) + 1).getTime();
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
  const after = firstAfter(endOfDay(day));
  let before = prevDay ? firstAfter(endOfDay(prevDay)) : null;
  // The before has to be from before `day` ended, or it brackets nothing.
  if (before && before.t >= endOfDay(day)) before = null;
  return { before, after };
}
