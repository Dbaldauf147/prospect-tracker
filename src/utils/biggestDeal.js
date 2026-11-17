// The Biggest Deal column on the contacts tables: for a contact's company,
// the opp on the Opps tab with the largest Quoted Amount (what that tab
// shows as Deal Size).
//
// It answers "how much revenue is behind this person's account", which is
// what ranking the Key Contacts top 50 turns on. So lost deals don't count:
// a Not Sold opp is money that isn't coming. Sold and every live stage do,
// and the stage is handed back so the cell can say which kind it is.
//
// Pure, so scripts/biggestDeal.test.mjs checks it.

import { parseMoney } from './oppsMetrics.js';

const LOST_STAGES = new Set(['not sold', 'lost', 'closed lost']);
const INVALID_STAGES = new Set(['#n/a', '#ref!', '#value!', '#error!', 'n/a', '-', '']);

/**
 * { amount, stage, name } for the biggest deal among `opps` (Opps 2
 * records), or null when none has a Quoted Amount above zero. Ties keep
 * the first one listed.
 */
export function biggestDeal(opps) {
  let best = null;
  for (const r of opps || []) {
    if (!r || typeof r !== 'object') continue;
    const stage = String(r['Stage'] ?? '').trim();
    const lc = stage.toLowerCase();
    if (INVALID_STAGES.has(lc) || LOST_STAGES.has(lc)) continue;
    const amount = parseMoney(r['Quoted Amount']);
    if (!(amount > 0)) continue;
    if (best && amount <= best.amount) continue;
    const name = String(r['BFO Link'] || r['Opportunity Name'] || r['Scope'] || '').trim();
    best = { amount, stage, name: name === '-' ? '' : name };
  }
  return best;
}

/** $950, $12K, $1.2M, $3.4B: short enough for a table cell. */
export function formatDealAmount(n) {
  if (!(n > 0)) return '';
  const fmt = (v, unit) => `$${v >= 100 ? Math.round(v) : Number(v.toFixed(1))}${unit}`;
  if (n >= 1e9) return fmt(n / 1e9, 'B');
  if (n >= 1e6) return fmt(n / 1e6, 'M');
  if (n >= 1e3) return fmt(n / 1e3, 'K');
  return `$${Math.round(n)}`;
}
