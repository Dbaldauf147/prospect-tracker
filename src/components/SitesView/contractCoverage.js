// The Contract Coverage tab on the Master Analysis: how much of each
// deregulated market's spend is tied up in supply agreements that haven't
// expired yet, and therefore how much of it the Indicative Savings tab can
// actually take a percentage of in each year of the projection.
//
// The tab carries two inputs per market and commodity, both editable in the
// workbook: the share of spend under agreement, and the date that agreement
// ends. Everything after them is a formula, and the Indicative Savings tab's
// Annual and Year 1-5 columns read the per-year open spend those formulas
// produce. So a seller can sit with the customer, type "60 % of Texas is
// locked until March 2028", and watch the savings move.
//
// The model, per market:
//   S  savings-eligible spend/yr
//   C  share of S under agreement (0-1)
//   M  months of the projection the agreement still covers
//   open spend in year N = S*(1-C) + S*C * clamp(12N - M, 0, 12) / 12
//
// That is a market-level approximation of the per-site, per-month contract
// gating the page does: one share and one end date stand in for every
// site's. The seed values are read off the sites so an untouched workbook
// lands close to that site-level answer, and the point of the tab is that
// the seller can then overrule them.
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
 * Spend open to re-sourcing in each year of the projection, annualised:
 * index 0 is Year 1. Mirrors openSpendFormula.
 */
export function openSpendByYear(spend, coveredShare, monthsLocked) {
  const s = num(spend);
  const c = Math.max(0, Math.min(1, num(coveredShare)));
  const m = num(monthsLocked);
  const out = [];
  for (let n = 1; n <= COVERAGE_YEARS; n++) {
    const freeMonths = Math.max(0, Math.min(12, 12 * n - m));
    out.push(s * (1 - c) + s * c * freeMonths / 12);
  }
  return out;
}

/**
 * The seed values for one market, read off its sites.
 *
 * @param sites            [{ spend, end }] — savings-eligible spend and the
 *                         supply agreement's end date (Date or null)
 * @param projectionStart  first day of the projection (Date)
 * @returns {{ sites, coveredSites, coveredSpend, coveredShare, expiry }}
 *          `expiry` is the spend-weighted average end date of the sites still
 *          under agreement (a UTC-midnight Date), or null when none are.
 *
 * Spend-weighted rather than the latest end date: one site locked to 2031
 * shouldn't hold a market's other forty sites, which come free next spring,
 * out of the projection for five years.
 */
export function coverageSeed(sites, projectionStart) {
  const startMs = projectionStart instanceof Date ? projectionStart.getTime() : NaN;
  let total = 0;
  let coveredSites = 0;
  let coveredSpend = 0;
  let weightedEnd = 0;
  let count = 0;
  for (const site of sites || []) {
    const spend = Math.max(0, num(site?.spend));
    count += 1;
    total += spend;
    const end = site?.end;
    if (!(end instanceof Date) || !Number.isFinite(end.getTime())) continue;
    if (!(end.getTime() > startMs)) continue;
    coveredSites += 1;
    coveredSpend += spend;
    weightedEnd += spend * end.getTime();
  }
  const coveredShare = total > 0 ? coveredSpend / total : 0;
  const expiry = coveredSpend > 0 ? utcDay(new Date(weightedEnd / coveredSpend)) : null;
  return { sites: count, coveredSites, coveredSpend, coveredShare, expiry };
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

// Open spend in year `n` (1-based).
export function openSpendFormula(spendRef, shareRef, monthsRef, n) {
  const share = `MAX(0,MIN(1,N(${shareRef})))`;
  return `${spendRef}*(1-${share})+${spendRef}*${share}*MAX(0,MIN(12,${12 * n}-${monthsRef}))/12`;
}
