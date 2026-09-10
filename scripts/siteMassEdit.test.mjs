// Assertion tests for the Utility Lookup page's mass column edit. Plain
// Node — no test framework (the project has none). Run:
//   node scripts/siteMassEdit.test.mjs
//
// The same write also backs typing into a single cell of the table, so
// what is guarded here covers both: the mass bar and the cell editor
// resolve a column through the same functions and write through the same
// one.
//
// The edit writes into the uploaded site rows, which every derived
// number on that page is computed from. So the cases that matter are the
// ones about not touching what wasn't selected, and about the value
// arriving in the shape the rest of the page reads (a number as a
// number, a closed-list value spelled the way the normalizers expect).
import {
  SITE_EDIT_FIELDS, siteEditableColumns, coerceSiteValue, applySiteColumnEdit, describeSiteEdit,
  siteCellEditors, describeSiteCellEdit, SITE_CELL_EDIT_FIELDS,
} from '../src/utils/siteMassEdit.js';
import { normalizeSegment, normalizeElectricUom, normalizeGasUom } from '../src/utils/utilityRates.js';
import { PROPERTY_TYPE_OPTIONS } from '../src/data/propertyTypeEstimates.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}
function ok(value, name) { eq(!!value, true, name); }

// A file as it lands after import: only the mapped columns survive, under
// whatever headers the source spreadsheet used.
const HEADERS = ['Facility', 'Building Type', 'Postal Code', 'Annual kWh', 'Internal Ref'];
const MAPPING = {
  siteName: 'Facility',
  propertyType: 'Building Type',
  zip: 'Postal Code',
  electric: 'Annual kWh',
};

// --- which columns are offered -------------------------------------------
{
  const cols = siteEditableColumns(HEADERS, MAPPING, ['Facility']);
  eq(cols.map(c => c.header), ['Postal Code', 'Building Type', 'Annual kWh', 'Internal Ref'],
    'mapped fields lead in field order, unmapped columns follow in file order');
  eq(cols[0].label, 'Zip / Postal Code', 'a mapped column is offered under its page label');
  eq(cols[0].sub, 'Postal Code', 'the header it writes to travels with it');
  eq(cols.find(c => c.header === 'Internal Ref').label, 'Internal Ref',
    'an unmapped pass-through column is offered under its own header');
  eq(cols.find(c => c.header === 'Internal Ref').mapped, false, 'and is marked unmapped');
  ok(!cols.some(c => c.header === 'Facility'),
    'the site name column is never offered — it is the row’s identity, not data to overwrite');

  const typed = cols.find(c => c.header === 'Annual kWh');
  eq(typed.type, 'number', 'a consumption column takes a number');
  eq(cols.find(c => c.header === 'Building Type').options?.length, PROPERTY_TYPE_OPTIONS.length,
    'a closed-list field carries its options');
}

{
  // A mapping pointing at a header the file doesn't have (a stale
  // override after a re-upload) must not offer a column that isn't there.
  const cols = siteEditableColumns(['Site', 'City'], { siteName: 'Site', ownership: 'Owned/Leased', city: 'City' }, ['Site']);
  eq(cols.map(c => c.header), ['City'], 'a mapping pointing at a missing header offers nothing');
  eq(siteEditableColumns([], {}, []).length, 0, 'no upload, no columns');
}

{
  // One header mapped to two fields (the detector's patterns overlap on a
  // sparse file) must not produce the same column twice in the picker.
  const cols = siteEditableColumns(['Type'], { propertyType: 'Type', segment: 'Type' }, []);
  eq(cols.length, 1, 'a header mapped twice is offered once');
  eq(cols[0].label, 'Property Type', 'under the first field that claims it');
}

// --- the values the page can actually read -------------------------------
// Each closed list is checked against the normalizer that consumes it: an
// option the page can't place would leave the user picking from a menu
// that silently does nothing.
{
  const seg = SITE_EDIT_FIELDS.find(f => f.key === 'segment');
  for (const o of seg.options) eq(normalizeSegment(o), o.toLowerCase() === 'industrial' ? 'industrial' : 'commercial', `segment option "${o}" normalizes`);

  const eUom = SITE_EDIT_FIELDS.find(f => f.key === 'electricUom');
  for (const o of eUom.options) eq(normalizeElectricUom(o), o, `electric UoM option "${o}" normalizes to itself`);

  const gUom = SITE_EDIT_FIELDS.find(f => f.key === 'gasUom');
  for (const o of gUom.options) eq(normalizeGasUom(o), o, `gas UoM option "${o}" normalizes to itself`);

  const prop = SITE_EDIT_FIELDS.find(f => f.key === 'propertyType');
  ok(prop.options.every(o => PROPERTY_TYPE_OPTIONS.includes(o)),
    'every property type offered is one the consumption estimates know');
}

// --- typing the value ----------------------------------------------------
{
  const num = { type: 'number' };
  eq(coerceSiteValue(num, '1,250,000'), { ok: true, value: 1250000 }, 'a pasted thousands separator is a number');
  eq(coerceSiteValue(num, '$18,400'), { ok: true, value: 18400 }, 'a pasted dollar amount is a number');
  eq(coerceSiteValue(num, '  42 '), { ok: true, value: 42 }, 'whitespace is trimmed off a number');
  eq(coerceSiteValue(num, 'about 40k').ok, false, 'a number that is not a number is refused');
  eq(coerceSiteValue(num, ''), { ok: true, value: '' }, 'blanking a number column is allowed');
  eq(coerceSiteValue({ type: 'text' }, '  Owned '), { ok: true, value: 'Owned' }, 'text is trimmed');
  eq(coerceSiteValue({ type: 'text' }, ''), { ok: true, value: '' }, 'blanking a text column is allowed');
}

// --- the edit itself -----------------------------------------------------
const file = () => ([
  { Facility: 'Plant 1', 'Building Type': 'Warehouse', 'Postal Code': '19104' },
  { Facility: 'Plant 2', 'Building Type': '', 'Postal Code': '30303' },
  { Facility: 'Plant 3', 'Building Type': '', 'Postal Code': '60601' },
]);

{
  const rows = file();
  const targets = new Set([rows[1], rows[2]]);
  const { rows: next, changed, skipped } = applySiteColumnEdit(rows, targets, 'Building Type', 'Office');
  eq(changed, 2, 'both selected rows changed');
  eq(skipped, 0, 'neither already held the value');
  eq(next.map(r => r['Building Type']), ['Warehouse', 'Office', 'Office'], 'only the selected rows moved');
  ok(next[0] === rows[0], 'an unselected row comes back as the same object, not a copy');
  ok(next[1] !== rows[1], 'an edited row is a new object, so React sees the change');
  eq(rows[1]['Building Type'], '', 'the original array is not mutated');
}

{
  // Re-applying the same value is not a change — the page shouldn't
  // report "12 sites updated" when it updated nothing.
  const rows = file();
  const { rows: next, changed, skipped } = applySiteColumnEdit(rows, new Set([rows[0]]), 'Building Type', 'Warehouse');
  eq(changed, 0, 'a value that is already set is not a change');
  eq(skipped, 1, 'and is counted as skipped, so the page can say so');
  ok(next === rows, 'nothing moved, so the same array comes back');
}

{
  const rows = file();
  const { rows: next, changed } = applySiteColumnEdit(rows, new Set([rows[0], rows[1]]), 'Building Type', '');
  eq(changed, 1, 'blanking a column changes only the rows that held something');
  eq(next.map(r => r['Building Type']), ['', '', ''], 'and it does blank them');
}

{
  const rows = file();
  eq(applySiteColumnEdit(rows, new Set(), 'Building Type', 'Office').changed, 0, 'no selection edits nothing');
  ok(applySiteColumnEdit(rows, new Set([rows[0]]), '', 'Office').rows === rows, 'no column edits nothing');
  eq(applySiteColumnEdit(null, new Set(), 'x', 'y').rows, [], 'no upload is an empty list, not a crash');
}

{
  // A number lands as a number, not "1250000" — the consumption and cost
  // columns are read arithmetically further down the page.
  const rows = file();
  const { rows: next } = applySiteColumnEdit(rows, new Set([rows[0]]), 'Annual kWh', 1250000);
  eq(typeof next[0]['Annual kWh'], 'number', 'a numeric edit stays numeric in the row');
}

// --- what the user is asked to confirm -----------------------------------
{
  eq(describeSiteEdit({ label: 'Ownership', sub: 'Owned/Leased' }, 'Owned', 12),
    'Set Ownership (column “Owned/Leased”) to “Owned” on 12 selected sites?',
    'the prompt names the column being written, not just the field');
  eq(describeSiteEdit({ label: 'City', sub: '' }, '', 1),
    'Set City to (blank) on 1 selected site?',
    'blanking says so, and one site is singular');
}

// --- which of the TABLE's cells can be typed into -------------------------
//
// The mass bar picks a column by name; a cell has to be resolved the other
// way round — from the column key the table renders it under back to the
// uploaded header behind it. Most mapped fields are shown under the page's
// own label ("Property Type"), not the file's header, so without this the
// only editable cells would be the pass-through ones.
{
  const cols = siteEditableColumns(HEADERS, MAPPING, ['Facility']);
  const editors = siteCellEditors(cols, MAPPING);

  eq(editors.get('propertyType')?.header, 'Building Type',
    'a derived cell resolves to the column it is derived from');
  eq(editors.get('electric_consumption')?.header, 'Annual kWh',
    'so does the consumption cell, whatever unit the table shows it in');
  eq(editors.get('Internal Ref')?.header, 'Internal Ref',
    'a pass-through cell is its own column');
  // The header cell of a mapped column is editable too, under its header:
  // the table shows both, and typing into either means the same edit.
  eq(editors.get('Building Type')?.header, 'Building Type',
    'and a mapped column is still editable under its own header');

  ok(!editors.has('Facility'),
    'the site name column stays unavailable — the mass bar’s rule, not a second one');
  // Computed columns have no source cell. Offering one would take an edit
  // that the next render overwrites, which is worse than not offering it.
  for (const computed of ['electric_rate', 'electric_market', 'iso', 'totalCost', 'estAccounts', 'gac_opportunity']) {
    ok(!editors.has(computed), `the computed ${computed} cell is not editable`);
  }
  // The suppliers have their own editor, which matches what is typed
  // against the bundled supplier list — a plain text box beside it would
  // be a second, worse way to set the same thing.
  ok(!editors.has('electric_supplier'), 'the supplier cell keeps its own editor');

  eq(editors.get('propertyType')?.options?.length, PROPERTY_TYPE_OPTIONS.length,
    'a cell on a closed-list field offers the same list the mass bar does');
  eq(editors.get('electric_consumption')?.type, 'number',
    'and a numeric cell is still numeric');
}

{
  // A field the upload never mapped has nothing to write to, so its cell
  // is not editable — the table shows it derived from nothing.
  const cols = siteEditableColumns(['Facility', 'Building Type'], { siteName: 'Facility', propertyType: 'Building Type' }, ['Facility']);
  const editors = siteCellEditors(cols, { siteName: 'Facility', propertyType: 'Building Type' });
  ok(editors.has('propertyType'), 'the mapped field is editable');
  ok(!editors.has('ownership'), 'an unmapped field is not');
  eq(siteCellEditors([], {}).size, 0, 'no upload, no editable cells');
}

{
  // Every key in the map has to be a field the mass bar knows, or it
  // resolves to nothing and the cell is silently uneditable.
  const known = new Set(SITE_EDIT_FIELDS.map(f => f.key));
  for (const [columnKey, field] of Object.entries(SITE_CELL_EDIT_FIELDS)) {
    ok(known.has(field), `${columnKey} maps to a known field (${field})`);
  }
}

// --- what a cell's tooltip says -------------------------------------------
{
  eq(describeSiteCellEdit({ label: 'Property Type', sub: 'Building Type' }, 'Maple Grove'),
    'Property Type (column “Building Type”) on Maple Grove',
    'the tooltip names the column being written and the site it is on');
  eq(describeSiteCellEdit({ label: 'Internal Ref', sub: '' }, ''),
    'Internal Ref',
    'a pass-through column on an unnamed row is just the column');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
