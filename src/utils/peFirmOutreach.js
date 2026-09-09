// The PE firms behind step 6 of the Prospecting ladder.
//
// The step asks for outreach to PE partners, and the firms worth that call
// are the ones the relationship has already started with and nothing is
// happening on: past Lead, not written off as Not Sold, and carrying no
// OPEN opportunity — not on the firm, not on any of its portfolio
// companies. A firm with an opp in flight is being worked; a Lead has not
// been picked up yet, and a Not Sold has been answered.
//
// Closed deals — Sold, Not Sold, Closed, Lost — do NOT disqualify a firm.
// They did once, on the reasoning that the question was whether anything
// had ever been opened here. But the step is about what is in flight, and
// a firm whose every deal has landed or died has nothing in flight: that
// is precisely the relationship worth ringing for the next intro, and the
// old rule buried it forever behind deals that closed years ago. Each row
// carries `closedCount` so a firm that shows up with history says so.
//
// It used to list each firm's Top PC that wasn't at Qualifying, which
// ranked companies by Opportunity Score and said nothing about whether the
// firm had anything going on. A firm with three live opps could top the
// list because its highest-scoring PC hadn't been opened.
//
// "Has an open opp" is read through peFirmOpps, which is what the PE
// Portfolio table's PE Opps column counts — that column prints open/total,
// so a firm reading 0/anything there is exactly a firm listed here.

import { PE_STAGES } from '../data/enums.js';
import { isOppActive, peFirmAccountNames, peFirmOppRows, peFirmPortfolio } from './peFirmOpps.js';

// The Type that marks a prospect as a PE firm — same filter the PE
// Portfolio page lists its firms with.
export const PE_FIRM_TYPE = 'Private Equity';

// The two stages this step passes over. A Lead is a firm nobody has opened
// the relationship with, which is cold outreach rather than a partner to
// ask; a Not Sold has already given its answer. Everything between them —
// Discovery, Piloting, Existing Partnership — is a live relationship, and a
// live relationship with no opportunity on it is the gap this step is for.
export const SKIPPED_PE_STAGES = ['Lead', 'Not Sold'];

/**
 * A firm's stage as one of PE_STAGES. Anything unrecognised — blank, or a
 * value left by an older version — reads as Lead, the same way the PE
 * Portfolio board reads it, so an unstaged firm is treated as untouched
 * rather than quietly counted as a relationship.
 */
export function peFirmStage(peStage) {
  const stage = String(peStage || '').trim();
  return PE_STAGES.includes(stage) ? stage : PE_STAGES[0];
}

/** Is this a stage where a firm belongs on the list at all? */
export function isWorkablePeStage(stage) {
  return !SKIPPED_PE_STAGES.includes(peFirmStage(stage));
}

/**
 * PE firms with a live relationship and nothing open on it.
 *
 * Returns null when either input hasn't loaded yet, so the caller can tell
 * "no firms to chase" from "don't know yet" — an empty list would otherwise
 * clear the step before the opps have even arrived.
 *
 * Each row: { firm, firmId, stage, pcCount, closedCount }. `pcCount` is how
 * many portfolio companies the firm has — those that name it as their PE
 * Owner plus those mapped on its own list — the material for the
 * conversation, and a zero there is its own kind of gap.
 * `closedCount` is how many opps the firm has that are all done with, which
 * is why a firm with a long history can still be sitting here silent.
 *
 * Ordered by how far the relationship has got, furthest first: an Existing
 * Partnership with nothing in flight is a louder silence than a firm still
 * in Discovery. Ties by name, so the list is stable between renders.
 */
export function collectPeFirmsToWork(prospects, oppsRecords) {
  if (!Array.isArray(prospects) || !Array.isArray(oppsRecords)) return null;
  const out = [];
  for (const p of prospects) {
    if (String(p?.type || '').trim() !== PE_FIRM_TYPE) continue;
    const stage = peFirmStage(p?.peStage);
    if (!isWorkablePeStage(stage)) continue;
    const firm = String(p?.company || '').trim();
    // Both halves of a firm's portfolio: the prospects that name it as their
    // PE Owner, and the companies mapped on the firm's own list. A company
    // can be in either alone, and reading one of them is how a firm with
    // live work lands on a list of silent ones — CD&R sat here while an opp
    // on Pursuit Aerospace was open, because the firm record says "Clayton,
    // Dubilier & Rice (CDR)" and the company says "Clayton, Dubilier & Rice".
    const portfolio = peFirmPortfolio(firm, prospects);
    const mapped = Array.isArray(p?.portfolioCompanies) ? p.portfolioCompanies : [];
    const accountNames = peFirmAccountNames(firm, portfolio, mapped);
    // Open opps only. One live deal anywhere across the firm and its
    // portfolio companies means the relationship is being worked; a pile of
    // closed ones means it isn't, however busy it once was.
    const oppRows = peFirmOppRows(accountNames, oppsRecords);
    if (oppRows.some(isOppActive)) continue;
    out.push({
      firm: firm || '-',
      firmId: p?.id || null,
      stage,
      // Counted over both halves, the same way the account names are
      // gathered, so a company on both lists counts once.
      pcCount: accountNames.length - 1,
      // Every row here failed the `some(isOppActive)` test above, so all of
      // this firm's opps are closed — the count is the whole history.
      closedCount: oppRows.length,
    });
  }
  const rank = (s) => PE_STAGES.indexOf(s);
  out.sort((a, b) => (rank(b.stage) - rank(a.stage)) || a.firm.localeCompare(b.firm));
  return out;
}
