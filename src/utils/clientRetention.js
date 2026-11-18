// Client retention: every company with a Sold opp on the Opps tab, split
// into the ones still with us and the ones that left (status Old Client).
//
// Clients > Retention shows the two lists side by side and the rate
// between them. Pure, so the matching and the arithmetic are tested without
// a browser (scripts/clientRetention.test.mjs).
//
// An opp's company is its `Account`. It is matched to a Table View company
// on companyDedupeKey, plus any names merged into a company (its aliases,
// utils/companyAliases), so "WSP Global Inc." on an opp finds "WSP". Several
// opps on one company, under any spelling, make one row. A Sold account the
// Table View has no company for still counts as sold - nothing says it left
// - and is flagged so it can be added.
//
// Two marks Dan sets by hand on the page, kept in settings.clientRetentionMarks
// ({ [row id]: mark }, row ids as below):
//   'other'    sold by someone else: not Dan's sale, so out of the page and
//              out of the rate entirely (listed separately, to undo);
//   'expired'  scope expired: its own column, left out of the rate - neither
//              kept nor lost.
// A mark wins over the status, so an Old Client marked expired sits under
// Scope expired, not They left us.
import { companyDedupeKey } from './companyKey.js';
import { recordCompanyKeys } from './companyAliases.js';
import { parseMoney } from './oppsMetrics.js';

const norm = (s) => String(s ?? '').trim().toLowerCase();

export const isSoldOpp = (r) => String(r?.Stage ?? '').trim() === 'Sold';
export const isOldClientStatus = (status) => norm(status) === 'old client';

export const RETENTION_MARKS = ['other', 'expired'];
export const RETENTION_MARKS_KEY = 'clientRetentionMarks';

function dateMs(text) {
  const t = Date.parse(String(text ?? '').trim());
  return Number.isNaN(t) ? 0 : t;
}

// When two Table View records share a key (an unmerged duplicate), the one
// that is or was a client is the one the sale belongs to.
function pickProspect(current, candidate) {
  if (!current) return candidate;
  const rank = (p) => (['client', 'old client'].includes(norm(p.status)) ? 0 : 1);
  return rank(candidate) < rank(current) ? candidate : current;
}

/**
 * { retained, left, expired, other, rate, total } where each list holds rows of
 * { id, company, prospectId, status, cdm, soldOpps, soldAmount, lastSold,
 *   lastSoldMs, accounts, inTableView }, biggest sold amount first.
 * `total` is retained + left, and `rate` is retained / total as a fraction,
 * or null when both are empty. `marks` is settings.clientRetentionMarks.
 */
export function clientRetention(oppRecords, prospects, marks = {}) {
  const byKey = new Map();
  for (const p of prospects || []) {
    if (!p?.id) continue;
    for (const k of recordCompanyKeys(p)) byKey.set(k, pickProspect(byKey.get(k), p));
  }

  const rows = new Map();
  for (const r of oppRecords || []) {
    if (!r || typeof r !== 'object' || !isSoldOpp(r)) continue;
    const account = String(r.Account ?? '').trim();
    const key = companyDedupeKey(account);
    if (!key) continue;
    const prospect = byKey.get(key) || null;
    const id = prospect ? `p:${prospect.id}` : `a:${key}`;
    let row = rows.get(id);
    if (!row) {
      row = {
        id,
        company: prospect ? String(prospect.company || account) : account,
        prospectId: prospect ? prospect.id : null,
        status: prospect ? String(prospect.status || '') : '',
        cdm: prospect ? String(prospect.cdm || '') : '',
        inTableView: !!prospect,
        soldOpps: 0,
        soldAmount: 0,
        lastSold: '',
        lastSoldMs: 0,
        accounts: [],
      };
      rows.set(id, row);
    }
    row.soldOpps += 1;
    row.soldAmount += parseMoney(r['Quoted Amount']) || 0;
    const close = String(r['Close Date'] ?? '').trim();
    const ms = dateMs(close);
    if (ms > row.lastSoldMs) { row.lastSoldMs = ms; row.lastSold = close; }
    if (!row.accounts.includes(account)) row.accounts.push(account);
  }

  const order = (a, b) => (b.soldAmount - a.soldAmount) || a.company.localeCompare(b.company);
  const markOf = (id) => (RETENTION_MARKS.includes(marks?.[id]) ? marks[id] : '');
  const all = [...rows.values()].map(r => ({ ...r, soldAmount: Math.round(r.soldAmount), mark: markOf(r.id) }));
  const other = all.filter(r => r.mark === 'other').sort(order);
  const expired = all.filter(r => r.mark === 'expired').sort(order);
  const open = all.filter(r => !r.mark);
  const left = open.filter(r => isOldClientStatus(r.status)).sort(order);
  const retained = open.filter(r => !isOldClientStatus(r.status)).sort(order);
  const total = retained.length + left.length;
  return { retained, left, expired, other, total, rate: total ? retained.length / total : null };
}

/** Is this row a Brookfield company, by its name or an Account it sold under? */
export const isBrookfieldRow = (r) => [r?.company, ...(r?.accounts || [])].some(n => /brookfield/i.test(String(n ?? '')));

/**
 * A clientRetention result with the Brookfield companies taken out of every
 * list and the rate worked out again without them. `hidden` is how many
 * came out.
 */
export function withoutBrookfield(result) {
  const keep = (rows) => rows.filter(r => !isBrookfieldRow(r));
  const retained = keep(result.retained), left = keep(result.left);
  const expired = keep(result.expired), other = keep(result.other);
  const total = retained.length + left.length;
  const before = result.retained.length + result.left.length + result.expired.length + result.other.length;
  return {
    retained, left, expired, other, total,
    rate: total ? retained.length / total : null,
    hidden: before - (total + expired.length + other.length),
  };
}

/** The marks map with `id` set to `mark`, or cleared when `mark` is ''. */
export function withRetentionMark(marks, id, mark) {
  const next = { ...(marks || {}) };
  if (RETENTION_MARKS.includes(mark)) next[id] = mark;
  else delete next[id];
  return next;
}

/** The rate as a whole-number percent label, '-' with nothing sold. */
export function retentionPercent(rate) {
  return rate == null ? '-' : `${Math.round(rate * 100)}%`;
}
