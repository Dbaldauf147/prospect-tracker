// The Top PC intro list behind step 5 of the Prospecting ladder.
//
// The PE Portfolio table already picks one company per firm — the
// highest-scoring North American portfolio company that hasn't been
// closed off (Lost - Not Sold), parked (Hold Off), or won now (Client) or
// before (Old Client). That's the Top PC column, and this reuses the same
// picker so the two pages can't name different companies.
//
// What the Prospecting page adds is the "still to ask about" filter: a
// Top PC already sitting at Qualifying is a conversation in progress, so
// it drops off the list. Everything else stays on it — including a
// company with no prospect record of its own, which reads as a blank
// status on the PE page. No status is not the same as no work; if
// anything it's the coldest name on the list.
//
// One row per firm, not per company: the work item is "ask this PE
// partner for an intro to that company", so a company that tops two
// firms' portfolios is two intros to ask for, not one.

import { buildStatusIndex, pickTopPortfolioCompany, topPcCompanyKeys } from './topPortfolioCompany.js';

// The Type that marks a prospect as a PE firm — same filter the PE
// Portfolio page lists its firms with.
export const PE_FIRM_TYPE = 'Private Equity';

// The status that means this Top PC is already being worked, so no intro
// needs asking for.
export const TOP_PC_WORKED_STATUS = 'Qualifying';

export function isTopPcWorked(status) {
  return String(status || '').trim().toLowerCase() === TOP_PC_WORKED_STATUS.toLowerCase();
}

// Company name → prospect id, under every alternate name the Top PC join
// uses, so a row can be clicked through to the record its status came
// from. Mirrors the PE page's own click-through index.
function buildProspectIdIndex(prospects) {
  const m = new Map();
  for (const p of prospects) {
    if (!p?.id) continue;
    for (const k of topPcCompanyKeys(p.company)) {
      if (!m.has(k)) m.set(k, p.id);
    }
  }
  return m;
}

function lookupProspectId(index, companyName) {
  for (const k of topPcCompanyKeys(companyName)) {
    const hit = index.get(k);
    if (hit) return hit;
  }
  return null;
}

/**
 * Every PE firm's Top PC that isn't already Qualifying, ranked by
 * Opportunity Score — the warmest intro to ask for first.
 *
 * Returns null when the prospects aren't loaded yet, so the caller can
 * tell "no intros to chase" from "don't know yet". Each row:
 *   { firm, firmId, company, companyId, score, status, statusFromRow,
 *     statusCompany, hqLocation }
 * `companyId` is null for a Top PC with no prospect record of its own,
 * and `status` is '' when neither the firm's portfolio row nor a tracker
 * record gives it one.
 */
export function collectTopPcIntros(prospects) {
  if (!Array.isArray(prospects)) return null;
  const statusIndex = buildStatusIndex(prospects);
  const idIndex = buildProspectIdIndex(prospects);
  const out = [];
  for (const p of prospects) {
    if (String(p?.type || '').trim() !== PE_FIRM_TYPE) continue;
    const top = pickTopPortfolioCompany(p.portfolioCompanies, statusIndex);
    if (!top) continue;
    if (isTopPcWorked(top.status)) continue;
    out.push({
      firm: String(p.company || '').trim() || '-',
      firmId: p.id || null,
      company: top.companyName,
      companyId: lookupProspectId(idIndex, top.companyName),
      score: top.score,
      status: String(top.status || '').trim(),
      // Where that status came from — the firm's own portfolio row, or a
      // tracker record (named when it isn't this company's own). The list
      // says so, the same way the PE page's tooltips do.
      statusFromRow: !!top.statusFromRow,
      statusCompany: top.statusCompany || '',
      hqLocation: top.hqLocation || '',
    });
  }
  // Highest score first; ties by company name so the order is stable
  // between renders rather than following prospect insertion order.
  out.sort((a, b) => (b.score - a.score) || a.company.localeCompare(b.company) || a.firm.localeCompare(b.firm));
  return out;
}
