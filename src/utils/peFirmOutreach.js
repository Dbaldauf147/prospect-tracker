// The PE firms behind step 6 of the Prospecting ladder.
//
// The step asks for outreach to PE partners, and the firms worth that call
// are the ones the relationship has already started with and nothing is
// happening on: past Lead, not written off as Not Sold, and carrying no
// opportunity at all — not on the firm, not on any of its portfolio
// companies. A firm with an opp in flight is being worked; a Lead has not
// been picked up yet, and a Not Sold has been answered.
//
// It used to list each firm's Top PC that wasn't at Qualifying, which
// ranked companies by Opportunity Score and said nothing about whether the
// firm had anything going on. A firm with three live opps could top the
// list because its highest-scoring PC hadn't been opened.
//
// "Has an opp" is read through peFirmOpps, which is what the PE Portfolio
// table's PE Opps column counts — so a firm reading 0/0 there is exactly a
// firm listed here.

import { PE_STAGES } from '../data/enums.js';
import { peFirmAccountNames, peFirmOppRows, portfolioByPeOwner } from './peFirmOpps.js';

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
 * PE firms with a live relationship and no opportunity on it.
 *
 * Returns null when either input hasn't loaded yet, so the caller can tell
 * "no firms to chase" from "don't know yet" — an empty list would otherwise
 * clear the step before the opps have even arrived.
 *
 * Each row: { firm, firmId, stage, pcCount }. `pcCount` is how many
 * portfolio companies name this firm as their PE Owner — the material for
 * the conversation, and a zero there is its own kind of gap.
 *
 * Ordered by how far the relationship has got, furthest first: an Existing
 * Partnership with nothing in flight is a louder silence than a firm still
 * in Discovery. Ties by name, so the list is stable between renders.
 */
export function collectPeFirmsToWork(prospects, oppsRecords) {
  if (!Array.isArray(prospects) || !Array.isArray(oppsRecords)) return null;
  const portfolios = portfolioByPeOwner(prospects);
  const out = [];
  for (const p of prospects) {
    if (String(p?.type || '').trim() !== PE_FIRM_TYPE) continue;
    const stage = peFirmStage(p?.peStage);
    if (!isWorkablePeStage(stage)) continue;
    const firm = String(p?.company || '').trim();
    const portfolio = portfolios.get(firm.toLowerCase()) || [];
    // Any opp at all, open or closed: the question is whether this firm has
    // ever had something on it, not whether that something is still live.
    if (peFirmOppRows(peFirmAccountNames(firm, portfolio), oppsRecords).length > 0) continue;
    out.push({
      firm: firm || '-',
      firmId: p?.id || null,
      stage,
      pcCount: portfolio.length,
    });
  }
  const rank = (s) => PE_STAGES.indexOf(s);
  out.sort((a, b) => (rank(b.stage) - rank(a.stage)) || a.firm.localeCompare(b.firm));
  return out;
}
