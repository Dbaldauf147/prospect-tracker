// The Contract Coverage tab on the Master Analysis: every deregulated site,
// its consumption and spend, and the supply agreement it is tied up in, so
// the projection can say which sites' spend is free to re-source in each year
// and which is locked until its agreement ends.
//
// The tab carries one input per site, editable in the workbook: the date its
// agreement ends (blank = no agreement, open from day one). Everything after
// it is a formula, and the Indicative Savings tab's Annual and Year 1-5
// columns add up those per-site formulas for each market. So a seller can sit
// with the customer, type "the Dallas store is locked until March 2028", and
// watch the Texas savings move.
//
// The model, per site:
//   S  savings-eligible spend/yr
//   M  months of the projection the agreement still covers
//   open spend in year N = S * clamp(12N - M, 0, 12) / 12
//
// M is counted the same way the page's own month-by-month contract gating
// counts it (a month is covered when the agreement ends after its first
// day), so an untouched workbook reproduces the page's site-level figures.
//
// Pure and dependency-free, so the arithmetic the workbook's formulas encode
// can be pinned in scripts/contractCoverage.test.mjs. The Excel formula
// builders live here beside the JS mirror for the same reason: the two have
// to agree, and keeping them on one screen is the cheapest way to make sure.

export const COVERAGE_YEARS = 5;
export const COVERAGE_MONTHS = COVERAGE_YEARS * 12;

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

// A date as a UTC midnight. Excel stores a date as a day count with no time
// zone, and ExcelJS converts a JS Date by its UTC value, so a local-midnight
// date east of Greenwich lands on the previous day in the workbook. Building
// every date the tab writes from its calendar parts in UTC keeps the day the
// sheet shows equal to the day the JS model used.
export function utcDay(d) {
  if (!(d instanceof Date) || !Number.isFinite(d.getTime())) return null;
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
}

/**
 * Months of the projection an agreement ending on `expiry` still covers,
 * counted the way the site-level gating counts them: a month is covered when
 * the agreement ends after its first day. Mirrors monthsLockedFormula.
 *
 * Both dates are read by their UTC parts (see utcDay).
 */
export function monthsUnderAgreement(expiry, projectionStart) {
  if (!(expiry instanceof Date) || !Number.isFinite(expiry.getTime())) return 0;
  if (!(projectionStart instanceof Date) || !Number.isFinite(projectionStart.getTime())) return 0;
  const m = (expiry.getUTCFullYear() - projectionStart.getUTCFullYear()) * 12
    + (expiry.getUTCMonth() - projectionStart.getUTCMonth())
    + (expiry.getUTCDate() > 1 ? 1 : 0);
  return Math.max(0, Math.min(COVERAGE_MONTHS, m));
}

/**
 * One site's spend open to re-sourcing in each year of the projection,
 * annualised: index 0 is Year 1. Mirrors siteOpenSpendFormula.
 */
export function siteOpenSpendByYear(spend, monthsLocked) {
  const s = num(spend);
  const m = num(monthsLocked);
  const out = [];
  for (let n = 1; n <= COVERAGE_YEARS; n++) {
    out.push(s * Math.max(0, Math.min(12, 12 * n - m)) / 12);
  }
  return out;
}

// ---- Excel formula builders -------------------------------------------
// Each takes plain cell references ("G8", "'Contract Coverage'!$C$3") and
// returns the formula text without a leading "=".

// Months still covered. Blank expiry (no agreement on file) reads as 0.
export function monthsLockedFormula(expiryRef, startRef) {
  return `IF(ISNUMBER(${expiryRef}),MAX(0,MIN(${COVERAGE_MONTHS},`
    + `(YEAR(${expiryRef})-YEAR(${startRef}))*12+MONTH(${expiryRef})-MONTH(${startRef})`
    + `+IF(DAY(${expiryRef})>1,1,0))),0)`;
}

// One site's open spend in year `n` (1-based).
export function siteOpenSpendFormula(spendRef, monthsRef, n) {
  return `${spendRef}*MAX(0,MIN(12,${12 * n}-${monthsRef}))/12`;
}

// A market's open spend on the Indicative Savings tab: the sites on the
// Contract Coverage tab whose market column matches this row's, summed over
// one or more of their Open Spend year columns (Year 1 through N).
export function marketOpenSpendFormula(marketRangeRef, marketCellRef, openRangeRef) {
  return `SUMPRODUCT((${marketRangeRef}=${marketCellRef})*${openRangeRef})`;
}

// One site's broker fee saving against SE's fee in year `n` (1-based):
// the annual saving (negative for an added cost) phased in on the same
// schedule as its open spend, since SE only becomes the broker once the
// current agreement ends. Nothing for a site with no saving worked out
// (a fee missing) or no savings-eligible spend (a leased site held out of
// the projection). Mirrors siteBrokerSavingsByYear.
export function siteBrokerSavingsFormula(brokerRef, spendRef, monthsRef, n) {
  return `IF(AND(ISNUMBER(${brokerRef}),${spendRef}>0),`
    + `${brokerRef}*MAX(0,MIN(12,${12 * n}-${monthsRef}))/12,0)`;
}

export function siteBrokerSavingsByYear(annualSaving, spend, monthsLocked) {
  const a = Number(annualSaving);
  if (!Number.isFinite(a) || !(num(spend) > 0)) return new Array(COVERAGE_YEARS).fill(0);
  const m = num(monthsLocked);
  const out = [];
  for (let n = 1; n <= COVERAGE_YEARS; n++) {
    out.push(a * Math.max(0, Math.min(12, 12 * n - m)) / 12);
  }
  return out;
}
