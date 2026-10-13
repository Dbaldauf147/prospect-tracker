// The company size numbers the My Accounts "Company Data" subtab tracks:
// which accounts have them, an export of the ones that don't, and a paste
// that writes the filled-in numbers back onto the company records.
//
// The same fields, under the same names, as the company popup's Scale
// section. Pure, so the paste rules can be pinned without a browser
// (scripts/companyDataFields.test.mjs).

export const COMPANY_DATA_FIELDS = [
  { key: 'numberOfSites', label: 'Sites', aliases: ['sites', 'site count', '# sites', 'number of sites', 'numberofsites'] },
  { key: 'numberOfAccounts', label: 'Utility Accounts', aliases: ['utility accounts', 'accounts', 'account count', '# accounts', 'utility account count', 'number of accounts', 'numberofaccounts'] },
  { key: 'numberOfMeters', label: 'Meters', aliases: ['meters', 'meter count', '# meters', 'number of meters', 'numberofmeters'] },
  { key: 'equipmentCount', label: 'Equipment', aliases: ['equipment', 'equipment count', '# equipment', 'equipmentcount'] },
  { key: 'annualMwh', label: 'Electric MWh', aliases: ['electric mwh', 'mwh', 'annual mwh', 'electricity mwh', 'annualmwh'] },
];

// A value counts as there when it is a real number. 0 is an answer (a
// company with no meters of its own); blank, null and junk are not.
export function hasValue(v) {
  if (v === null || v === undefined || v === '') return false;
  const n = Number(v);
  return Number.isFinite(n);
}

export function missingFields(record, fields = COMPANY_DATA_FIELDS) {
  return fields.filter(f => !hasValue(record?.[f.key])).map(f => f.key);
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
//   updates:   [{ id, company, patch: { key: number }, changes: [{ key, from, to }] }],
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
      const label = fields.find(f => f.key === key)?.label || key;
      const raw = row[col];
      const value = parseCount(raw);
      if (value === null) continue;
      if (Number.isNaN(value)) { out.invalid.push({ company: rec.company, label, value: String(raw).trim() }); continue; }
      const from = hasValue(rec[key]) ? Number(rec[key]) : null;
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
