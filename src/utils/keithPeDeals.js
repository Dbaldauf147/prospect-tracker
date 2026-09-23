// The deals behind the "PE overlap deals" line on the Keith agenda: every
// Private Equity or Portfolio Company opp that has reached Stage 3 (Lead) or
// later and is still open.
//
// "PE or Portfolio Company" is read off the opp itself: its Type, or a PE
// Owner filled in (which is only ever set on a portfolio company's deal).
// Sold and Not Sold are past the numbered stages, so they drop out; so do
// Not Started and anything that never reached Lead.
//
// Each deal also says who owns it and what vertical it is in, since those
// are what decide whether another pod is already in the door:
//
//   PE Owner  the opp's own PE Owner, else the matched company's PE Owner,
//             else the PE firm whose portfolio list names it, else the
//             "(a SVP co.)" in the account name. An opp at a PE firm itself
//             is its own owner.
//   Vertical  the opp's Vertical, else the Sector on the owning firm's
//             portfolio list. `verticalFromOpp` says which, so the page can
//             show a borrowed sector as a suggestion rather than a fact.
//
// Pure, so the rule can be asserted without a browser:
// scripts/keithPeDeals.test.mjs.

import { STAGE_BANDS } from './stageBands.js';
import { splitPeOwners, joinPeOwners } from './peOwners.js';
import { companiesMatch } from './listFlags.js';

const PE_TYPES = new Set(['private equity', 'portfolio company']);

// Stage name → { number, label } for Stage 3 and up, e.g. 'Quoted' → 5.
const STAGE_NUMBER = new Map(
  STAGE_BANDS
    .filter(b => /^Stage \d+$/.test(b.label))
    .flatMap(b => b.stages.map(s => [s, Number(b.label.slice(6))])),
);

export function isPeOpp(row) {
  const type = String(row?.['Type'] || '').trim().toLowerCase();
  if (PE_TYPES.has(type)) return true;
  return splitPeOwners(row?.['PE Owner']).length > 0;
}

// The numbered stage (3-6) an opp is at, or null before Stage 3 / once closed.
export function oppStageNumber(row) {
  return STAGE_NUMBER.get(String(row?.['Stage'] || '').trim()) ?? null;
}

const text = (v) => String(v ?? '').trim();

// The Table View company an opp's Account names: exact first, so a longer
// exact name is never beaten by a fuzzy shorter neighbour.
function findCompany(account, prospects) {
  const key = account.toLowerCase();
  if (!key) return null;
  return prospects.find(p => text(p?.company).toLowerCase() === key)
    || prospects.find(p => companiesMatch(p?.company, account))
    || null;
}

// PE firms whose own portfolio list names this account, with the row.
function portfolioEntries(account, prospects) {
  const out = [];
  if (!account) return out;
  for (const firm of prospects) {
    const list = Array.isArray(firm?.portfolioCompanies) ? firm.portfolioCompanies : null;
    if (!list) continue;
    const row = list.find(r => companiesMatch(r?.companyName, account));
    if (row) out.push({ firm: text(firm.company), row });
  }
  return out;
}

// "Oxea (a SVP co.)", "Solenis (a Platinum Equity Co.)" → the firm named.
export function ownerFromAccountName(account) {
  const m = /\(\s*an?\s+(.+?)\s+(co|company|portfolio\s+co(mpany)?)\.?\s*\)/i.exec(text(account));
  return m ? m[1].trim() : '';
}

/**
 * Who owns the company behind an opp, and its vertical.
 *
 *   { peOwner, vertical, verticalFromOpp }
 */
export function peOwnerAndVertical(row, prospects = []) {
  const list = Array.isArray(prospects) ? prospects : [];
  const account = text(row?.['Account']);
  const company = findCompany(account, list);
  const entries = portfolioEntries(account, list);
  const isFirm = text(row?.['Type']).toLowerCase() === 'private equity'
    || text(company?.type).toLowerCase() === 'private equity';

  const peOwner = joinPeOwners(splitPeOwners(row?.['PE Owner']))
    || joinPeOwners(splitPeOwners(company?.peOwner))
    || entries.map(e => e.firm).filter(Boolean).join(', ')
    || ownerFromAccountName(account)
    || (isFirm ? account : '');

  const own = text(row?.['Vertical']);
  const sector = entries.map(e => text(e.row?.sector)).find(Boolean) || '';
  return { peOwner, vertical: own || sector, verticalFromOpp: !!own };
}

/**
 * PE / Portfolio Company opps at Stage 3+, furthest along first, then
 * biggest, then by account so the order is stable.
 *
 *   parseAmount  (raw) => number | null
 *   fmtAmount    (number) => string
 *
 *   [{ id, name, amount, amountLabel, stage, stageLabel, peOwner, vertical, verticalFromOpp }]
 */
export function buildPeOverlapDeals(records, { parseAmount = () => null, fmtAmount = String, prospects = [] } = {}) {
  return (Array.isArray(records) ? records : [])
    .filter(row => isPeOpp(row) && oppStageNumber(row) != null)
    .map(row => {
      const stage = oppStageNumber(row);
      const amount = parseAmount(row?.['Quoted Amount']);
      return {
        id: String(row._id),
        name: String(row?.['Account'] || '').trim() || '(no account)',
        amount,
        amountLabel: amount == null ? '' : fmtAmount(amount),
        stage,
        stageLabel: `Stage ${stage} · ${String(row.Stage).trim()}`,
        ...peOwnerAndVertical(row, prospects),
      };
    })
    .sort((a, b) => b.stage - a.stage
      || (b.amount ?? -Infinity) - (a.amount ?? -Infinity)
      || a.name.localeCompare(b.name));
}
