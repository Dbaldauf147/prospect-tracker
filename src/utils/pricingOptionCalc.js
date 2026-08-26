// Math + snapshot helpers shared between the Pricing → Options tab
// (the editor) and the Opps 2 view (which renders the frozen snapshot
// attached to an Opp). Keeping these here means a snapshot can be
// re-rendered later even when the Pricing tab has been cleared.

export const MAX_YEARS = 5;

export function toNum(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(String(v).replace(/[$,\s%]/g, ''));
  return Number.isFinite(n) ? n : null;
}

// Est. Unit Count column treats a blank entry as 1 so a row with just
// a fee still produces revenue. An explicit 0 is honored.
export function unitCountOrOne(v) {
  const n = toNum(v);
  return n == null ? 1 : n;
}

// Months a row is billed inside the requested year (1-indexed),
// honoring the contract length. One-time and Setup hit a single
// month (the start month); Recurring bills every month from start
// through the end of the contract.
export function activeMonthsInYear(row, yearIdx, termYears) {
  const fee = toNum(row.fee);
  if (fee == null) return 0;
  const startMonth = toNum(row.startMonth);
  if (startMonth == null || startMonth < 1) return 0;
  const lastMonth = termYears * 12;
  if (startMonth > lastMonth) return 0;
  const yStart = (yearIdx - 1) * 12 + 1;
  const yEnd = yearIdx * 12;
  const t = (row.type || '').toLowerCase();
  if (t.startsWith('recurring')) {
    const billStart = Math.max(yStart, startMonth);
    const billEnd = Math.min(yEnd, lastMonth);
    return billEnd >= billStart ? billEnd - billStart + 1 : 0;
  }
  return startMonth >= yStart && startMonth <= yEnd ? 1 : 0;
}

// Per-year revenue for a single row, applying the annual escalator
// to the year the revenue is collected in (Year 1 = base).
export function rowYearRevenue(row, yearIdx, termYears, escPct) {
  const months = activeMonthsInYear(row, yearIdx, termYears);
  if (!months) return 0;
  const fee = toNum(row.fee) || 0;
  const uc = unitCountOrOne(row.unitCount);
  const esc = Math.pow(1 + (escPct || 0) / 100, yearIdx - 1);
  return fee * uc * months * esc;
}

// Revenue billed by a single row in a specific contract month
// (1-indexed, where 1..12 = Year 1).
export function rowMonthRevenue(row, month, termYears, escPct) {
  const fee = toNum(row.fee);
  if (fee == null) return 0;
  const uc = unitCountOrOne(row.unitCount);
  const startMonth = toNum(row.startMonth);
  if (startMonth == null || startMonth < 1) return 0;
  const lastMonth = termYears * 12;
  if (month < startMonth || month > lastMonth) return 0;
  const yearIdx = Math.ceil(month / 12);
  const esc = Math.pow(1 + (escPct || 0) / 100, yearIdx - 1);
  const t = (row.type || '').toLowerCase();
  if (t.startsWith('recurring')) return fee * uc * esc;
  return month === startMonth ? fee * uc : 0;
}

// Cumulative "Deal margin" through each year — the exact formula the
// Pricing page's Deal-margin row renders, factored out so the on-screen
// table and the snapshot frozen onto an Opp can't drift apart.
//
// Margin is cumulative, not per-year-in-isolation: a heavy Year-1 setup
// fee keeps lifting the blended margin in later years, so fee and cost
// accumulate year over year before the ratio is taken. Pass-through
// (billed at face cost, no margin) is carved out of BOTH sides so it
// can't dilute the percentage.
//
//   margin(year N) = (Σfee₁..ₙ − ΣctsPass₁..ₙ − ΣaltPass₁..ₙ − (Σcost₁..ₙ − ΣctsPass₁..ₙ))
//                    ÷ (Σfee₁..ₙ − ΣctsPass₁..ₙ − ΣaltPass₁..ₙ)
//
// Returns one entry per year (null where there's no billable revenue to
// take a ratio against) plus the term totals behind the last entry.
export function cumulativeDealMargins({ feeByYear = [], costByYear = [], ctsPassByYear = [], altPassByYear = [] } = {}) {
  const at = (arr, i) => (Array.isArray(arr) ? Number(arr[i]) || 0 : 0);
  let cumFee = 0;
  let cumCost = 0;
  let cumCtsPass = 0;
  let cumAltPass = 0;
  const marginByYear = feeByYear.map((fee, i) => {
    cumFee += Number(fee) || 0;
    cumCost += at(costByYear, i);
    cumCtsPass += at(ctsPassByYear, i);
    cumAltPass += at(altPassByYear, i);
    const adjFee = cumFee - cumCtsPass - cumAltPass;
    if (adjFee <= 0) return null;
    const adjCost = cumCost - cumCtsPass;
    return (adjFee - adjCost) / adjFee;
  });
  return {
    marginByYear,
    // The last year's cumulative margin IS the margin over the full
    // term — what the Pricing page's Deal-margin row ends on, and what
    // gets quoted as the deal's margin.
    finalMargin: marginByYear.length ? marginByYear[marginByYear.length - 1] : null,
    termRevenue: cumFee - cumCtsPass - cumAltPass,
    termCost: cumCost - cumCtsPass,
  };
}

// Freeze an Options-tab option into a self-contained snapshot the
// Opp can render later. Includes every computed total the Options-tab
// summary shows so the Opp view never re-does the math.
export function buildPricingOptionSnapshot(option) {
  const termYears = Math.max(1, Math.min(MAX_YEARS, Number(option?.years) || 1));
  const esc = Number(option?.escPct) || 0;
  const rows = Array.isArray(option?.rows) ? option.rows : [];
  const yearTotals = Array.from({ length: MAX_YEARS }, (_, i) => {
    const year = i + 1;
    if (year > termYears) return 0;
    return rows.reduce((sum, r) => sum + rowYearRevenue(r, year, termYears, esc), 0);
  });
  const termValues = Array.from({ length: MAX_YEARS }, (_, i) => {
    const t = i + 1;
    if (t > termYears) return 0;
    let sum = 0;
    for (let y = 1; y <= t; y += 1) {
      sum += rows.reduce((s, r) => s + rowYearRevenue(r, y, t, esc), 0);
    }
    return sum;
  });
  const setupTotal = rows
    .filter(r => (r.type || '').toLowerCase() === 'setup')
    .reduce((s, r) => s + (toNum(r.fee) || 0) * unitCountOrOne(r.unitCount), 0);
  const year1Monthly = Array.from({ length: 12 }, (_, i) => {
    const month = i + 1;
    return rows.reduce((s, r) => s + rowMonthRevenue(r, month, termYears, esc), 0);
  });
  const year1MonthlyTotal = year1Monthly.reduce((s, v) => s + v, 0);
  return {
    name: option?.name || '',
    years: termYears,
    escPct: esc,
    // Service bundle for this Option (line-item → services mapping,
    // deduped upstream). Frozen in so the Opp can list them even after
    // the Pricing tab is cleared.
    services: Array.isArray(option?.services) ? option.services.filter(Boolean) : [],
    rows: rows.map(r => ({ ...r })),
    year1Total: yearTotals[0] || 0,
    yearTotals,
    termValues,
    setupTotal,
    year1Monthly,
    year1MonthlyTotal,
    // Margin the option was quoted at, when the caller can compute it.
    // The SIA (Pricing) path can — it knows the linked CTS cost behind
    // every fee — and passes it in; the hand-built Options subtab has
    // no cost side at all, so it passes nothing and the margin block
    // simply doesn't render on the Opp.
    marginByYear: normMargins(option?.marginByYear, termYears),
    finalMargin: normMargin(option?.finalMargin),
    termRevenue: normNum(option?.termRevenue),
    termCost: normNum(option?.termCost),
    savedAt: new Date().toISOString(),
  };
}

// Snapshot field guards — a margin is a finite fraction (0.46 = 46%) or
// null; anything else (undefined, NaN, a string) is dropped rather than
// frozen into the snapshot as junk the Opp view would have to re-check.
function normMargin(v) {
  // Guard the empty-ish values Number() happily coerces to 0 — a
  // missing margin must stay null, not read as a 0% deal.
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normNum(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normMargins(list, termYears) {
  if (!Array.isArray(list)) return null;
  return Array.from({ length: termYears }, (_, i) => normMargin(list[i]));
}

// The Year-1 figures a frozen Pricing-Option snapshot implies: the
// Setup + One Time fees that bill in year 1, the recurring fee per month,
// and the recurring revenue across year 1.
//
// Recomputed from the snapshot's own rows rather than read off a stored
// total, so it stays correct after the Pricing tab is cleared — and so the
// Opp popup, the Deals page and anything else quoting these numbers cannot
// drift apart. `recurringAnnual` uses rowYearRevenue rather than fee × 12: a
// line that starts in month 4 bills nine months in year 1, not twelve.
//
// Returns null for a missing snapshot, so callers can tell "no option saved"
// from an option that happens to price at zero.
export function pricingSnapshotYear1(snapshot) {
  if (!snapshot) return null;
  const rows = Array.isArray(snapshot.rows) ? snapshot.rows : [];
  const years = Math.max(1, Number(snapshot.years) || 1);
  const esc = Number(snapshot.escPct) || 0;
  let setupOneTime = 0;
  let recurringMonthly = 0;
  let recurringAnnual = 0;
  for (const r of rows) {
    if (String(r.type || '').toLowerCase().startsWith('recurring')) {
      recurringMonthly += (toNum(r.fee) || 0) * unitCountOrOne(r.unitCount);
      recurringAnnual += rowYearRevenue(r, 1, years, esc);
    } else {
      // Setup / One Time lines bill a single month — rowYearRevenue
      // returns their amount only when that month lands in Year 1.
      setupOneTime += rowYearRevenue(r, 1, years, esc);
    }
  }
  // Deal margin over the term, frozen in by the Pricing tab. Only the SIA
  // path can compute one, so this is null for options saved from the
  // hand-built Options subtab.
  const finalMargin = typeof snapshot.finalMargin === 'number' && Number.isFinite(snapshot.finalMargin)
    ? snapshot.finalMargin
    : null;
  return {
    name: String(snapshot.name || '').trim(),
    setupOneTime,
    recurringMonthly,
    recurringAnnual,
    year1Total: Number(snapshot.year1Total) || 0,
    finalMargin,
  };
}

export function fmtMoneyWhole(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '';
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

// Margin as a display percentage — one decimal, matching the Pricing
// page's Deal-margin cells. Blank for a missing / non-numeric margin so
// callers can render a dash instead of "NaN%".
export function fmtMarginPct(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '';
  return `${(n * 100).toFixed(1)}%`;
}
