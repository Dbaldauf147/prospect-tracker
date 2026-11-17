// "All Team Activity": the team's open opportunities, pulled out of the
// Salesforce report "SB NAM Sales - Open Opportunities" twice a month by the
// Agents tab's AI Prompt (All Team Activity) and pasted into BFO Activity >
// All Team Activity. The point is to spot teammates' work on Dan's own
// accounts: which rows sit on one of his accounts, and what is new or has
// moved since the pull before.
//
// Pure functions only (no Firebase, no DOM), so scripts/teamOpps.test.mjs
// can run them under plain Node.

import { parseTSV } from './tsvTable.js';
import { normalizeCompany } from './companyNorm.js';

// The report's columns, in its own order. The prompt asks for exactly this
// header; the parser reads columns by name, so a reordered or extended
// paste still works.
export const TEAM_OPPS_HEADER = [
  'Opportunity Leader', 'Stage Group', 'Sales Stage', 'Opportunity Name', 'Account Name',
  'Close Date', 'Amount (converted)', 'Amount', 'Partner Facing Amount (converted)', 'Probability (%)',
];

// Grouped report columns: Salesforce prints each value once, on the first
// row of its group, with a "(16)" record count after it.
const GROUP_COLS = ['Opportunity Leader', 'Stage Group', 'Sales Stage'];

// What counts as a change worth flagging between two pulls.
export const TEAM_OPPS_TRACKED = ['Opportunity Leader', 'Sales Stage', 'Close Date', 'Amount (converted)', 'Probability (%)'];

const stripCount = (v) => String(v || '').replace(/\s*\(\d+\)\s*$/, '').trim();
const isTotalCell = (v) => /^(sub)?total\b|^grand total\b|^avg:/i.test(String(v || '').trim());

// The header as the paste spelled it, found case-insensitively.
function headerFor(headers, name) {
  const want = name.toLowerCase();
  return headers.find(h => String(h).trim().toLowerCase() === want) || null;
}

/**
 * The pasted report as { headers, rows }: group values filled down onto
 * every row, "(n)" counts dropped, Subtotal / Total / Avg lines and blank
 * lines left out. Rows with no Opportunity Name are not opportunities.
 */
export function parseTeamOppsPaste(text) {
  const { headers, rows } = parseTSV(text);
  if (!headers.length) return { headers: [], rows: [] };
  const nameH = headerFor(headers, 'Opportunity Name');
  const groupHs = GROUP_COLS.map(c => headerFor(headers, c)).filter(Boolean);
  const carry = {};
  const out = [];
  for (const raw of rows) {
    const cells = Object.values(raw);
    if (cells.some(isTotalCell)) {
      // A subtotal closes its group; the next row names the new one.
      continue;
    }
    const r = { ...raw };
    for (const h of groupHs) {
      const v = stripCount(r[h]);
      if (v) carry[h] = v;
      r[h] = v || carry[h] || '';
    }
    if (nameH ? !String(r[nameH] || '').trim() : cells.every(c => !String(c || '').trim())) continue;
    out.push(r);
  }
  return { headers, rows: out };
}

/** Which row this is across pulls: its name and account, lower-cased. */
export function teamOppKey(r) {
  const name = String(r?.['Opportunity Name'] || '').trim().toLowerCase();
  const acct = String(r?.['Account Name'] || '').trim().toLowerCase();
  return `${name}|${acct}`;
}

/**
 * An index of the user's accounts for accountMatch: normalized name ->
 * company name, from each account's own name and its BFO Company Names.
 * `accounts` is [{ company, names: [..] }].
 */
export function buildMyAccountIndex(accounts) {
  const m = new Map();
  for (const a of accounts || []) {
    for (const n of [a?.company, ...(a?.names || [])]) {
      const k = normalizeCompany(n);
      if (k && !m.has(k)) m.set(k, a.company);
    }
  }
  return m;
}

/**
 * The user's account a Salesforce Account Name belongs to, or ''.
 * BFO names its accounts "Carrier Global Corporation - Headquarters",
 * "Flowserve World Headquarters - Irving, TX": the part before " - " is
 * tried as well as the whole, and an account name that starts with one of
 * the user's names (whole words) counts too.
 */
export function accountMatch(accountName, index) {
  if (!index || !index.size) return '';
  const full = String(accountName || '').trim();
  if (!full) return '';
  const tries = [full, full.split(/\s+-\s+/)[0]].map(normalizeCompany).filter(Boolean);
  for (const t of tries) if (index.has(t)) return index.get(t);
  for (const t of tries) {
    const words = t.split(' ');
    for (let n = words.length - 1; n >= 1; n -= 1) {
      const k = words.slice(0, n).join(' ');
      if (k.length >= 3 && index.has(k)) return index.get(k);
    }
  }
  return '';
}

/**
 * How each current row differs from the pull before:
 * Map(key -> { kind: 'new' | 'changed' | '', changes: ['Sales Stage: a > b'] }),
 * plus `gone`, the previous rows no longer on the report (closed, or
 * moved off it). With no previous pull nothing is flagged.
 */
export function diffTeamOpps(prevRows, currRows) {
  const out = new Map();
  const hasPrev = Array.isArray(prevRows) && prevRows.length > 0;
  const prev = new Map((prevRows || []).map(r => [teamOppKey(r), r]));
  const seen = new Set();
  for (const r of currRows || []) {
    const k = teamOppKey(r);
    seen.add(k);
    if (!hasPrev) { out.set(k, { kind: '', changes: [] }); continue; }
    const p = prev.get(k);
    if (!p) { out.set(k, { kind: 'new', changes: [] }); continue; }
    const changes = [];
    for (const c of TEAM_OPPS_TRACKED) {
      const a = String(p[c] ?? '').trim();
      const b = String(r[c] ?? '').trim();
      if (a !== b) changes.push(`${c}: ${a || 'blank'} > ${b || 'blank'}`);
    }
    out.set(k, { kind: changes.length ? 'changed' : '', changes });
  }
  const gone = hasPrev ? (prevRows || []).filter(r => !seen.has(teamOppKey(r))) : [];
  return { byKey: out, gone };
}

// Twice a month: the pull falls due on the 1st and the 15th.
const DUE_DAYS = [1, 15];

/** The most recent 1st or 15th (local midnight) at or before `nowMs`. */
export function lastTeamOppsDuePoint(nowMs = Date.now()) {
  const d = new Date(nowMs);
  const day = DUE_DAYS.filter(x => x <= d.getDate()).pop();
  return new Date(d.getFullYear(), d.getMonth(), day).getTime();
}

/** The next 1st or 15th (local midnight) after `ms`. */
export function nextTeamOppsDuePoint(ms) {
  const d = new Date(ms);
  const day = DUE_DAYS.find(x => x > d.getDate());
  return day
    ? new Date(d.getFullYear(), d.getMonth(), day).getTime()
    : new Date(d.getFullYear(), d.getMonth() + 1, DUE_DAYS[0]).getTime();
}

/**
 * { due, nextDueMs }: due when nothing has been pulled since the last 1st
 * or 15th. `lastPulledMs` null/0 means never pulled, which is due.
 */
export function teamOppsDue(lastPulledMs, nowMs = Date.now()) {
  if (!lastPulledMs) return { due: true, nextDueMs: lastTeamOppsDuePoint(nowMs) };
  const due = lastPulledMs < lastTeamOppsDuePoint(nowMs);
  return { due, nextDueMs: due ? lastTeamOppsDuePoint(nowMs) : nextTeamOppsDuePoint(lastPulledMs) };
}
