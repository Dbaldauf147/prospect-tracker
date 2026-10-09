// The portfolio's utility account (bill) count for a Master Analysis sheet:
// the total typed on the Utility Lookup page when there is one (the actual
// figure, off the company's invoices), else the per-site estimates added up.
// The per-site columns can only ever be the estimate, since a typed
// portfolio total can't be divided back over the sites, so the sheets show
// this as a total line under their tables.
//
//   manual        the typed total, or null when none is entered
//   siteAccounts  each site's estimate (null / missing for a site whose
//                 property type carries no profile)
//
// Returns { value, entered, label }, or null when there is neither a typed
// total nor any estimate to add up.
export function utilityAccountsTotal(manual, siteAccounts = []) {
  const typed = manual == null || manual === '' ? NaN : Number(manual);
  if (Number.isFinite(typed) && typed >= 0) {
    return { value: typed, entered: true, label: 'Utility accounts (actual, entered)' };
  }
  let sum = 0;
  let any = false;
  for (const a of siteAccounts || []) {
    const n = Number(a);
    if (a == null || a === '' || !Number.isFinite(n)) continue;
    sum += n;
    any = true;
  }
  if (!any || sum <= 0) return null;
  // Rounded the way the page rounds its estimate: a "0 - 1" counts as 0.5
  // per site, and a portfolio total of bills is a whole number.
  return { value: Math.round(sum), entered: false, label: 'Est. utility accounts (total)' };
}
