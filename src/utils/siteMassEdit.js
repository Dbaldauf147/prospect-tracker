// Setting one column across many sites at once, on the Utility Lookup
// page.
//
// The sites table is an uploaded spreadsheet: everything derived on that
// page — the utility match, the rate, the cost estimate, the compliance
// screen — is computed from the columns of the file. So the honest place
// to fix a portfolio-wide gap is the source column itself. Filling in
// "Ownership = Owned" for sixty sites by re-editing the spreadsheet and
// re-uploading loses every per-row decision made on the page since; doing
// it one cell at a time isn't offered at all.
//
// This writes the value into the uploaded rows, which is what the rest of
// the page reads. Nothing here knows about React or IndexedDB: rows in,
// rows out, so what the edit does to the data can be tested without a
// browser.
//
// Two things are deliberately NOT editable:
//
//   The site name column — it's the row's identity on this page (blank
//     names are what marks a junk row), and "set every selected site's
//     name to the same thing" is not an edit anyone means to make.
//
//   Derived columns — utility, ISO, rate, cost, market. They are
//     computed from the source columns on every render, so a write there
//     would be overwritten by the next recompute. Editing the column the
//     value is derived FROM is the way to move them, and that is what
//     this offers.

// Extension included so this resolves under plain Node for the tests.
import { PROPERTY_TYPE_OPTIONS } from '../data/propertyTypeEstimates.js';

/**
 * The mapped site fields, in the order the picker offers them.
 *
 * `key` matches the keys of the page's column mapping (the same names
 * the upload's mapping modal uses), so a field can be resolved to
 * whichever uploaded header currently drives it.
 *
 * `options` is a closed list where the page only understands a closed
 * list — a free-typed "Owned (mostly)" normalizes to nothing and the
 * building-compliance scope silently stops counting the site. Where the
 * value is genuinely free text (a supplier, a contract name), there are
 * no options and the input stays a text box.
 */
export const SITE_EDIT_FIELDS = [
  { key: 'companyName', label: 'Company Name' },
  { key: 'division', label: 'Division/Portfolio Company' },
  { key: 'address', label: 'Address' },
  { key: 'city', label: 'City' },
  { key: 'state', label: 'State / Province' },
  { key: 'zip', label: 'Zip / Postal Code' },
  { key: 'country', label: 'Country' },
  { key: 'propertyType', label: 'Property Type', options: PROPERTY_TYPE_OPTIONS },
  {
    key: 'segment',
    label: 'Segment (Commercial / Industrial)',
    // What normalizeSegment folds onto. Industrial sites price off the
    // state industrial rate; everything else uses commercial.
    options: ['Commercial', 'Industrial'],
  },
  { key: 'ownership', label: 'Ownership', options: ['Owned', 'Leased'] },
  { key: 'siteDescription', label: 'Site Description' },
  { key: 'propertySize', label: 'Size (ft²)', type: 'number' },
  { key: 'electric', label: 'Annual Electric Consumption', type: 'number' },
  { key: 'electricUom', label: 'Electric UoM', options: ['kWh', 'MWh', 'GWh'] },
  { key: 'gas', label: 'Annual Gas Consumption', type: 'number' },
  { key: 'gasUom', label: 'Gas UoM', options: ['therms', 'Dth', 'MMBtu', 'Mcf', 'Ccf', 'BTU'] },
  { key: 'electricCost', label: 'Annual Electric Cost', type: 'number' },
  { key: 'gasCost', label: 'Annual Gas Cost', type: 'number' },
  { key: 'electricSupplier', label: 'Electric Supplier' },
  { key: 'gasSupplier', label: 'Gas Supplier' },
  { key: 'electricStart', label: 'Electric Contract Start' },
  { key: 'electricEnd', label: 'Electric Contract End' },
  { key: 'electricContractPrice', label: 'Electric Contract Price', type: 'number' },
  { key: 'electricContractName', label: 'Electric Contract Name' },
  { key: 'electricProductType', label: 'Electric Product Type' },
  { key: 'gasStart', label: 'Gas Contract Start' },
  { key: 'gasEnd', label: 'Gas Contract End' },
  { key: 'gasContractPrice', label: 'Gas Contract Price', type: 'number' },
  { key: 'gasContractName', label: 'Gas Contract Name' },
  { key: 'gasProductType', label: 'Gas Product Type' },
];

/**
 * The columns of this upload that can be mass-edited, in picker order.
 *
 * Every entry is a real header in the file — this never invents a
 * column, because a header the upload doesn't have isn't mapped to
 * anything and the page would read the new values as an unmapped
 * pass-through column.
 *
 * Mapped fields come first under their page label ("Property Type"),
 * carrying the header they actually write to so the user can see where
 * the value is going. Unmapped columns follow in file order under their
 * own header — they're pass-through data, but they're still the user's
 * data and still worth being able to fix in bulk.
 *
 *   headers  — Object.keys of an uploaded row
 *   mapping  — { fieldKey: header }, the page's active column mapping
 *   skip     — headers to leave out (the site name column)
 *
 *   [{ header, label, sub, type, options, mapped }]
 */
export function siteEditableColumns(headers, mapping = {}, skip = []) {
  const present = new Set((headers || []).filter(h => typeof h === 'string' && h !== ''));
  const skipped = new Set((skip || []).filter(Boolean));
  const out = [];
  const claimed = new Set();

  for (const field of SITE_EDIT_FIELDS) {
    const header = mapping?.[field.key];
    if (!header || !present.has(header) || skipped.has(header) || claimed.has(header)) continue;
    claimed.add(header);
    out.push({
      header,
      label: field.label,
      // The header is shown beside the label rather than instead of it:
      // "Property Type" is what the user sees on the table, and the
      // column it writes to is what they'd look for in the spreadsheet.
      sub: header === field.label ? '' : header,
      type: field.type || 'text',
      options: field.options || null,
      mapped: true,
    });
  }

  for (const header of headers || []) {
    if (!present.has(header) || skipped.has(header) || claimed.has(header)) continue;
    claimed.add(header);
    out.push({ header, label: header, sub: '', type: 'text', options: null, mapped: false });
  }

  return out;
}

/**
 * A typed value for a column, or an error explaining why there isn't one.
 *
 * Blank is always allowed and always means blank — clearing a column
 * across a selection is a real edit, and the one this is most often
 * used for after a bad import.
 *
 *   { ok: true, value } | { ok: false, error }
 */
export function coerceSiteValue(column, raw) {
  const text = String(raw ?? '').trim();
  if (!text) return { ok: true, value: '' };
  if (column?.type === 'number') {
    // Written the way a spreadsheet writes it: "1,250,000" and "$18,400"
    // are what gets pasted in, and rejecting them would be pedantry
    // about the clipboard rather than about the number.
    const cleaned = text.replace(/[$,\s]/g, '');
    const n = Number(cleaned);
    if (!Number.isFinite(n)) return { ok: false, error: `“${text}” is not a number.` };
    return { ok: true, value: n };
  }
  return { ok: true, value: text };
}

const sameValue = (a, b) => String(a ?? '').trim() === String(b ?? '').trim();

/**
 * One column set to one value across the chosen rows.
 *
 * `targets` holds the row objects themselves, not indexes: the page
 * filters and re-sorts its rows several times over between the uploaded
 * array and what's on screen, and an index that means one row in the
 * table can mean a different one in the file. Identity can't drift.
 *
 * Rows outside the selection come back untouched — the same object, so
 * a consumer diffing by reference can see exactly what moved.
 *
 *   { rows, changed, skipped }
 *
 * `changed` counts rows whose value actually moved; `skipped` counts
 * selected rows that already held it. A "changed 0 of 12" is worth
 * saying — it means the edit did nothing, which is a different outcome
 * from an edit that failed.
 */
export function applySiteColumnEdit(sitesData, targets, header, value) {
  const rows = Array.isArray(sitesData) ? sitesData : [];
  const set = targets instanceof Set ? targets : new Set(targets || []);
  if (!header || set.size === 0) return { rows, changed: 0, skipped: 0 };

  let changed = 0;
  let skipped = 0;
  const next = rows.map(row => {
    if (!set.has(row)) return row;
    if (sameValue(row?.[header], value)) { skipped += 1; return row; }
    changed += 1;
    return { ...row, [header]: value };
  });

  // Nothing moved: hand back the original array so React state doesn't
  // churn and the page doesn't re-derive a portfolio's worth of rows to
  // arrive back where it started.
  return { rows: changed > 0 ? next : rows, changed, skipped };
}

/** "Ownership → Owned on 12 sites" — the confirm prompt, in one place. */
export function describeSiteEdit(column, value, count) {
  const shown = String(value ?? '').trim() === '' ? '(blank)' : `“${value}”`;
  const where = column?.sub ? `${column.label} (column “${column.sub}”)` : column?.label;
  return `Set ${where} to ${shown} on ${count} selected site${count === 1 ? '' : 's'}?`;
}
