// Helpers for the Building Compliance Screening subtab. The dataset —
// whether the bundled default or a user-uploaded workbook — is reduced to
// a compact { compCols, profiles, index } shape:
//   - compCols: ordered list of the non-identity "output" columns whose
//     values represent the compliance requirements that may apply.
//   - profiles: de-duplicated arrays of { column: value } (only the
//     non-empty output cells). Thousands of cities share a handful of
//     policies, so this collapses ~20k rows to a few dozen profiles.
//   - index: normalized "city + state" key -> profile position.

// Identity columns describe *which* place a row is, not a requirement, so
// they're excluded from the "which columns apply" output. Column A (the
// concat key) is always excluded as well.
const IDENTITY_COLS = new Set([
  'concat', 'government id', 'city', 'state', 'state abbreviation',
  'country', 'master city',
]);

export function normKey(s) {
  return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

const headerIs = (h, re) => re.test(String(h || '').trim());

// Deadline columns sometimes arrive as raw Excel date serials (numbers)
// rather than formatted dates. Convert those to YYYY-MM-DD so an uploaded
// workbook reads the same as the bundled list. Excel's day 0 is
// 1899-12-30 (which already absorbs the 1900 leap-year quirk).
const EXCEL_EPOCH = Date.UTC(1899, 11, 30);
function formatCellValue(col, value) {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (
    /deadline/i.test(String(col)) &&
    typeof value === 'number' &&
    value >= 20000 && value <= 60000
  ) {
    return new Date(EXCEL_EPOCH + value * 86400000).toISOString().slice(0, 10);
  }
  return String(value).trim();
}

// Turn parsed { rows, headers } (from parseBestSheet) into the compact
// dataset shape. `rows` are objects keyed by header; `headers` is ordered.
export function buildScreeningDataset(rows, headers) {
  const keyCol = headers[0];
  const compCols = headers.filter(
    (h, i) => i > 0 && h && !IDENTITY_COLS.has(String(h).toLowerCase().trim()),
  );
  const cityCol = headers.find(h => headerIs(h, /^city$/i));
  const abbrCol = headers.find(h => headerIs(h, /state abbrev/i));
  const stateCol = headers.find(h => headerIs(h, /^state$/i));

  const profiles = [];
  const profileKeys = new Map();
  const index = {};

  const cell = (row, col) => {
    if (!col) return '';
    return formatCellValue(col, row[col]);
  };

  for (const row of rows) {
    const key = cell(row, keyCol);
    if (!key) continue;
    const comp = {};
    for (const c of compCols) {
      const v = cell(row, c);
      if (v !== '') comp[c] = v;
    }
    if (Object.keys(comp).length === 0) continue;

    const sig = JSON.stringify(comp);
    let pid = profileKeys.get(sig);
    if (pid == null) {
      pid = profiles.length;
      profiles.push(comp);
      profileKeys.set(sig, pid);
    }

    const city = cell(row, cityCol);
    const abbr = cell(row, abbrCol);
    const state = cell(row, stateCol);
    const keys = new Set([
      normKey(key),
      city && abbr ? normKey(city + abbr) : '',
      city && state ? normKey(city + state) : '',
    ]);
    for (const k of keys) {
      if (k && index[k] == null) index[k] = pid;
    }
  }

  return { compCols, profiles, index };
}

// Look a city + state pair up against a dataset. Returns the ordered list
// of applicable { col, value } pairs, or null when nothing matches.
export function screenCityState(dataset, city, state) {
  if (!dataset) return null;
  const c = String(city || '').trim();
  const s = String(state || '').trim();
  if (!c && !s) return null;

  const candidates = [normKey(c + s), s ? '' : normKey(c)].filter(Boolean);
  let pid = null;
  for (const k of candidates) {
    if (dataset.index[k] != null) { pid = dataset.index[k]; break; }
  }
  if (pid == null) return null;

  const profile = dataset.profiles[pid] || {};
  const applied = (dataset.compCols || [])
    .filter(col => profile[col] != null && profile[col] !== '')
    .map(col => ({ col, value: profile[col] }));
  return applied;
}
