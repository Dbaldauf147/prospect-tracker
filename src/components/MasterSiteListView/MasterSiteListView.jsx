import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { saveList, loadList, clearList } from '../../utils/uploadedListStore';
import { loadUtilityRates } from '../../utils/utilityRatesStore';
import { parseBestSheet } from '../../utils/xlsxParse';
import { lookupUtilityForZip } from '../../utils/utilityClassify';
import { lookupIsoForZip, backfillIso } from '../../utils/isoLookup';
import { buildCompanyIndex, hasMatchInIndex } from '../../utils/companyIndex';
import { Badge } from '../common/Badge';
import { userLsGet, userLsSet } from '../../utils/userLs';
import {
  MASTER_FIELDS,
  CANONICAL_HEADERS,
  emptyRow,
  detectMasterMapping,
  rowFromMapping,
  rowKey,
  isRowEmpty,
} from './masterSiteFields';
import { MASTER_SITE_LIST_KEY, UTILITY_SITES_KEY } from './siteListRename';
import styles from './MasterSiteListView.module.css';

// Master Site List lives in its own IDB list (mirrored to Firestore by
// uploadedListStore), separate from the Utility Lookup sites table. Both
// keys come from siteListRename, which rewrites these same rows when a
// company is renamed, so the two agree on which lists they're touching.
// Per-user UI preferences (column widths + hidden columns).
const WIDTHS_LS_KEY = 'master-site-list:col-widths';
const HIDDEN_LS_KEY = 'master-site-list:hidden-cols';
const SHOW_FILTERS_LS_KEY = 'master-site-list:show-filters';

const ALL = '__all__';

// Every togglable/resizable column, in display order. The eight editable
// fields plus the two derived (read-only) Utility Lookup columns. The "#"
// row-number and delete columns are fixed and not part of this list.
const COLUMNS = [
  ...MASTER_FIELDS.map(f => ({ key: f.key, label: f.label, kind: 'field' })),
  { key: 'iso', label: 'ISO / RTO', kind: 'iso', title: 'Wholesale electricity market (ISO/RTO) resolved from the ZIP via EPA eGRID subregions. A badge flags when the ZIP straddles markets (seam) or the subregion is ambiguous (verify).' },
  { key: '__utility__', label: 'Indicative Utility', kind: 'utility', title: 'Indicative electric utility pulled from the Utility Lookup zip table' },
  { key: '__status__', label: 'Status', kind: 'status', title: 'Regulated vs Deregulated, derived from the indicative utility' },
];

// Sensible starting widths (px) per column; anything missing uses 140.
const DEFAULT_WIDTHS = {
  company: 180, propertyName: 180, subsector: 130, country: 120,
  address: 220, city: 130, state: 90, zip: 90,
  iso: 130, __utility__: 200, __status__: 120,
};

// Badge colours for the low-confidence ISO cases.
const ISO_BADGE_COLOR = { seam: '#D97706', verify: '#7C3AED' };

// Stamp the stored ISO fields onto a row from its zip. Kept here so every
// create / edit / import path assigns ISO consistently (and idempotently).
function withIso(row) {
  return { ...row, ...lookupIsoForZip(row?.zip) };
}

// Display/sortable/filterable text for a column on a given row. Field
// columns read straight off the row; the three derived columns mirror
// what their cells render so sorting and filtering match the eye.
function isoText(row) {
  const info = row.iso_confidence ? { iso: row.iso ?? null } : lookupIsoForZip(row.zip);
  if (!info.iso) return '';
  return info.iso.startsWith('None') ? 'None' : info.iso;
}
function cellText(key, row, look) {
  if (key === 'iso') return isoText(row);
  if (key === '__utility__') return look.utility || '';
  if (key === '__status__') return look.status || '';
  return String(row[key] || '');
}

const MIN_COL_WIDTH = 60;

function colWidthOf(widths, key) {
  const w = widths[key];
  return Number.isFinite(w) ? w : (DEFAULT_WIDTHS[key] || 140);
}

function readJsonLs(key, fallback) {
  try {
    const raw = userLsGet(key);
    return raw ? (JSON.parse(raw) ?? fallback) : fallback;
  } catch { return fallback; }
}

// Split one line of pasted text into cells, honoring tabs first (the
// usual clipboard format out of Excel/Sheets) then falling back to a
// simple CSV split with basic quote handling.
function splitPasteLine(line) {
  if (line.includes('\t')) return line.split('\t');
  const out = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

// Parse pasted text into a padded 2-D grid of trimmed cells (one inner
// array per line, every row the same width). Blank lines are dropped.
function parsePasteCells(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim() !== '');
  const cells = lines.map(splitPasteLine);
  const width = cells.reduce((m, r) => Math.max(m, r.length), 0);
  return cells.map(r => {
    const c = r.map(x => String(x ?? '').trim());
    while (c.length < width) c.push('');
    return c;
  });
}

// Does the first pasted row read like a header (field names / common
// site-list column words) rather than data?
function looksLikeHeaderRow(firstCells) {
  return firstCells.some(c =>
    MASTER_FIELDS.some(f => f.label.toLowerCase() === c.toLowerCase()) ||
    /\b(company|property|address|city|state|zip|postal|country|sub-?sector|sector)\b/i.test(c));
}

// Column headers for the matcher: the real header row when present, else
// generic "Column 1…N" placeholders.
function headersFromCells(cells, hasHeader) {
  const width = cells[0]?.length || 0;
  return hasHeader
    ? cells[0].slice()
    : Array.from({ length: width }, (_, i) => `Column ${i + 1}`);
}

// Best-guess mapping of each master field → source column index (-1 when
// unmatched). With a header row we reuse the shared header detection;
// without one we fall back to positional order (Company, Property Name…).
function defaultMapping(headers, hasHeader) {
  const m = {};
  if (hasHeader) {
    const det = detectMasterMapping(headers);
    for (const f of MASTER_FIELDS) {
      const h = det[f.key];
      m[f.key] = h ? headers.indexOf(h) : -1;
    }
  } else {
    MASTER_FIELDS.forEach((f, i) => { m[f.key] = i < headers.length ? i : -1; });
  }
  return m;
}

// Build canonical master rows from the data rows + a field→column map.
function rowsFromMapping(dataRows, mapping) {
  return dataRows.map(cells => {
    const row = emptyRow();
    for (const f of MASTER_FIELDS) {
      const i = mapping[f.key];
      if (i != null && i >= 0 && cells[i] != null) row[f.key] = String(cells[i]).trim();
    }
    return row;
  }).filter(r => !isRowEmpty(r));
}

// One row in the "match unmapped companies" popup: an unmapped Master Site
// List company + a predictive input to pick the Table View company to rename
// its rows to. Match is enabled only once the typed value is an actual Table
// View company (picked from the shared datalist).
// One unmapped company + its Table View picker. The selection is staged
// (held by the parent), not applied on the spot — the parent's "Save &
// rename" button commits every pick at once. A green check marks a row
// whose typed text resolves to a real Table View company.
function UnmappedMatchRow({ name, count, value, canonical, onChange }) {
  return (
    <div className={styles.unmappedRow}>
      <div className={styles.unmappedName} title={name}>
        {name}<span className={styles.unmappedCount}> · {count} site{count === 1 ? '' : 's'}</span>
      </div>
      <span className={styles.unmappedArrow}>→</span>
      <input
        className={styles.unmappedInput}
        list="msl-tableview-companies"
        placeholder="Table View company…"
        value={value}
        onChange={e => onChange(name, e.target.value)}
      />
      <span
        className={canonical ? styles.unmappedCheckOn : styles.unmappedCheck}
        title={canonical ? `Will rename ${count} row${count === 1 ? '' : 's'} to “${canonical}”` : 'Pick a Table View company to stage this rename'}
        aria-label={canonical ? 'Selection ready' : 'No selection yet'}
      >{canonical ? '✓' : ''}</span>
    </div>
  );
}

// Company filter for the toolbar: a predictive-text box rather than a plain
// <select>, since the list runs to hundreds of companies and scrolling a
// native dropdown to find one is painful. Typing narrows to prefix matches
// first, then substring matches; ↑/↓ + Enter pick, Esc closes. "All
// companies" always heads the list so clearing the filter is one click.
function CompanyFilterCombo({ companies, counts, total, value, onChange }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const boxRef = useRef(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e) { if (!boxRef.current?.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return companies;
    const starts = [], includes = [];
    for (const c of companies) {
      const lower = c.toLowerCase();
      if (lower.startsWith(q)) starts.push(c);
      else if (lower.includes(q)) includes.push(c);
    }
    return [...starts, ...includes];
  }, [query, companies]);

  // Capped for render cost — the count line below says when there's more.
  const shown = useMemo(() => matches.slice(0, 50), [matches]);
  const options = useMemo(() => [ALL, ...shown], [shown]);

  // Keep the highlighted option in view during keyboard navigation.
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  function pick(name) {
    onChange(name);
    setQuery('');
    setOpen(false);
    inputRef.current?.blur();
  }

  function onKeyDown(e) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) { setOpen(true); return; }
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive(i => (i + step + options.length) % options.length);
    } else if (e.key === 'Enter') {
      if (!open) return;
      e.preventDefault();
      const choice = options[active];
      if (choice != null) pick(choice);
    } else if (e.key === 'Escape') {
      if (!open) return;
      e.preventDefault();
      setQuery('');
      setActive(0);
      setOpen(false);
    }
  }

  const selected = value !== ALL;

  return (
    <div className={styles.comboWrap} ref={boxRef}>
      <input
        ref={inputRef}
        className={selected ? styles.comboInputOn : styles.comboInput}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        aria-controls="msl-company-filter-list"
        autoComplete="off"
        // Closed, the box reads as the current filter; focused, it empties so
        // typing starts a fresh search with the active pick still in view as
        // the placeholder.
        value={open ? query : (selected ? value : '')}
        placeholder={selected ? value : `All companies (${total})`}
        title="Filter the list to one company: type to search"
        // The highlight resets alongside every query change rather than in an
        // effect, so the list and its selection never render out of step.
        onFocus={() => { setQuery(''); setActive(0); setOpen(true); }}
        onChange={e => { setQuery(e.target.value); setActive(0); setOpen(true); }}
        onKeyDown={onKeyDown}
      />
      {selected && !open && (
        <button
          type="button"
          className={styles.comboClear}
          title="Show all companies"
          aria-label="Clear company filter"
          onClick={() => pick(ALL)}
        >
          ×
        </button>
      )}
      {open && (
        <div className={styles.comboList} id="msl-company-filter-list" role="listbox" ref={listRef}>
          {options.map((name, i) => (
            <div
              key={name === ALL ? '__all__option' : name}
              role="option"
              aria-selected={name === value}
              data-active={i === active ? 'true' : undefined}
              className={i === active ? styles.comboOptionOn : styles.comboOption}
              // mousedown, not click: the input's blur would otherwise tear
              // the list down before the click lands.
              onMouseDown={e => { e.preventDefault(); pick(name); }}
              onMouseEnter={() => setActive(i)}
            >
              <span className={styles.comboOptionName}>
                {name === ALL ? 'All companies' : name}
              </span>
              <span className={styles.comboOptionCount}>
                {name === ALL ? total : (counts.get(name) || 0)}
              </span>
            </div>
          ))}
          {shown.length === 0 && (
            <div className={styles.comboEmpty}>No company matches “{query.trim()}”.</div>
          )}
          {matches.length > shown.length && (
            <div className={styles.comboEmpty}>
              Showing {shown.length} of {matches.length}: keep typing to narrow.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function MasterSiteListView({ prospects = [] }) {
  const [rows, setRows] = useState([]);
  const [zipMap, setZipMap] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [companyFilter, setCompanyFilter] = useState(ALL);
  const [showPaste, setShowPaste] = useState(false);
  const [pasteText, setPasteText] = useState('');
  // Column-matching popup: { cells, hasHeader, mapping } once text is parsed.
  const [matcher, setMatcher] = useState(null);
  const [busy, setBusy] = useState('');
  const [colWidths, setColWidths] = useState(() => readJsonLs(WIDTHS_LS_KEY, {}));
  const [hiddenCols, setHiddenCols] = useState(() => new Set(readJsonLs(HIDDEN_LS_KEY, [])));
  const [showColMenu, setShowColMenu] = useState(false);
  // Sort: { key, dir } while a column is sorted; key null = natural order.
  const [sort, setSort] = useState({ key: null, dir: 'asc' });
  // Per-column substring filters (keyed by column key) + a toggle for the
  // in-header filter input row.
  //
  // The row is on by default: a filter box you have to go find behind a
  // toolbar button isn't one you'll use, and every other table in the app
  // puts its per-column filters right under the headers. The toggle stays,
  // for when the extra header height is in the way, and it's remembered per
  // user like the widths and hidden columns.
  const [colFilters, setColFilters] = useState({});
  const [showFilters, setShowFilters] = useState(() => readJsonLs(SHOW_FILTERS_LS_KEY, true) !== false);
  // When on, show only sites whose company isn't found among the Table View
  // (prospects) companies — i.e. unmapped to the tracker.
  const [unmappedOnly, setUnmappedOnly] = useState(false);
  // Opens the popup that lists unmapped companies and lets you match each to
  // a Table View company (renaming its rows).
  const [showUnmapped, setShowUnmapped] = useState(false);
  // Staged unmapped→Table View picks, keyed by the unmapped company name.
  // Held here (not per-row) so the modal's "Save & rename" button can commit
  // every selection in one pass.
  const [matchPicks, setMatchPicks] = useState({});
  // Bulk-rename prompt: { oldName, newName, count } after a company edit that
  // leaves other rows still carrying the old name.
  const [bulkRename, setBulkRename] = useState(null);
  // Remembers the company value a cell held when focused, so a blur can tell
  // whether (and from what) the name actually changed.
  const companyEditRef = useRef(null);
  const fileInputRef = useRef(null);
  const colMenuRef = useRef(null);
  const resizeRef = useRef(null); // { key, startX, startW } during a drag
  const skipSave = useRef(true);

  // Persist column widths / hidden columns per user.
  useEffect(() => { userLsSet(WIDTHS_LS_KEY, JSON.stringify(colWidths)); }, [colWidths]);
  useEffect(() => { userLsSet(HIDDEN_LS_KEY, JSON.stringify([...hiddenCols])); }, [hiddenCols]);
  useEffect(() => { userLsSet(SHOW_FILTERS_LS_KEY, JSON.stringify(showFilters)); }, [showFilters]);

  // Close the Columns popover on outside click / Escape.
  useEffect(() => {
    if (!showColMenu) return;
    const onDown = (e) => { if (!colMenuRef.current?.contains(e.target)) setShowColMenu(false); };
    const onKey = (e) => { if (e.key === 'Escape') setShowColMenu(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [showColMenu]);

  // Column-resize drag: track the live pointer and widen/narrow the
  // column under the grabbed handle. Listeners live on document so the
  // drag keeps working even when the pointer leaves the header cell.
  useEffect(() => {
    function onMove(e) {
      const r = resizeRef.current;
      if (!r) return;
      const next = Math.max(MIN_COL_WIDTH, r.startW + (e.clientX - r.startX));
      setColWidths(prev => ({ ...prev, [r.key]: next }));
    }
    function onUp() {
      if (!resizeRef.current) return;
      resizeRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
  }, []);

  const startResize = useCallback((key, e) => {
    e.preventDefault();
    e.stopPropagation();
    resizeRef.current = { key, startX: e.clientX, startW: colWidthOf(colWidths, key) };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [colWidths]);

  const toggleColumn = useCallback((key) => {
    setHiddenCols(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  // Header click cycles the sort on that column: asc → desc → off.
  const toggleSort = useCallback((key) => {
    setSort(prev => {
      if (prev.key !== key) return { key, dir: 'asc' };
      if (prev.dir === 'asc') return { key, dir: 'desc' };
      return { key: null, dir: 'asc' };
    });
  }, []);

  const setColFilter = useCallback((key, value) => {
    setColFilters(prev => ({ ...prev, [key]: value }));
  }, []);

  const clearSortAndFilters = useCallback(() => {
    setSort({ key: null, dir: 'asc' });
    setColFilters({});
  }, []);

  const hasActiveFilters = useMemo(
    () => Object.values(colFilters).some(v => v && v.trim()),
    [colFilters],
  );

  const visibleColumns = useMemo(() => COLUMNS.filter(c => !hiddenCols.has(c.key)), [hiddenCols]);

  // Initial load: master rows + the zip→utility lookup table.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [saved, util] = await Promise.all([
        loadList(MASTER_SITE_LIST_KEY).catch(() => null),
        loadUtilityRates().catch(() => null),
      ]);
      if (cancelled) return;
      if (Array.isArray(saved)) setRows(saved);
      if (util?.zipMap) setZipMap(util.zipMap);
      setLoaded(true);
    })();
    return () => { cancelled = true; };
  }, []);

  // Persist on change (skip the first render after load so we don't
  // immediately rewrite what we just read).
  useEffect(() => {
    if (!loaded) return;
    if (skipSave.current) { skipSave.current = false; return; }
    saveList(MASTER_SITE_LIST_KEY, rows).catch(() => {});
  }, [rows, loaded]);

  // company name -> how many rows carry it. Drives both the filter's option
  // list and the site count shown against each suggestion.
  const companyCounts = useMemo(() => {
    const m = new Map();
    for (const r of rows) {
      const c = String(r.company || '').trim();
      if (c) m.set(c, (m.get(c) || 0) + 1);
    }
    return m;
  }, [rows]);

  const companies = useMemo(
    () => Array.from(companyCounts.keys()).sort((a, b) => a.localeCompare(b)),
    [companyCounts],
  );

  // Distinct Table View (prospects) company names, sorted — powers both the
  // predictive-search datalist on the Company cells and the mapping index.
  const tableViewNames = useMemo(() => {
    const names = [];
    const seen = new Set();
    for (const p of (prospects || [])) {
      const c = String(p?.company || '').trim();
      if (!c) continue;
      const k = c.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      names.push(c);
    }
    return names.sort((a, b) => a.localeCompare(b));
  }, [prospects]);

  // Index of the Table View company names, using the app's shared fuzzy
  // company matching so suffix / case / punctuation variants still count as
  // "mapped".
  const tableViewIndex = useMemo(() => buildCompanyIndex(tableViewNames), [tableViewNames]);

  // Distinct Master Site List companies with no match among the Table View
  // companies — the "unmapped" set the filter narrows to.
  const unmappedCompanies = useMemo(() => {
    const set = new Set();
    for (const c of companies) {
      if (!hasMatchInIndex(tableViewIndex, c)) set.add(c);
    }
    return set;
  }, [companies, tableViewIndex]);

  // The unmapped companies with their site counts, sorted — drives the
  // match popup. Recomputes as rows are matched/renamed so matched
  // companies drop off the list.
  const unmappedList = useMemo(() => {
    const counts = new Map();
    for (const r of rows) {
      const c = String(r.company || '').trim();
      if (c && unmappedCompanies.has(c)) counts.set(c, (counts.get(c) || 0) + 1);
    }
    return [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [rows, unmappedCompanies]);

  // Visible rows carry their index in the full array so edits/deletes
  // target the right row even while filtered or sorted. Each also carries
  // its resolved utility lookup so filter, sort, and render agree and we
  // only look it up once per row.
  const visible = useMemo(() => {
    let idx = rows.map((r, i) => ({ r, i, look: lookupUtilityForZip(zipMap, r.zip) }));
    if (companyFilter !== ALL) {
      idx = idx.filter(({ r }) => String(r.company || '').trim() === companyFilter);
    }
    if (unmappedOnly) {
      idx = idx.filter(({ r }) => unmappedCompanies.has(String(r.company || '').trim()));
    }
    const active = Object.entries(colFilters).filter(([, v]) => v && v.trim());
    if (active.length) {
      idx = idx.filter(({ r, look }) =>
        active.every(([key, val]) =>
          cellText(key, r, look).toLowerCase().includes(val.trim().toLowerCase())));
    }
    if (sort.key) {
      const dir = sort.dir === 'desc' ? -1 : 1;
      idx = idx.slice().sort((a, b) => {
        const va = cellText(sort.key, a.r, a.look);
        const vb = cellText(sort.key, b.r, b.look);
        // Blanks always sort to the bottom regardless of direction.
        if (!va && !vb) return 0;
        if (!va) return 1;
        if (!vb) return -1;
        return dir * va.localeCompare(vb, undefined, { numeric: true, sensitivity: 'base' });
      });
    }
    return idx;
  }, [rows, companyFilter, unmappedOnly, unmappedCompanies, colFilters, sort, zipMap]);

  const updateCell = useCallback((index, key, value) => {
    setRows(prev => {
      const next = prev.slice();
      let row = { ...next[index], [key]: value };
      // Re-derive the stored ISO fields whenever the zip changes.
      if (key === 'zip') row = { ...row, ...lookupIsoForZip(value) };
      next[index] = row;
      return next;
    });
  }, []);

  // After editing a company cell, if other rows still carry the name it used
  // to hold, offer to rename those too. `rows` is already current here (the
  // edited row now shows the new name), so we count the stragglers directly.
  function offerBulkRename(index, newValueRaw) {
    const edit = companyEditRef.current;
    companyEditRef.current = null;
    if (!edit) return;
    const oldName = String(edit.original || '').trim();
    const newName = String(newValueRaw || '').trim();
    if (!oldName || !newName || oldName === newName) return;
    const count = rows.filter((r, idx) => idx !== index && String(r.company || '').trim() === oldName).length;
    if (count > 0) setBulkRename({ oldName, newName, count });
  }

  // Apply the pending rename to every row still carrying the old name.
  const applyBulkRename = useCallback(() => {
    setBulkRename(current => {
      if (!current) return null;
      const target = current.oldName;
      setRows(prev => prev.map(r =>
        String(r.company || '').trim() === target ? { ...r, company: current.newName } : r
      ));
      return null;
    });
  }, []);

  // Match an unmapped company to a Table View company: rename every row that
  // carries the old name so it maps. Dropping that company off the unmapped
  // list falls out of the rows change.
  // Stage (or clear) one company's pick as the user types / picks.
  const setMatchPick = useCallback((name, value) => {
    setMatchPicks(prev => ({ ...prev, [name]: value }));
  }, []);

  // Resolve each staged pick to a canonical Table View company (exact,
  // case-insensitive). Only picks that land on a real Table View company —
  // and actually change the name — count as a selection.
  const resolvedPicks = useMemo(() => {
    const out = [];
    for (const u of unmappedList) {
      const raw = String(matchPicks[u.name] || '').trim();
      if (!raw) continue;
      const canonical = tableViewNames.find(n => n.toLowerCase() === raw.toLowerCase());
      if (canonical && canonical.toLowerCase() !== u.name.toLowerCase()) {
        out.push({ oldName: u.name, newName: canonical, count: u.count });
      }
    }
    return out;
  }, [matchPicks, unmappedList, tableViewNames]);

  // Commit every staged pick at once: rename all matching rows so the
  // companies map to Table View. Matched companies then drop off the list.
  const applyMatchPicks = useCallback(() => {
    if (!resolvedPicks.length) return;
    const map = new Map(resolvedPicks.map(p => [p.oldName, p.newName]));
    setRows(prev => prev.map(r => {
      const c = String(r.company || '').trim();
      return map.has(c) ? { ...r, company: map.get(c) } : r;
    }));
    const nCompanies = resolvedPicks.length;
    const nRows = resolvedPicks.reduce((s, p) => s + p.count, 0);
    setBusy(`Renamed ${nRows} row${nRows === 1 ? '' : 's'} across ${nCompanies} compan${nCompanies === 1 ? 'y' : 'ies'} to match Table View.`);
    setMatchPicks({});
  }, [resolvedPicks]);

  const deleteRow = useCallback((index) => {
    setRows(prev => prev.filter((_, i) => i !== index));
  }, []);

  function addRow() {
    const seed = emptyRow();
    if (companyFilter !== ALL) seed.company = companyFilter;
    setRows(prev => [...prev, withIso(seed)]);
  }

  // Append rows, dropping any that duplicate an existing row by
  // company|property|zip. Returns the number actually added.
  function appendDeduped(incoming) {
    let added = 0;
    setRows(prev => {
      const seen = new Set(prev.map(rowKey));
      const toAdd = [];
      for (const r of incoming) {
        if (isRowEmpty(r)) continue;
        const k = rowKey(r);
        if (seen.has(k)) continue;
        seen.add(k);
        toAdd.push(withIso(r));
      }
      added = toAdd.length;
      return toAdd.length ? [...prev, ...toAdd] : prev;
    });
    return added;
  }

  // Step 1 → 2: parse the pasted text into a grid and open the column
  // matcher with a best-guess field→column mapping.
  function openMatcher() {
    const cells = parsePasteCells(pasteText);
    if (!cells.length) { alert('No rows found in the pasted text.'); return; }
    const hasHeader = cells.length > 1 && looksLikeHeaderRow(cells[0]);
    const headers = headersFromCells(cells, hasHeader);
    setMatcher({ cells, hasHeader, mapping: defaultMapping(headers, hasHeader) });
    setShowPaste(false);
  }

  function setMatcherHasHeader(hasHeader) {
    setMatcher(m => {
      if (!m) return m;
      const headers = headersFromCells(m.cells, hasHeader);
      return { ...m, hasHeader, mapping: defaultMapping(headers, hasHeader) };
    });
  }

  function setFieldColumn(fieldKey, colIndex) {
    setMatcher(m => (m ? { ...m, mapping: { ...m.mapping, [fieldKey]: colIndex } } : m));
  }

  // Step 2 commit: build rows from the chosen mapping and add any that
  // aren't already in the list.
  function applyMatcher() {
    if (!matcher) return;
    const { cells, hasHeader, mapping } = matcher;
    if (!Object.values(mapping).some(i => i != null && i >= 0)) {
      alert('Map at least one column before adding.');
      return;
    }
    const dataRows = hasHeader ? cells.slice(1) : cells;
    const parsed = rowsFromMapping(dataRows, mapping);
    if (!parsed.length) { alert('No non-empty rows to add with the current column matching.'); return; }
    const added = appendDeduped(parsed);
    const skipped = parsed.length - added;
    setMatcher(null);
    setPasteText('');
    setBusy(`Added ${added} new site${added === 1 ? '' : 's'}${skipped ? ` (skipped ${skipped} already in the list)` : ''}.`);
  }

  async function onFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const buf = await file.arrayBuffer();
      const { rows: parsed, headers } = parseBestSheet(new Uint8Array(buf));
      const mapping = detectMasterMapping(headers);
      const mapped = parsed.map(r => rowFromMapping(r, mapping));
      const added = appendDeduped(mapped);
      setBusy(`Imported ${added} new row${added === 1 ? '' : 's'} from ${file.name}.`);
    } catch (err) {
      alert(`Could not read file: ${err?.message || err}`);
    }
  }

  // Pull sites from the Utility Lookup page into this list. Scoped to the
  // selected company when one is chosen in the filter.
  async function importFromUtilityLookup() {
    setBusy('Importing from Utility Lookup…');
    try {
      const sites = await loadList(UTILITY_SITES_KEY);
      if (!Array.isArray(sites) || !sites.length) {
        setBusy('Utility Lookup has no site data to import. Upload a sites file there first.');
        return;
      }
      const headers = Object.keys(sites[0] || {});
      const mapping = detectMasterMapping(headers);
      let mapped = sites.map(r => rowFromMapping(r, mapping)).filter(r => !isRowEmpty(r));
      if (companyFilter !== ALL) {
        mapped = mapped.filter(r => String(r.company || '').trim() === companyFilter);
      }
      const added = appendDeduped(mapped);
      const scope = companyFilter === ALL ? 'all companies' : `"${companyFilter}"`;
      setBusy(`Imported ${added} new site${added === 1 ? '' : 's'} (${scope}) from Utility Lookup.`);
    } catch (err) {
      setBusy(`Import failed: ${err?.message || err}`);
    }
  }

  // Push the (optionally company-filtered) rows into the Utility Lookup
  // page. Non-destructive: existing Utility Lookup sites are kept and we
  // append our rows, reusing that table's own column headers when they
  // exist so its layout/detection stays intact. If it's empty we seed it
  // with the canonical headers.
  async function exportToUtilityLookup() {
    const scopeRows = (companyFilter === ALL ? rows : rows.filter(r => String(r.company || '').trim() === companyFilter))
      .filter(r => !isRowEmpty(r));
    if (!scopeRows.length) { alert('No rows to export.'); return; }
    const scope = companyFilter === ALL ? 'all companies' : `"${companyFilter}"`;
    if (!confirm(`Add ${scopeRows.length} site${scopeRows.length === 1 ? '' : 's'} (${scope}) to the Utility Lookup page? Existing Utility Lookup sites are kept; duplicates are skipped.`)) return;
    setBusy('Exporting to Utility Lookup…');
    try {
      const existing = await loadList(UTILITY_SITES_KEY);
      const hasExisting = Array.isArray(existing) && existing.length > 0;

      if (hasExisting) {
        // Map our fields onto the existing table's headers so appended
        // rows line up with its columns; skip fields that have no home.
        const headers = Object.keys(existing[0] || {});
        const mapping = detectMasterMapping(headers);
        const existingMaster = existing.map(r => rowFromMapping(r, mapping));
        const seen = new Set(existingMaster.map(rowKey));
        const toAppend = [];
        for (const r of scopeRows) {
          const k = rowKey(r);
          if (seen.has(k)) continue;
          seen.add(k);
          const obj = {};
          for (const h of headers) obj[h] = '';
          for (const f of MASTER_FIELDS) {
            const h = mapping[f.key];
            if (h) obj[h] = r[f.key] || '';
          }
          toAppend.push(obj);
        }
        if (!toAppend.length) { setBusy('Nothing to export: all selected sites already exist in Utility Lookup.'); return; }
        await saveList(UTILITY_SITES_KEY, [...existing, ...toAppend]);
        setBusy(`Added ${toAppend.length} site${toAppend.length === 1 ? '' : 's'} to Utility Lookup. Open the Utility Lookup tab to see them.`);
      } else {
        // Empty target — seed with canonical headers.
        const out = scopeRows.map(r => {
          const obj = {};
          MASTER_FIELDS.forEach((f, i) => { obj[CANONICAL_HEADERS[i]] = r[f.key] || ''; });
          return obj;
        });
        await saveList(UTILITY_SITES_KEY, out);
        setBusy(`Sent ${out.length} site${out.length === 1 ? '' : 's'} to Utility Lookup. Open the Utility Lookup tab to see them.`);
      }
    } catch (err) {
      setBusy(`Export failed: ${err?.message || err}`);
    }
  }

  async function exportExcel() {
    const scopeRows = companyFilter === ALL ? rows : rows.filter(r => String(r.company || '').trim() === companyFilter);
    const data = scopeRows.filter(r => !isRowEmpty(r)).map(r => {
      const o = {};
      MASTER_FIELDS.forEach((f, i) => { o[CANONICAL_HEADERS[i]] = r[f.key] || ''; });
      const iso = r.iso_confidence ? { iso: r.iso ?? null, egrid_subregion: r.egrid_subregion ?? null, iso_confidence: r.iso_confidence } : lookupIsoForZip(r.zip);
      o['ISO / RTO'] = iso.iso || '';
      o['eGRID Subregion'] = iso.egrid_subregion || '';
      o['ISO Confidence'] = iso.iso_confidence || '';
      const look = lookupUtilityForZip(zipMap, r.zip);
      o['Indicative Utility'] = look.utility || '';
      o['Regulated/Deregulated'] = look.status || '';
      return o;
    });
    if (!data.length) { alert('No rows to export.'); return; }
    // Pulled in on use — the spreadsheet library is ~140 KB gzipped and
    // this page only needs it to export.
    const XLSX = await import('xlsx');
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Master Site List');
    XLSX.writeFile(wb, 'master-site-list.xlsx');
  }

  function clearAll() {
    if (!confirm('Clear the entire Master Site List? This cannot be undone.')) return;
    setRows([]);
    clearList(MASTER_SITE_LIST_KEY).catch(() => {});
    setBusy('Cleared.');
  }

  // Bulk (re)assign ISO to every row from its zip. Idempotent — running it
  // again when nothing's changed is a no-op. Logs a full summary to the
  // console and a short recap to the toolbar status line.
  function backfillAllIso() {
    if (rows.length === 0) { setBusy('No rows to backfill.'); return; }
    const { rows: next, summary } = backfillIso(rows);
    if (summary.updated > 0) setRows(next);
    console.log('[Master Site List] ISO backfill summary:', summary);
    setBusy(
      `ISO backfill: ${summary.updated} updated, ${summary.unchanged} unchanged of ${summary.total} · ` +
      `${summary.seam} seam / ${summary.verify} verify / ${summary.unknown} unknown.`
    );
  }

  if (!loaded) return <div className={styles.empty}>Loading…</div>;

  return (
    <div className={styles.wrap}>
      <div className={styles.toolbar}>
        <button className={styles.btnPrimary} onClick={addRow}>+ Add Row</button>
        <button className={styles.btn} onClick={() => setShowPaste(true)}>Paste Rows</button>
        <button className={styles.btn} onClick={() => fileInputRef.current?.click()}>Import File…</button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          style={{ display: 'none' }}
          onChange={onFile}
        />

        <CompanyFilterCombo
          companies={companies}
          counts={companyCounts}
          total={rows.length}
          value={companyFilter}
          onChange={setCompanyFilter}
        />

        <button
          className={unmappedOnly ? styles.btnActive : styles.btn}
          onClick={() => setShowUnmapped(true)}
          disabled={!prospects.length}
          title={prospects.length
            ? 'List companies not found among the Table View companies and match them to one'
            : 'Table View companies are still loading'}
        >
          Unmapped to Table View{unmappedCompanies.size ? ` (${unmappedCompanies.size})` : ''}
        </button>

        <button className={styles.btn} onClick={importFromUtilityLookup} title="Pull sites in from the Utility Lookup page">↙ From Utility Lookup</button>
        <button className={styles.btn} onClick={exportToUtilityLookup} title="Send the selected sites to the Utility Lookup page">↗ To Utility Lookup</button>

        <button
          className={showFilters || hasActiveFilters ? styles.btnActive : styles.btn}
          onClick={() => setShowFilters(v => !v)}
          title="Show a filter box under each column header"
        >
          Filter ▾
        </button>

        <div className={styles.colMenuWrap} ref={colMenuRef}>
          <button className={styles.btn} onClick={() => setShowColMenu(v => !v)} title="Show or hide columns">
            Columns ▾
          </button>
          {showColMenu && (
            <div className={styles.colMenu} role="menu">
              {COLUMNS.map(c => (
                <label key={c.key} className={styles.colMenuItem}>
                  <input
                    type="checkbox"
                    checked={!hiddenCols.has(c.key)}
                    onChange={() => toggleColumn(c.key)}
                  />
                  {c.label}
                </label>
              ))}
              <div className={styles.colMenuDivider} />
              <button className={styles.colMenuReset} onClick={() => { setHiddenCols(new Set()); setColWidths({}); }}>
                Reset columns & widths
              </button>
            </div>
          )}
        </div>

        <span className={styles.spacer} />

        {(sort.key || hasActiveFilters) && (
          <button className={styles.clearLink} onClick={clearSortAndFilters} title="Clear all column sorting and filters">
            Clear sort/filter
          </button>
        )}
        <span className={styles.count}>{visible.length} shown</span>
        <button className={styles.btn} onClick={backfillAllIso} title="Assign ISO / RTO to every row from its zip (via EPA eGRID). Safe to re-run.">Backfill ISO</button>
        <button className={styles.btn} onClick={exportExcel}>Export Excel</button>
        <button className={styles.btnDanger} onClick={clearAll}>Clear</button>
      </div>

      {busy && <div className={styles.hint}>{busy}</div>}

      {/* Predictive-search source for the Company cells: every Company input
          references this one datalist of Table View company names. */}
      {tableViewNames.length > 0 && (
        <datalist id="msl-tableview-companies">
          {tableViewNames.map(n => <option key={n} value={n} />)}
        </datalist>
      )}

      <div className={styles.tableWrap}>
        <table className={styles.table} style={{ tableLayout: 'fixed', width: 'auto' }}>
          <colgroup>
            <col style={{ width: 44 }} />
            {visibleColumns.map(c => <col key={c.key} style={{ width: colWidthOf(colWidths, c.key) }} />)}
            <col style={{ width: 40 }} />
          </colgroup>
          <thead>
            <tr>
              <th className={styles.rowNum}>#</th>
              {visibleColumns.map(c => {
                const sorted = sort.key === c.key;
                return (
                  <th key={c.key} title={c.title || c.label}>
                    <span
                      className={styles.thHead}
                      onClick={() => toggleSort(c.key)}
                      title={`Sort by ${c.label}`}
                    >
                      <span className={styles.thLabel}>{c.label}</span>
                      <span className={sorted ? styles.sortArrowActive : styles.sortArrow}>
                        {sorted ? (sort.dir === 'asc' ? '▲' : '▼') : '⇅'}
                      </span>
                    </span>
                    {showFilters && (
                      <input
                        type="search"
                        className={colFilters[c.key] ? styles.filterInputActive : styles.filterInput}
                        value={colFilters[c.key] || ''}
                        placeholder="Filter…"
                        aria-label={`Filter by ${c.label}`}
                        title={`Show only rows whose ${c.label} contains what you type`}
                        onChange={(e) => setColFilter(c.key, e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        // Escape clears this column rather than bubbling up to
                        // whatever the page would otherwise close.
                        onKeyDown={(e) => {
                          if (e.key !== 'Escape') return;
                          e.stopPropagation();
                          setColFilter(c.key, '');
                        }}
                      />
                    )}
                    <span
                      className={styles.resizer}
                      title="Drag to resize"
                      onMouseDown={(e) => startResize(c.key, e)}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </th>
                );
              })}
              <th />
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td colSpan={visibleColumns.length + 2} className={styles.empty}>
                  No sites yet. Add a row, paste a list, import a file, or pull from the Utility Lookup page.
                </td>
              </tr>
            ) : visible.map(({ r, i, look }) => {
              return (
                <tr key={i}>
                  <td className={styles.rowNum}>{i + 1}</td>
                  {visibleColumns.map(c => {
                    if (c.kind === 'field') {
                      // The Company cell offers predictive search against the
                      // Table View company names via a shared <datalist>, plus
                      // the bulk-rename prompt on blur.
                      const isCompany = c.key === 'company';
                      return (
                        <td key={c.key}>
                          <input
                            className={styles.cellInput}
                            value={r[c.key] || ''}
                            onChange={e => updateCell(i, c.key, e.target.value)}
                            list={isCompany && tableViewNames.length ? 'msl-tableview-companies' : undefined}
                            autoComplete={isCompany ? 'off' : undefined}
                            {...(isCompany ? {
                              onFocus: e => { companyEditRef.current = { original: e.target.value }; },
                              onBlur: e => offerBulkRename(i, e.target.value),
                            } : {})}
                          />
                        </td>
                      );
                    }
                    if (c.kind === 'iso') {
                      // Prefer the stored fields; fall back to a live lookup so
                      // a row that predates the stamp still shows something.
                      const info = r.iso_confidence
                        ? { iso: r.iso ?? null, egrid_subregion: r.egrid_subregion ?? null, iso_confidence: r.iso_confidence }
                        : lookupIsoForZip(r.zip);
                      if (!info.iso) {
                        return <td key={c.key} className={styles.derived}><span style={{ color: 'var(--color-text-muted)' }}>-</span></td>;
                      }
                      const isNone = info.iso.startsWith('None');
                      const cellTitle = [
                        isNone ? info.iso : `ISO / RTO: ${info.iso}`,
                        info.egrid_subregion ? `eGRID subregion ${info.egrid_subregion}` : null,
                        info.iso_confidence === 'seam' ? 'ZIP straddles two markets: primary market shown' : null,
                        info.iso_confidence === 'verify' ? 'Subregion is ambiguous: verify' : null,
                      ].filter(Boolean).join(' · ');
                      return (
                        <td key={c.key} className={styles.derived} title={cellTitle}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                            <span style={isNone ? { color: 'var(--color-text-muted)' } : undefined}>{isNone ? 'None' : info.iso}</span>
                            {(info.iso_confidence === 'seam' || info.iso_confidence === 'verify') && (
                              <Badge label={info.iso_confidence} color={ISO_BADGE_COLOR[info.iso_confidence]} />
                            )}
                          </span>
                        </td>
                      );
                    }
                    if (c.kind === 'utility') {
                      return (
                        <td key={c.key} className={styles.derived}>
                          {look.utility || <span style={{ color: 'var(--color-text-muted)' }}>-</span>}
                        </td>
                      );
                    }
                    // status
                    return (
                      <td key={c.key} className={styles.derived}>
                        {look.status === 'Regulated'
                          ? <span className={`${styles.badge} ${styles.badgeReg}`}>Regulated</span>
                          : look.status === 'Deregulated'
                            ? <span className={`${styles.badge} ${styles.badgeDereg}`}>Deregulated</span>
                            : <span style={{ color: 'var(--color-text-muted)' }}>-</span>}
                      </td>
                    );
                  })}
                  <td>
                    <button className={styles.del} title="Delete row" onClick={() => deleteRow(i)}>✕</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {!zipMap && (
        <div className={styles.hint}>
          Tip: the Indicative Utility / Status columns fill in once a zip → utility table has been uploaded on the Utility Lookup page.
        </div>
      )}

      {showPaste && (
        <div className={styles.modalBackdrop} onClick={() => setShowPaste(false)}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <h3 className={styles.modalTitle}>Paste sites</h3>
            <p className={styles.modalText}>
              Paste rows copied from Excel or Sheets (any column order). The next
              step lets you match each pasted column to a field. New rows are
              added to the list; rows already present are skipped.
            </p>
            <textarea
              className={styles.textarea}
              autoFocus
              value={pasteText}
              onChange={e => setPasteText(e.target.value)}
              placeholder={CANONICAL_HEADERS.join('\t')}
            />
            <div className={styles.modalActions}>
              <button className={styles.btn} onClick={() => { setShowPaste(false); setPasteText(''); }}>Cancel</button>
              <button className={styles.btnPrimary} onClick={openMatcher} disabled={!pasteText.trim()}>Next: Match Columns →</button>
            </div>
          </div>
        </div>
      )}

      {matcher && (() => {
        const headers = headersFromCells(matcher.cells, matcher.hasHeader);
        const dataRows = matcher.hasHeader ? matcher.cells.slice(1) : matcher.cells;
        const sample = dataRows[0] || [];
        return (
          <div className={styles.modalBackdrop} onClick={() => setMatcher(null)}>
            <div className={styles.modalWide} onClick={e => e.stopPropagation()}>
              <h3 className={styles.modalTitle}>Match columns</h3>
              <p className={styles.modalText}>
                Choose which pasted column fills each field. {dataRows.length} data
                row{dataRows.length === 1 ? '' : 's'} detected.
              </p>
              <label className={styles.checkRow}>
                <input
                  type="checkbox"
                  checked={matcher.hasHeader}
                  onChange={e => setMatcherHasHeader(e.target.checked)}
                />
                First pasted row is a header row
              </label>
              <div className={styles.mapGrid}>
                {MASTER_FIELDS.map(f => (
                  <div key={f.key} className={styles.mapRow}>
                    <span className={styles.mapField}>{f.label}</span>
                    <select
                      className={styles.select}
                      value={matcher.mapping[f.key] ?? -1}
                      onChange={e => setFieldColumn(f.key, Number(e.target.value))}
                    >
                      <option value={-1}>(Not mapped)</option>
                      {headers.map((h, idx) => (
                        <option key={idx} value={idx}>
                          {h}{sample[idx] ? `: e.g. "${String(sample[idx]).slice(0, 24)}"` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
              <div className={styles.modalActions}>
                <button className={styles.btn} onClick={() => { setMatcher(null); setShowPaste(true); }}>← Back</button>
                <button className={styles.btnPrimary} onClick={applyMatcher}>Add Rows</button>
              </div>
            </div>
          </div>
        );
      })()}

      {bulkRename && (
        <div className={styles.modalBackdrop} onClick={() => setBulkRename(null)}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <h3 className={styles.modalTitle}>Rename company across rows?</h3>
            <p className={styles.modalText}>
              You changed this row from “{bulkRename.oldName}” to “{bulkRename.newName}”.
              {' '}{bulkRename.count} other row{bulkRename.count === 1 ? '' : 's'} still
              {' '}list{bulkRename.count === 1 ? 's' : ''} “{bulkRename.oldName}”. Rename
              {' '}{bulkRename.count === 1 ? 'it' : 'them'} to “{bulkRename.newName}” too?
            </p>
            <div className={styles.modalActions}>
              <button className={styles.btn} onClick={() => setBulkRename(null)}>Keep just this row</button>
              <button className={styles.btnPrimary} onClick={applyBulkRename}>
                Rename all {bulkRename.count + 1} rows
              </button>
            </div>
          </div>
        </div>
      )}

      {showUnmapped && (
        <div className={styles.modalBackdrop} onClick={() => setShowUnmapped(false)}>
          <div className={styles.modalWide} onClick={e => e.stopPropagation()}>
            <h3 className={styles.modalTitle}>Unmapped to Table View ({unmappedList.length})</h3>
            <p className={styles.modalText}>
              These Master Site List companies don’t match any Table View company. Pick a
              Table View company for each to rename its rows so they map: start typing to
              search. Matched companies drop off the list.
            </p>
            <label className={styles.checkRow}>
              <input type="checkbox" checked={unmappedOnly} onChange={e => setUnmappedOnly(e.target.checked)} />
              Also filter the table below to these companies
            </label>
            {unmappedList.length === 0 ? (
              <div className={styles.unmappedDone}>Every company is mapped to a Table View company. 🎉</div>
            ) : (
              <div className={styles.unmappedList}>
                {unmappedList.map(u => {
                  const raw = String(matchPicks[u.name] || '');
                  const canonical = tableViewNames.find(n => n.toLowerCase() === raw.trim().toLowerCase()) || '';
                  return (
                    <UnmappedMatchRow
                      key={u.name}
                      name={u.name}
                      count={u.count}
                      value={raw}
                      canonical={canonical}
                      onChange={setMatchPick}
                    />
                  );
                })}
              </div>
            )}
            <div className={styles.modalActions}>
              <button className={styles.btn} onClick={() => setShowUnmapped(false)}>Close</button>
              <button
                className={styles.btnPrimary}
                disabled={!resolvedPicks.length}
                onClick={applyMatchPicks}
                title={resolvedPicks.length
                  ? `Save ${resolvedPicks.length} selection${resolvedPicks.length === 1 ? '' : 's'} and rename the matched companies`
                  : 'Pick a Table View company for at least one row first'}
              >
                Save &amp; rename{resolvedPicks.length ? ` (${resolvedPicks.length})` : ''}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
