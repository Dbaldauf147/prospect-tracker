// The electric (kWh) and gas (Dth) volumes an SIA's header block carries,
// as Unit Counts for a fee priced Per kWh or Per Dth (a Strategic Sourcing
// fee that spreads the sourcing costs over the energy bought).
//
// The figures are read as MONTHLY amounts: a Recurring (monthly) fee on
// Per kWh then reads as a rate per kWh per month, billing fee x kWh every
// month. Gas in MMBtu is taken as Dth (1 MMBtu is 1 Dth to within a
// rounding error).
//
// Each option takes its own figure when its header has one, else the first
// option's that does (an SIA often fills the header on one sheet only), the
// same way the site and account counts read.

import { siaKeyFacts } from './siaHistoryEntry.js';

export const UNIT_PER_KWH = 'Per kWh';
export const UNIT_PER_DTH = 'Per Dth';

const pos = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);

export function usageCountsFor(opt, options = []) {
  const own = siaKeyFacts(opt ? [opt] : []);
  const all = siaKeyFacts(options);
  return {
    kwhCount: pos(own.annualKwh) ?? pos(all.annualKwh),
    dthCount: pos(own.annualGas) ?? pos(all.annualGas),
  };
}

// Options with kwhCount / dthCount filled from the header block. A count the
// option already carries is kept. Returns the same array when nothing
// changed.
export function withUsageCounts(options) {
  if (!Array.isArray(options)) return options;
  let changed = false;
  const out = options.map(o => {
    if (!o) return o;
    const u = usageCountsFor(o, options);
    const kwhCount = pos(o.kwhCount) ?? u.kwhCount;
    const dthCount = pos(o.dthCount) ?? u.dthCount;
    if (kwhCount === (o.kwhCount ?? null) && dthCount === (o.dthCount ?? null)) return o;
    changed = true;
    return { ...o, kwhCount, dthCount };
  });
  return changed ? out : options;
}

// A fee per kWh or per Dth is a fraction of a cent, so it is shown to five
// decimal places where a fee per site rounds to the cent.
export function isUsageUnit(unit) {
  return unit === UNIT_PER_KWH || unit === UNIT_PER_DTH;
}

export function fmtFeePerUnit(n, unit, { currency = true } = {}) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '';
  const opts = { minimumFractionDigits: 2, maximumFractionDigits: isUsageUnit(unit) ? 5 : 2 };
  return currency
    ? n.toLocaleString('en-US', { style: 'currency', currency: 'USD', ...opts })
    : n.toLocaleString('en-US', opts);
}
