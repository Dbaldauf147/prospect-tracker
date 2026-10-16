// The company data the My Accounts "Company Data" subtab tracks (the size
// numbers plus the ZoomInfo id / name and the company's website):
// which accounts have them, an export of the ones that don't, and a paste
// that writes the filled-in numbers back onto the company records.
//
// The number fields are the company popup's Scale section, under the same
// names; the text fields (type: 'text') are the same record keys Table View
// and the Zoom Info tab read and write. Pure, so the paste rules can be pinned without a browser
// (scripts/companyDataFields.test.mjs).

export const COMPANY_DATA_FIELDS = [
  { key: 'numberOfSites', label: 'Sites', aliases: ['sites', 'site count', '# sites', 'number of sites', 'numberofsites'] },
  { key: 'numberOfAccounts', label: 'Utility Accounts', aliases: ['utility accounts', 'accounts', 'account count', '# accounts', 'utility account count', 'number of accounts', 'numberofaccounts'] },
  { key: 'numberOfMeters', label: 'Meters', aliases: ['meters', 'meter count', '# meters', 'number of meters', 'numberofmeters'] },
  { key: 'equipmentCount', label: 'Equipment', aliases: ['equipment', 'equipment count', '# equipment', 'equipmentcount'] },
  { key: 'annualMwh', label: 'Electric MWh', aliases: ['electric mwh', 'mwh', 'annual mwh', 'electricity mwh', 'annualmwh'] },
  { key: 'zoomCompanyId', label: 'Zoom Company ID', type: 'text', aliases: ['zoom company id', 'zoom id', 'zoominfo company id', 'zoominfo id', 'zoomcompanyid'] },
  { key: 'zoomCompanyName', label: 'Zoom Company Name', type: 'text', aliases: ['zoom company name', 'zoom name', 'zoominfo company name', 'zoominfo name', 'zoomcompanyname'] },
  { key: 'website', label: 'Company URL', type: 'text', aliases: ['company url', 'url', 'website', 'company website', 'web site', 'homepage'] },
];

export const isTextField = (f) => f?.type === 'text';

// A value counts as there when it is a real number. 0 is an answer (a
// company with no meters of its own); blank, null and junk are not.
export function hasValue(v) {
  if (v === null || v === undefined || v === '') return false;
  const n = Number(v);
  return Number.isFinite(n);
}

// A text field is there when it has something other than spaces.
export function fieldHasValue(field, v) {
  if (isTextField(field)) return String(v ?? '').trim() !== '';
  return hasValue(v);
}

// The record's value for a field, normalised: a number, a trimmed string,
// or null when it isn't there.
export function fieldValue(field, v) {
  if (!fieldHasValue(field, v)) return null;
  return isTextField(field) ? String(v).trim() : Number(v);
}

// The ZoomInfo fields. A company excluded from ZoomInfo (the Exclude from
// ZoomInfo button on its popup) will never be searched there, so it isn't
// owed a Zoom id or name and a blank one isn't counted as missing.
export const ZOOM_FIELD_KEYS = new Set(['zoomCompanyId', 'zoomCompanyName']);

// A company with a Yes decision maker on every category of its By Category
// ladder (allDms) has nothing left to find in ZoomInfo, so it isn't owed a
// Zoom Company ID either. Its Zoom name still counts.

/** Whether a field isn't asked of this company at all (see ZOOM_FIELD_KEYS). */
export function fieldNotNeeded(field, { zoomExcluded = false, allDms = false } = {}) {
  if (zoomExcluded && ZOOM_FIELD_KEYS.has(field?.key)) return true;
  return !!allDms && field?.key === 'zoomCompanyId';
}

/** Why a field isn't needed, for the N/A cell's tooltip; '' when it is. */
export function fieldNotNeededReason(field, opts = {}) {
  if (!fieldNotNeeded(field, opts)) return '';
  return opts.zoomExcluded && ZOOM_FIELD_KEYS.has(field?.key)
    ? 'Not needed: the company is excluded from ZoomInfo'
    : 'Not needed: the company has a decision maker for every tag';
}

/** Whether a field is blank on the record and the company is owed it. */
export function fieldMissing(field, record, { zoomExcluded = false, allDms = false } = {}) {
  return !fieldNotNeeded(field, { zoomExcluded, allDms }) && !fieldHasValue(field, record?.[field.key]);
}

export function missingFields(record, fields = COMPANY_DATA_FIELDS, { zoomExcluded = false, allDms = false } = {}) {
  return fields.filter(f => fieldMissing(f, record, { zoomExcluded, allDms })).map(f => f.key);
}

// "10,000", " $1,200 ", "3.5" -> numbers. Blank -> null (nothing to write).
// Anything else -> NaN, which the paste reports rather than writing.
export function parseCount(raw) {
  const s = String(raw ?? '').replace(/[\s,$]/g, '');
  if (s === '' || s === '-') return null;
  if (!/^\d+(\.\d+)?$/.test(s)) return NaN;
  return Number(s);
}

const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

// Which column of a pasted header row is which: the company, the record
// id the export carries, and each field (by its label, its key or a
// common way of writing it).
export function mapHeaders(headers, fields = COMPANY_DATA_FIELDS) {
  const out = { company: -1, id: -1, fields: {} };
  headers.forEach((h, i) => {
    const n = norm(h);
    if (!n) return;
    if (out.id === -1 && (n === 'id' || n === 'record id' || n === 'company id')) { out.id = i; return; }
    if (out.company === -1 && (n === 'company' || n === 'company name' || n === 'account' || n === 'account name' || n === 'name')) { out.company = i; return; }
    for (const f of fields) {
      if (out.fields[f.key] !== undefined) continue;
      if (n === norm(f.label) || n === norm(f.key) || f.aliases.includes(n)) { out.fields[f.key] = i; return; }
    }
  });
  return out;
}

// A pasted cell for a field: text fields take the trimmed text (blank or a
// lone dash writes nothing), number fields go through parseCount.
export function parseFieldCell(field, raw) {
  if (!isTextField(field)) return parseCount(raw);
  const s = String(raw ?? '').trim();
  return s === '' || s === '-' ? null : s;
}

// Read a paste (tab-separated, as Excel copies it, with a header row) into
// the writes it asks for.
//
// `records` is the companies it may write to: [{ id, company, ...fields }].
// A row finds its company by the export's ID column first, then by name
// (case and spacing aside). A blank cell writes nothing. A cell that
// already matches the record writes nothing. A cell that would replace a
// number the company already has is only written when `overwrite` is on,
// and is reported either way, so a stale export can't quietly undo a
// newer edit.
//
// Returns {
//   updates:   [{ id, company, patch: { key: value }, changes: [{ key, from, to }] }],
//   skipped:   [{ company, key, from, to }]   would overwrite, overwrite off
//   unmatched: [company text]                 no record found
//   invalid:   [{ company, label, value }]    not a number
//   error:     '' | why nothing could be read
// }
export function planCompanyDataPaste(text, records, { overwrite = false, fields = COMPANY_DATA_FIELDS } = {}) {
  const empty = { updates: [], skipped: [], unmatched: [], invalid: [], error: '' };
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n').filter(l => l.trim());
  if (lines.length < 2) return { ...empty, error: 'Paste a header row and at least one row of data, copied straight from the exported sheet.' };
  const cells = lines.map(l => l.split('\t'));
  const map = mapHeaders(cells[0], fields);
  if (map.company === -1 && map.id === -1) return { ...empty, error: 'No Company column found in the header row.' };
  const fieldCols = Object.entries(map.fields);
  if (fieldCols.length === 0) return { ...empty, error: `No data columns found. The header row needs one of: ${fields.map(f => f.label).join(', ')}.` };

  const byId = new Map();
  const byName = new Map();
  for (const r of records || []) {
    if (r?.id) byId.set(String(r.id), r);
    const k = norm(r?.company);
    if (k && !byName.has(k)) byName.set(k, r);
  }

  const out = { ...empty, updates: [], skipped: [], unmatched: [], invalid: [] };
  const updatesById = new Map();
  for (const row of cells.slice(1)) {
    const companyText = map.company >= 0 ? String(row[map.company] || '').trim() : '';
    const idText = map.id >= 0 ? String(row[map.id] || '').trim() : '';
    const rec = (idText && byId.get(idText)) || (companyText && byName.get(norm(companyText))) || null;
    if (!rec) {
      if (companyText || idText) out.unmatched.push(companyText || idText);
      continue;
    }
    for (const [key, col] of fieldCols) {
      const field = fields.find(f => f.key === key);
      const label = field?.label || key;
      const raw = row[col];
      const value = parseFieldCell(field, raw);
      if (value === null) continue;
      if (Number.isNaN(value)) { out.invalid.push({ company: rec.company, label, value: String(raw).trim() }); continue; }
      const from = fieldValue(field, rec[key]);
      if (from === value) continue;
      if (from !== null && !overwrite) { out.skipped.push({ company: rec.company, key, label, from, to: value }); continue; }
      let u = updatesById.get(rec.id);
      if (!u) { u = { id: rec.id, company: rec.company, patch: {}, changes: [] }; updatesById.set(rec.id, u); out.updates.push(u); }
      u.patch[key] = value;
      u.changes.push({ key, label, from, to: value });
    }
  }
  return out;
}
