// Giving every site the same value for a column the file never had.
//
// The Utility Lookup page derives everything from the columns of the
// uploaded spreadsheet, so a field the file doesn't carry can't be filled
// in from the page: Mass Edit deliberately never invents a column (see
// siteMassEdit.js), and the property-type mapping table can only map values
// that some site actually has. A portfolio that arrives with no Property
// Type column at all falls through both — there is nothing to edit and
// nothing to map, and the fix was "add the column in Excel and re-upload",
// which throws away every per-row decision made on the page since.
//
// Filling the column from the page is the way out, and it only works
// because of how the mapping survives a reload: the page re-derives its
// column mapping from the persisted HEADERS by pattern (detectSitesMapping),
// so a column created under the name the detector already looks for is
// picked back up on the next load with nothing else to store.
//
// Pure: no React, no IndexedDB (scripts/siteColumnFill.test.mjs).

/**
 * The header name to create for a field, chosen to match what
 * detectSitesMapping looks for so the mapping survives a reload.
 *
 * Only the fields worth filling portfolio-wide are here; each name is one
 * the detector's own patterns match.
 */
export const FILL_HEADERS = {
  propertyType: 'Property Type',
  division: 'Division',
  propertySize: 'Sq Ft',
  ownership: 'Ownership',
  zip: 'Zip Code',
  // The unit sits in the consumption names so detectConsumptionColumns
  // reads them as its strongest tier, and the cost names carry "Cost" so
  // the consumption detector's exclude list keeps them out of it.
  electric: 'Electric kWh',
  gas: 'Gas Therms',
  electricCost: 'Electric Cost ($)',
  gasCost: 'Gas Cost ($)',
};

/**
 * Data summary row → the site field clicking it edits.
 *
 * Accounts and equipment are never on an upload; both are worked out from
 * the property type, so that is the field their rows open.
 */
export const SUMMARY_ROW_FIELDS = {
  electricCost: 'electricCost',
  electricUse: 'electric',
  gasCost: 'gasCost',
  gasUse: 'gas',
  zip: 'zip',
  division: 'division',
  sqft: 'propertySize',
  propertyType: 'propertyType',
  ownership: 'ownership',
  accounts: 'propertyType',
  equipment: 'propertyType',
};

/**
 * Which header a whole-portfolio fill should write into.
 *
 * Three cases, in order:
 *   a column is already mapped to the field  → write into that one, so the
 *     fill moves the value the page is actually reading rather than adding
 *     a second column that competes with it
 *   the file already has a column by the preferred name → claim it, even
 *     though nothing is mapped to it (a header the import kept but the
 *     detector didn't place)
 *   neither → create the preferred name
 *
 * `created` says the file has no such column yet, which is what the
 * confirm prompt needs to say out loud: this adds a column to their data.
 *
 *   { header, created }
 */
export function fillHeaderFor(mappedHeader, headers, preferredHeader) {
  const present = new Set((headers || []).filter(h => typeof h === 'string' && h !== ''));
  const mapped = typeof mappedHeader === 'string' ? mappedHeader.trim() : '';
  if (mapped && present.has(mapped)) return { header: mapped, created: false };
  const preferred = String(preferredHeader || '').trim();
  if (!preferred) return { header: '', created: false };
  return { header: preferred, created: !present.has(preferred) };
}

/**
 * The confirm prompt for a whole-portfolio fill — said in one place so the
 * two consequences that are easy to miss are always said: how many sites
 * it touches, and whether it is adding a column to their file.
 */
export function describeColumnFill({ label, value, count, header, created }) {
  const sites = `${count.toLocaleString()} site${count === 1 ? '' : 's'}`;
  return created
    ? `Add a “${header}” column to your uploaded sites and set it to “${value}” on all ${sites}?`
    : `Set ${label || header} to “${value}” on all ${sites}, replacing whatever the “${header}” column holds now?`;
}

const isBlank = (v) => v === null || v === undefined || String(v).trim() === '';

/**
 * One value written into one column on a chosen set of sites: every site,
 * one division, or a handful picked by hand.
 *
 *   targets    row objects (identity, as in applySiteColumnEdit)
 *   onlyBlank  leave a site that already has a value alone, so "fill the
 *              gaps" never overwrites a figure off the upload
 *   created    the column is new; every row outside the targets gets it
 *              blank, because the page reads its headers off the first row
 *              and a column missing there is a column the reload never sees
 *
 *   { rows, changed, skipped }
 */
export function applyColumnFill(sitesData, targets, header, value, { onlyBlank = false, created = false } = {}) {
  const rows = Array.isArray(sitesData) ? sitesData : [];
  const set = targets instanceof Set ? targets : new Set(targets || []);
  if (!header || set.size === 0) return { rows, changed: 0, skipped: 0 };
  let changed = 0;
  let skipped = 0;
  const next = rows.map(row => {
    if (!set.has(row)) {
      return created && row && !(header in row) ? { ...row, [header]: '' } : row;
    }
    const current = row?.[header];
    if ((onlyBlank && !isBlank(current)) || String(current ?? '').trim() === String(value ?? '').trim()) {
      skipped += 1;
      return created && row && !(header in row) ? { ...row, [header]: '' } : row;
    }
    changed += 1;
    return { ...row, [header]: value };
  });
  return { rows: changed > 0 ? next : rows, changed, skipped };
}
