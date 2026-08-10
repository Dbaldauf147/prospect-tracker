// "Top PC" — the strongest portfolio company on a PE firm, by the same
// Opportunity Score the All PCs tab and the PC Download workbook show.
//
// The PE Portfolio table already answers "how much pipeline is under this
// firm"; it didn't answer "and which company should I be working". This
// picks that one company per firm, under two filters the user asked for:
//
//   - HQ in North America, and
//   - not a company we've already closed off (status Lost - Not Sold, or
//     parked at Hold Off).
//
// Two things are worth being careful about, because both would quietly
// mislead rather than visibly break:
//
//   1. The score is normalized within a firm's own portfolio (energy and
//      site count are scaled against that firm's maxima — see
//      computePortfolioFitScore). Scoring must therefore run over the FULL
//      portfolio and the filters applied afterwards, or a firm whose
//      biggest company is European would show everyone else's score
//      inflated here relative to the All PCs tab.
//   2. Status lives on the tracker prospect record, not on the mapped PC
//      row, so it's looked up by name. A PC with no prospect of its own
//      has no status to fail, and stays eligible — the filter excludes
//      companies we know are closed, not companies we know nothing about.

import { classifyHqRegion, NORTH_AMERICA } from './hqRegion.js';
import { computePortfolioFitScore } from './portfolioCompaniesWorkbook.js';

// The statuses that take a company out of the running. "Not Sold" is
// written 'Lost - Not Sold' on the prospect record (see data/enums.js).
export const TOP_PC_EXCLUDED_STATUSES = ['Lost - Not Sold', 'Hold Off'];

const EXCLUDED = new Set(TOP_PC_EXCLUDED_STATUSES.map(s => s.toLowerCase()));

// Lookup key for joining a mapped PC row to a prospect record: case,
// spacing, punctuation and the usual legal suffixes all fall away, so
// "Acme Foods, Inc." finds "Acme Foods". Deliberately not the fuzzy
// contains-match used elsewhere in this view — a loose match here would
// drop a company from the running on someone else's status.
export function topPcCompanyKey(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\b(inc|llc|ltd|limited|corp|corporation|co|lp|llp|plc|holdings|group)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// company key → status, from the tracker's prospect records. Built once
// per prospect list and shared across every firm's row.
export function buildStatusByCompany(prospects) {
  const map = new Map();
  for (const p of (prospects || [])) {
    const key = topPcCompanyKey(p?.company);
    // First writer wins: a duplicate name shouldn't let an old dead record
    // knock a live one out of the running.
    if (key && p?.status && !map.has(key)) map.set(key, p.status);
  }
  return map;
}

// Where a mapped PC row says it's headquartered, as one string for
// classifyHqRegion. City alone is enough for a US city it recognises;
// country alone is enough for "United States".
function hqLocationOf(row) {
  return [row?.hqCity, row?.hqCountry].map(v => String(v || '').trim()).filter(Boolean).join(', ');
}

/**
 * The highest-scoring eligible portfolio company on one firm.
 *
 * Returns null when the firm has no portfolio mapped or nothing survives
 * the filters, and otherwise:
 *   { companyName, score, hqCity, hqCountry, hqLocation, status,
 *     total, eligible, skippedRegion, skippedStatus, skippedNoScore }
 * The counts are for the tooltip — a single name with no sense of what it
 * was picked from invites "is that really the top one?".
 */
export function pickTopPortfolioCompany(portfolioCompanies, statusByCompany) {
  const rows = Array.isArray(portfolioCompanies) ? portfolioCompanies : [];
  if (rows.length === 0) return null;

  // Same normalization basis as the All PCs tab and the workbook export,
  // over the whole portfolio — see note 1 at the top of this file.
  const maxE = rows.reduce((m, r) => Math.max(m, Number(r?.energyGwh) || 0), 0);
  const maxS = rows.reduce((m, r) => Math.max(m, Number(r?.siteCount) || 0), 0);
  const years = rows.map(r => Number(r?.acquisitionYear)).filter(y => y > 0);
  const yearRange = years.length > 0 ? { min: Math.min(...years), max: Math.max(...years) } : null;

  const statuses = statusByCompany || new Map();
  let best = null;
  let skippedRegion = 0, skippedStatus = 0, skippedNoScore = 0, eligible = 0;

  for (const row of rows) {
    const companyName = String(row?.companyName || '').trim();
    if (!companyName) continue;

    const hqLocation = hqLocationOf(row);
    if (classifyHqRegion(hqLocation) !== NORTH_AMERICA) { skippedRegion++; continue; }

    const status = statuses.get(topPcCompanyKey(companyName)) || '';
    if (EXCLUDED.has(status.toLowerCase())) { skippedStatus++; continue; }

    eligible++;
    // An explicit "N/A" score (credit strategies, mostly) can't be ranked.
    // It's counted rather than treated as a zero, which would let it win a
    // portfolio where everything else is also unscored.
    const score = computePortfolioFitScore(row, maxE, maxS, yearRange);
    if (score == null || !Number.isFinite(score)) { skippedNoScore++; continue; }

    if (!best || score > best.score
      || (score === best.score && companyName.localeCompare(best.companyName) < 0)) {
      best = { companyName, score, hqCity: row?.hqCity || '', hqCountry: row?.hqCountry || '', hqLocation, status };
    }
  }

  if (!best) return null;
  return { ...best, total: rows.length, eligible, skippedRegion, skippedStatus, skippedNoScore };
}
