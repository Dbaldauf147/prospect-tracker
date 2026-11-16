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
import { companyDedupeKey } from './companyKey.js';
import { recordCompanyKeys } from './companyAliases.js';
import { parseMoney } from './oppsMetrics.js';

const norm = (s) => String(s ?? '').trim().toLowerCase();

export const isSoldOpp = (r) => String(r?.Stage ?? '').trim() === 'Sold';
export const isOldClientStatus = (status) => norm(status) === 'old client';

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
 * { retained, left, rate, total } where retained / left are rows of
 * { id, company, prospectId, status, cdm, soldOpps, soldAmount, lastSold,
 *   lastSoldMs, accounts, inTableView }, biggest sold amount first.
 * `rate` is retained / total as a fraction, or null with no sold companies.
 */
export function clientRetention(oppRecords, prospects) {
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
  const all = [...rows.values()].map(r => ({ ...r, soldAmount: Math.round(r.soldAmount) }));
  const left = all.filter(r => isOldClientStatus(r.status)).sort(order);
  const retained = all.filter(r => !isOldClientStatus(r.status)).sort(order);
  const total = all.length;
  return { retained, left, total, rate: total ? retained.length / total : null };
}

/** The rate as a whole-number percent label, '-' with nothing sold. */
export function retentionPercent(rate) {
  return rate == null ? '-' : `${Math.round(rate * 100)}%`;
}
