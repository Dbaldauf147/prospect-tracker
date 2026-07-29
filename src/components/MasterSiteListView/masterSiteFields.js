// Field model shared by the Master Site List view + its import/export
// with the Utility Lookup page. The eight visible/editable columns map
// 1:1 to the headers the user asked for.

export const MASTER_FIELDS = [
  { key: 'company',      label: 'Company' },
  { key: 'propertyName', label: 'Property Name' },
  { key: 'subsector',    label: 'Subsector' },
  { key: 'country',      label: 'Country' },
  { key: 'address',      label: 'Address' },
  { key: 'city',         label: 'City' },
  { key: 'state',        label: 'State' },
  { key: 'zip',          label: 'Zip' },
];

// Canonical header text written when EXPORTING to the Utility Lookup
// page (or to Excel). Utility Lookup auto-detects its columns from
// header text, so these names round-trip cleanly back here.
export const CANONICAL_HEADERS = MASTER_FIELDS.map(f => f.label);

export function emptyRow() {
  const r = {};
  for (const f of MASTER_FIELDS) r[f.key] = '';
  return r;
}

// Pick the first header matching any of the ordered patterns.
function detectColumn(headers, patterns) {
  for (const pat of patterns) {
    const hit = headers.find(h => pat.test(String(h)));
    if (hit) return hit;
  }
  return '';
}

// Map an arbitrary list of upload/Utility-Lookup headers onto our eight
// fields. Mirrors the detection SitesView uses so the two pages agree on
// which column is the company, site name, zip, etc.
export function detectMasterMapping(headers) {
  if (!headers?.length) return {};
  return {
    company: detectColumn(headers, [/^company$/i, /company/i, /portfolio/i, /parent/i, /owner/i, /account/i]),
    propertyName: detectColumn(headers, [/^property\s*name$/i, /property\s*name/i, /^site\s*name$/i, /site\s*name/i, /\b(site|property|location|facility|building)\b/i, /^name$/i]),
    subsector: detectColumn(headers, [/^sub-?sector$/i, /sub-?sector/i, /\bsector\b/i, /\bsegment\b/i, /property\s*type/i, /asset\s*type/i, /\bindustry\b/i]),
    country: detectColumn(headers, [/^country$/i, /\bcountry\b/i, /\bnation\b/i]),
    address: detectColumn(headers, [/^address$/i, /^street\s*address$/i, /street/i, /\baddress\b/i]),
    city: detectColumn(headers, [/^city$/i, /^town$/i, /^municipality$/i, /\bcity\b/i]),
    state: detectColumn(headers, [/^state$/i, /^province$/i, /^state\s*\/\s*province$/i, /\bstate\b/i, /\bregion\b/i]),
    zip: detectColumn(headers, [/^zip\s*code$/i, /^postal\s*code$/i, /^zip$/i, /zip/i, /postal/i]),
  };
}

// Turn a raw row (keyed by arbitrary headers) into a canonical master
// row using a field→header mapping.
export function rowFromMapping(raw, mapping) {
  const out = emptyRow();
  for (const f of MASTER_FIELDS) {
    const src = mapping[f.key];
    if (src && raw[src] != null) out[f.key] = String(raw[src]).trim();
  }
  return out;
}

// Stable identity for dedupe — company + property name + zip, lowercased.
export function rowKey(row) {
  return [row.company, row.propertyName, row.zip]
    .map(v => String(v || '').trim().toLowerCase())
    .join('|');
}

export function isRowEmpty(row) {
  return MASTER_FIELDS.every(f => !String(row[f.key] || '').trim());
}
