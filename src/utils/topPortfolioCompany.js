// "Top PC" — the strongest portfolio company on a PE firm, by the same
// Opportunity Score the All PCs tab and the PC Download workbook show.
//
// The PE Portfolio table already answers "how much pipeline is under this
// firm"; it didn't answer "and which company should I be working". This
// picks that one company per firm, under two filters the user asked for:
//
//   - HQ in North America, and
//   - not a company that's already settled one way or the other: closed
//     off (Lost - Not Sold), parked (Hold Off), or a client now (Client)
//     or before (Old Client). The column answers "who should I be
//     working", and none of those four is the answer — a client least of
//     all, since it's already counted a column over under PC Clients.
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
//   2. Status can come from either of two places, and the more specific
//      one wins. A mapped PC row carries its own Status (the column on the
//      pop-up's Portfolio Companies table) — set by hand, on this firm's
//      portfolio, so it's taken at face value. A row that hasn't been given
//      one falls back to the status of the tracker prospect record with the
//      same company name, looked up by name. That order matters: marking a
//      company Hold Off on the firm's own list has to take it out of the
//      running, whether or not it exists as a prospect of its own.
//      A PC with neither has no status to fail, and stays eligible — the
//      filter excludes companies we know are closed, not companies we know
//      nothing about.

import { classifyHqRegion, NORTH_AMERICA } from './hqRegion.js';
import { computePortfolioFitScore, siteCountNumber } from './portfolioCompaniesWorkbook.js';
import { isActiveOppStage, activeStageRank } from './oppStages.js';
import { accountMatchesCompany } from './companyRenameCascade.js';

// The statuses that take a company out of the running. "Not Sold" is
// written 'Lost - Not Sold' on the prospect record (see data/enums.js).
// 'Old Client' is in here for the same reason 'Client' is: a company we
// used to serve isn't the answer to "who should I be working next" off a
// cold Top PC column — winning one back is its own motion, started from
// the account itself rather than from a firm's portfolio ranking.
export const TOP_PC_EXCLUDED_STATUSES = ['Lost - Not Sold', 'Hold Off', 'Client', 'Old Client'];

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

// …but the tracker writes a company's name three ways the mapped PC rows
// generally don't, and a bare key match misses every one of them:
//
//   "CPP - Consolidated Precision Products"        acronym prefix
//   "TowerBrook Capital Partners (a Blue Owl co.)" trailing parenthetical
//   "Perform Properties fka ShopCore"              former name
//
// The parenthetical alone accounts for roughly one account name in ten, so
// this isn't an edge case: without it, a company the user has marked Hold
// Off keeps getting recommended, which is the exact opposite of what the
// filter is for. Every key a name should be findable under, most specific
// first — the full name always leads, so an exact match still wins.
export function topPcCompanyKeys(name) {
  const raw = String(name || '').trim();
  const out = [];
  const add = (v) => {
    const k = topPcCompanyKey(v);
    if (k && !out.includes(k)) out.push(k);
  };
  add(raw);

  const noParen = raw.replace(/\s*\([^)]*\)\s*$/, '').trim();
  if (noParen && noParen !== raw) add(noParen);

  for (const base of [raw, noParen]) {
    if (!base) continue;
    // A short leading token before a dash or colon is an acronym for what
    // follows, not part of the name. Capped at 6 characters so a real
    // first word ("Perform - …") isn't thrown away.
    const acronym = base.match(/^[A-Za-z0-9&.]{1,6}\s*[-–—:|]\s+(\S.*)$/);
    if (acronym) add(acronym[1]);
    // Both sides of an fka/dba: the row may name either.
    const aka = base.split(/\s+(?:fka|f\/k\/a|dba|d\/b\/a)\b\.?\s+/i);
    if (aka.length > 1) aka.forEach(add);
  }
  return out;
}

/**
 * Company name → status, from the tracker's prospect records, built once
 * per prospect list and shared across every firm's row.
 *
 * Two tiers, because the alternate keys above are looser than the full
 * name and shouldn't be able to outrank it: `primary` holds full-name
 * keys only, `alt` the rest. A lookup tries every primary before any alt.
 */
export function buildStatusIndex(prospects) {
  const primary = new Map();
  const alt = new Map();
  for (const p of (prospects || [])) {
    if (!p?.status) continue;
    const entry = { status: p.status, company: String(p.company || '').trim() };
    const [full, ...rest] = topPcCompanyKeys(p?.company);
    // First writer wins on the full name: a duplicate shouldn't let an old
    // dead record knock a live one out of the running.
    if (full && !primary.has(full)) primary.set(full, entry);
    for (const key of rest) {
      const existing = alt.get(key);
      // Where several records collapse onto one alternate key, an
      // excluded status wins. The cost of being wrong runs one way here:
      // showing a company the user has already settled is the failure they
      // asked this filter to prevent, and the tooltip names the record
      // either way.
      if (!existing || (!EXCLUDED.has(existing.status.toLowerCase())
        && EXCLUDED.has(entry.status.toLowerCase()))) alt.set(key, entry);
    }
  }
  return { primary, alt };
}

// The status for a PC row's company name, or null when nothing matches.
// Returns the record it matched so callers can say WHICH one, which is the
// difference between a surprising status and an explicable one.
export function lookupCompanyStatus(index, companyName) {
  if (!index) return null;
  const keys = topPcCompanyKeys(companyName);
  for (const key of keys) {
    const hit = index.primary?.get(key);
    if (hit) return hit;
  }
  for (const key of keys) {
    const hit = index.alt?.get(key);
    if (hit) return hit;
  }
  return null;
}

// Where a mapped PC row says it's headquartered, as one string for
// classifyHqRegion. City alone is enough for a US city it recognises;
// country alone is enough for "United States".
function hqLocationOf(row) {
  return [row?.hqCity, row?.hqCountry].map(v => String(v || '').trim()).filter(Boolean).join(', ');
}

/**
 * The portfolio company on this firm that is already being worked: the one
 * carrying a live opportunity.
 *
 * The score-based pick answers "who should I start on". Once there is an open
 * opp on one of the firm's companies, that question is already answered —
 * recommending a different company beside live work reads as a to-do the user
 * has done. So a company with an active opp becomes the firm's Top/Current PC.
 *
 * It wins over the region and status filters the scored pick applies, and
 * deliberately: those filters exist to choose who to START on, and an active
 * opp is proof the work is under way. A client with an open opp, or a company
 * headquartered abroad we are quoting anyway, is still what is current on that
 * firm — filtering it out would leave the column recommending a stranger while
 * a live deal sat one column over in PE Opps.
 *
 * Candidates are the firm's mapped PC rows first, then prospects whose PE
 * Owner is this firm but which nobody has added to that list yet: an opp on
 * one of those is still work on a PE-owned company, and the column should say
 * so rather than wait for the mapping to catch up.
 *
 * @returns { companyName, mappedRow, stage, activeOppCount, opps } or null.
 */
export function pickCurrentPortfolioCompany({
  portfolioCompanies = [], portfolioProspects = [], oppsRecords = [],
} = {}) {
  const active = (Array.isArray(oppsRecords) ? oppsRecords : [])
    .filter(r => isActiveOppStage(r?.Stage));
  if (active.length === 0) return null;

  // Mapped rows lead: they carry the HQ, status and score the column shows,
  // so when a company is on both lists the mapped spelling is the one used.
  const candidates = [];
  const seen = new Set();
  const addCandidate = (name, mappedRow) => {
    const companyName = String(name || '').trim();
    if (!companyName) return;
    const key = topPcCompanyKey(companyName);
    if (!key || seen.has(key)) return;
    seen.add(key);
    candidates.push({ companyName, mappedRow });
  };
  for (const row of (Array.isArray(portfolioCompanies) ? portfolioCompanies : [])) {
    addCandidate(row?.companyName, row);
  }
  for (const p of (Array.isArray(portfolioProspects) ? portfolioProspects : [])) {
    addCandidate(p?.company, null);
  }
  if (candidates.length === 0) return null;

  let best = null;
  for (const cand of candidates) {
    const opps = active
      .filter(r => accountMatchesCompany(cand.companyName, r?.Account))
      .map(r => ({
        title: String(r?.['Opportunity Name'] || r?.Opportunity || r?.Name || '').trim() || '(Unnamed opportunity)',
        account: String(r?.Account || '').trim(),
        stage: String(r?.Stage || '').trim(),
      }));
    if (opps.length === 0) continue;
    // The furthest-along opp speaks for the company: a company at Agreement
    // Sent is more current than one at Lead.
    const stage = opps.reduce((a, b) => (activeStageRank(b.stage) > activeStageRank(a.stage) ? b : a)).stage;
    const entry = { companyName: cand.companyName, mappedRow: cand.mappedRow, stage, activeOppCount: opps.length, opps };
    if (!best || betterCurrent(entry, best)) best = entry;
  }
  return best;
}

// Which of two companies with live work is the more current: the further
// along the pipeline, then the one with more open opps, then the one the firm
// has actually mapped, and finally by name so the pick is stable between
// renders rather than depending on portfolio order.
function betterCurrent(a, b) {
  const ra = activeStageRank(a.stage);
  const rb = activeStageRank(b.stage);
  if (ra !== rb) return ra > rb;
  if (a.activeOppCount !== b.activeOppCount) return a.activeOppCount > b.activeOppCount;
  if (!!a.mappedRow !== !!b.mappedRow) return !!a.mappedRow;
  return a.companyName.localeCompare(b.companyName) < 0;
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
 *
 * `current` (from pickCurrentPortfolioCompany) short-circuits the ranking: a
 * company already being worked IS the firm's Top/Current PC, and the result
 * comes back flagged `isCurrent` with the opps behind it. Its score is still
 * computed when it is a mapped row, so the tooltip reads the same as any other
 * pick; a company known only as a prospect has no row to score and comes back
 * with `score: null`.
 */
export function pickTopPortfolioCompany(portfolioCompanies, statusIndex, { current = null } = {}) {
  const rows = Array.isArray(portfolioCompanies) ? portfolioCompanies : [];
  if (rows.length === 0 && !current) return null;

  // Same normalization basis as the All PCs tab and the workbook export,
  // over the whole portfolio — see note 1 at the top of this file.
  const maxE = rows.reduce((m, r) => Math.max(m, Number(r?.energyGwh) || 0), 0);
  const maxS = rows.reduce((m, r) => Math.max(m, siteCountNumber(r?.siteCount)), 0);
  const years = rows.map(r => Number(r?.acquisitionYear)).filter(y => y > 0);
  const yearRange = years.length > 0 ? { min: Math.min(...years), max: Math.max(...years) } : null;

  // A company with live work wins outright — see the note on `current` above.
  if (current) {
    const row = current.mappedRow || null;
    const rowStatus = String(row?.status || '').trim();
    const match = rowStatus ? null : lookupCompanyStatus(statusIndex, current.companyName);
    const score = row ? computePortfolioFitScore(row, maxE, maxS, yearRange) : null;
    return {
      companyName: current.companyName,
      score: Number.isFinite(score) ? score : null,
      hqCity: row?.hqCity || '', hqCountry: row?.hqCountry || '', hqLocation: row ? hqLocationOf(row) : '',
      status: rowStatus || match?.status || '',
      statusFromRow: !!rowStatus,
      statusCompany: match?.company && match.company !== current.companyName ? match.company : '',
      // What makes this the pick, for the tooltip and the cell's marker.
      isCurrent: true,
      currentStage: current.stage,
      activeOppCount: current.activeOppCount,
      currentOpps: current.opps,
      mapped: !!row,
      total: rows.length, eligible: 0, skippedRegion: 0, skippedStatus: 0, skippedNoScore: 0,
    };
  }

  let best = null;
  let skippedRegion = 0, skippedStatus = 0, skippedNoScore = 0, eligible = 0;

  for (const row of rows) {
    const companyName = String(row?.companyName || '').trim();
    if (!companyName) continue;

    const hqLocation = hqLocationOf(row);
    if (classifyHqRegion(hqLocation) !== NORTH_AMERICA) { skippedRegion++; continue; }

    // The row's own Status column first, the tracker record only as a
    // fallback — see note 2 at the top of this file.
    const rowStatus = String(row?.status || '').trim();
    const match = rowStatus ? null : lookupCompanyStatus(statusIndex, companyName);
    const status = rowStatus || match?.status || '';
    if (EXCLUDED.has(status.toLowerCase())) { skippedStatus++; continue; }

    eligible++;
    // An explicit "N/A" score (credit strategies, mostly) can't be ranked.
    // It's counted rather than treated as a zero, which would let it win a
    // portfolio where everything else is also unscored.
    const score = computePortfolioFitScore(row, maxE, maxS, yearRange);
    if (score == null || !Number.isFinite(score)) { skippedNoScore++; continue; }

    if (!best || score > best.score
      || (score === best.score && companyName.localeCompare(best.companyName) < 0)) {
      best = {
        companyName, score, hqCity: row?.hqCity || '', hqCountry: row?.hqCountry || '', hqLocation, status,
        // Where the status came from, so "why does this say Client?" has an
        // answer on screen: set on this firm's own PC row, or inherited
        // from a tracker record (named when it isn't this company's own).
        statusFromRow: !!rowStatus,
        statusCompany: match?.company && match.company !== companyName ? match.company : '',
      };
    }
  }

  if (!best) return null;
  return { ...best, total: rows.length, eligible, skippedRegion, skippedStatus, skippedNoScore };
}
