// Pure half of the Clients-tab field importer: header auto-mapping and the
// diff between a pasted sheet and the values the app currently holds.
//
// Kept out of the modal so the rules that decide what gets WRITTEN can be
// exercised directly. Two of them matter more than the rest:
//   • A blank cell means "leave this field alone", never "clear it".
//   • A row whose company matches no client is skipped, not guessed at.

import { normHeader, parseBooleanCell } from './parseTsv';
import { normClientName } from './clientIssues';

export const COMPANY = 'company';

// Destination fields, in the order the preview lists them. `kind` picks the
// cell parser; the modal maps `key` onto the store setter the Clients tab
// already uses, so an imported value takes the same path a typed one does.
export const IMPORT_FIELDS = [
  { key: 'manager', label: 'Client Manager', kind: 'text' },
  { key: 'status', label: 'Renewal Status', kind: 'text' },
  { key: 'notes', label: 'Notes', kind: 'text' },
  { key: 'inPerson', label: 'In Person Meeting', kind: 'bool' },
  { key: 'louisville', label: 'Invited to Louisville', kind: 'bool' },
  { key: 'untracked', label: "Don't Track", kind: 'bool' },
];

// Header aliases → destination key, covering what these columns get called
// in an exported sheet so a paste usually maps itself.
const ALIASES = {
  company: COMPANY, companyname: COMPANY, client: COMPANY, clientname: COMPANY,
  account: COMPANY, accountname: COMPANY, name: COMPANY,
  clientmanager: 'manager', manager: 'manager', cm: 'manager', accountmanager: 'manager',
  renewalstatus: 'status', status: 'status', clientstatus: 'status',
  notes: 'notes', note: 'notes', comment: 'notes', comments: 'notes',
  inperson: 'inPerson', inpersonmeeting: 'inPerson', metinperson: 'inPerson', met: 'inPerson',
  louisville: 'louisville', invitedtolouisville: 'louisville', invited: 'louisville',
  donttrack: 'untracked', dontrack: 'untracked', untracked: 'untracked',
  ignore: 'untracked', exclude: 'untracked',
};

export function autoMapHeader(header) {
  const n = normHeader(header);
  if (!n) return '';
  const exact = IMPORT_FIELDS.find(f => normHeader(f.label) === n);
  if (exact) return exact.key;
  return ALIASES[n] || '';
}

// Normalised company name → the spelling the app holds, so a row typed
// "  moodys corp " writes under the same key the Clients tab reads.
export function buildCompanyIndex(companies = []) {
  const m = new Map();
  for (const c of companies) {
    const k = normClientName(c);
    if (k && !m.has(k)) m.set(k, c);
  }
  return m;
}

/**
 * Work out what a mapped paste would change.
 *
 * @param headers   source header row
 * @param rows      source data rows (arrays of cells)
 * @param mapping   source header → destination key ('' / COMPANY / field key)
 * @param companies the client names to match against
 * @param current   {fieldKey: {normalizedCompany: value}} as held today
 * @returns null when no company column is mapped, otherwise
 *   { matched, unmatched, changing, perField, writes }
 */
export function buildImportPlan({ headers = [], rows = [], mapping = {}, companies = [], current = {} }) {
  const companyCol = Object.keys(mapping).find(k => mapping[k] === COMPANY);
  if (!companyCol) return null;
  const byNorm = buildCompanyIndex(companies);
  const ci = headers.indexOf(companyCol);
  // Resolve each mapped field to its column index once, not per row.
  const cols = IMPORT_FIELDS
    .map(f => {
      const src = Object.keys(mapping).find(k => mapping[k] === f.key);
      return src ? { field: f, idx: headers.indexOf(src) } : null;
    })
    .filter(c => c && c.idx >= 0);

  const matched = [], unmatched = [];
  for (const cells of rows) {
    const raw = String(cells[ci] == null ? '' : cells[ci]).trim();
    if (!raw) continue;                       // padding row from the sheet
    const company = byNorm.get(normClientName(raw));
    if (!company) { unmatched.push(raw); continue; }
    const key = normClientName(company);
    const changes = [];
    for (const { field, idx } of cols) {
      const cell = cells[idx];
      const held = (current[field.key] || {})[key];
      if (field.kind === 'bool') {
        const v = parseBooleanCell(cell);
        if (v === null) continue;             // blank / unrecognised: leave alone
        if (!!held === v) continue;
        changes.push({ field, value: v, was: !!held });
      } else {
        const v = String(cell == null ? '' : cell).trim();
        if (!v) continue;                     // blank: leave alone
        const was = String(held == null ? '' : held);
        if (was === v) continue;
        changes.push({ field, value: v, was });
      }
    }
    matched.push({ raw, company, changes });
  }

  const changing = matched.filter(r => r.changes.length);
  const perField = {};
  const writes = [];
  for (const row of changing) {
    for (const c of row.changes) {
      perField[c.field.label] = (perField[c.field.label] || 0) + 1;
      writes.push({ company: row.company, key: c.field.key, value: c.value });
    }
  }
  return { matched, unmatched, changing, perField, writes };
}
