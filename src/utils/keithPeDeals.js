// The deals behind the "PE overlap deals" line on the Keith agenda: every
// Private Equity or Portfolio Company opp that has reached Stage 3 (Lead) or
// later and is still open.
//
// "PE or Portfolio Company" is read off the opp itself: its Type, or a PE
// Owner filled in (which is only ever set on a portfolio company's deal).
// Sold and Not Sold are past the numbered stages, so they drop out; so do
// Not Started and anything that never reached Lead.
//
// Pure, so the rule can be asserted without a browser:
// scripts/keithPeDeals.test.mjs.

import { STAGE_BANDS } from './stageBands.js';
import { splitPeOwners } from './peOwners.js';

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

/**
 * PE / Portfolio Company opps at Stage 3+, furthest along first, then
 * biggest, then by account so the order is stable.
 *
 *   parseAmount  (raw) => number | null
 *   fmtAmount    (number) => string
 *
 *   [{ id, name, amount, amountLabel, stage, stageLabel }]
 */
export function buildPeOverlapDeals(records, { parseAmount = () => null, fmtAmount = String } = {}) {
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
      };
    })
    .sort((a, b) => b.stage - a.stage
      || (b.amount ?? -Infinity) - (a.amount ?? -Infinity)
      || a.name.localeCompare(b.name));
}
