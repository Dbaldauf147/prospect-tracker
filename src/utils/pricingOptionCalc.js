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
    rows: rows.map(r => ({ ...r })),
    year1Total: yearTotals[0] || 0,
    yearTotals,
    termValues,
    setupTotal,
    year1Monthly,
    year1MonthlyTotal,
    savedAt: new Date().toISOString(),
  };
}

export function fmtMoneyWhole(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '';
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}
