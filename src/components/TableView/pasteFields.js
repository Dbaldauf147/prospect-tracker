// Field vocabulary + parsing shared by the two Table View paste flows:
// "Paste from Excel" (PasteAddModal) and the bulk add behind the "+ Add"
// button (BulkAddModal). Both map pasted columns onto the same prospect
// fields, so the destination list, the header auto-mapping and the
// per-field typing live here rather than in either modal.

// Destination prospect fields offered by the mapping dropdowns. Labels
// match the Table View column headers; aliases cover the header
// spellings seen in the Google Sheet / Excel exports (same set as the
// Upload Excel HEADER_MAP) so columns auto-map on paste.
export const FIELDS = [
  { key: 'company', label: 'Company', aliases: ['account', 'account name', 'client', 'client name'] },
  { key: 'cdm', label: 'CDM', aliases: ['salesperson', 'sales rep', 'account owner'] },
  { key: 'status', label: 'Status', aliases: [] },
  { key: 'type', label: 'Type', aliases: ['account type'] },
  { key: 'geography', label: 'Geography', aliases: ['geo', 'region'] },
  { key: 'publicPrivate', label: 'Pub/Priv', aliases: ['public/private', 'public/ private', 'public private'] },
  { key: 'assetTypes', label: 'Asset Types', type: 'list', aliases: ['asset type'] },
  { key: 'peAum', label: 'PE AUM', type: 'number', aliases: ['pe aum', 'pe aum (billions)'] },
  { key: 'reAum', label: 'RE AUM', type: 'number', aliases: ['re aum', 're aum (billions)'] },
  { key: 'numberOfSites', label: 'Sites', type: 'number', aliases: ['number of sites', '# sites'] },
  { key: 'revenue', label: 'Revenue', aliases: [] },
  { key: 'rank', label: 'Rank', aliases: [] },
  { key: 'tier', label: 'Tier', aliases: [] },
  { key: 'hqRegion', label: 'HQ Region', aliases: ['hq', 'hq location', 'headquarters', 'head office'] },
  { key: 'frameworks', label: 'Frameworks', type: 'frameworks', aliases: ['framework'] },
  { key: 'strategies', label: 'Strategies', type: 'list', aliases: ['strategy', 'pe strategy', 'pe strategies', 'investment strategy', 'investment strategies'] },
  { key: 'notes', label: 'Notes', aliases: [] },
  { key: 'website', label: 'Website', aliases: ['url', 'web site'] },
  { key: 'emailDomain', label: 'Email Domain', aliases: ['domain'] },
  { key: 'bfoCompanyName', label: 'BFO Company Name', aliases: [] },
  { key: 'peOwner', label: 'PE Owner', aliases: ['pe owner (if portfolio co)', 'pe owner/parent company', 'pe owner / parent company', 'parent company'] },
];

export const VALID_FRAMEWORKS = new Set(['RECA', 'CSRD', 'CDP', 'GRESB', 'SBT', 'Ecovadis', 'UN PRI', 'CA SB', 'NZAM']);

export function parseNumber(val) {
  if (!val || val === 'Missing Data') return null;
  const n = parseFloat(String(val).replace(/[,$]/g, ''));
  return isNaN(n) ? null : n;
}

// Header text -> field key, or '' when nothing matches.
export function autoMap(srcHeader) {
  const lower = String(srcHeader || '').trim().toLowerCase();
  if (!lower) return '';
  const hit = FIELDS.find(f =>
    f.key.toLowerCase() === lower ||
    f.label.toLowerCase() === lower ||
    f.aliases.includes(lower)
  );
  return hit ? hit.key : '';
}

// Delimited parser for the Excel / Google Sheets clipboard format:
// cells with newlines/delimiters/quotes arrive wrapped in double
// quotes, with internal quotes doubled. A naive line.split('\n') would
// tear quoted multi-line cells in half. Excel copies as tab-separated;
// a plain CSV paste (no tabs on the first line) falls back to commas
// unless the caller forces a delimiter.
export function parseDelimitedRows(text, forcedDelim) {
  const s = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const firstLine = s.slice(0, s.indexOf('\n') === -1 ? s.length : s.indexOf('\n'));
  const delim = forcedDelim || (firstLine.includes('\t') ? '\t' : ',');
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;
  let cellStarted = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') { cell += '"'; i++; continue; }
        inQuotes = false;
        continue;
      }
      cell += ch;
      continue;
    }
    if (ch === '"' && !cellStarted) { inQuotes = true; cellStarted = true; continue; }
    if (ch === delim) { row.push(cell); cell = ''; cellStarted = false; continue; }
    if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; cellStarted = false; continue; }
    cell += ch;
    cellStarted = true;
  }
  if (cell.length > 0 || row.length > 0) { row.push(cell); rows.push(row); }
  while (rows.length > 0 && rows[rows.length - 1].every(c => c === '')) rows.pop();
  return rows;
}

// Convert one pasted row into a prospect object. `keys` is index-aligned
// with the cells: the destination field for that column, or '' to skip
// it. Blank cells are left out entirely so they can't blank a default.
export function cellsToProspect(cells, keys) {
  const record = {};
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    if (!key) continue;
    const val = cells[i] != null ? String(cells[i]).trim() : '';
    if (!val) continue;
    const field = FIELDS.find(f => f.key === key);
    if (field?.type === 'list') {
      record[key] = val.split(',').map(t => t.trim()).filter(Boolean);
    } else if (field?.type === 'frameworks') {
      record[key] = val.split(',').map(t => t.trim()).filter(t => VALID_FRAMEWORKS.has(t));
    } else if (field?.type === 'number') {
      const n = parseNumber(val);
      if (n != null) record[key] = n;
    } else {
      record[key] = val;
    }
  }
  return record;
}
