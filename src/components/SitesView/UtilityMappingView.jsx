import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import * as XLSX from 'xlsx';
import {
  saveList as saveListToIDB,
  loadList as loadListFromIDB,
  clearList as clearListFromIDB,
} from '../../utils/uploadedListStore';
import { parseBestSheet } from '../../utils/xlsxParse';
import { findFuzzyMatch } from '../../utils/utilityNameMatch';
import { UtilityPasteImportModal } from './UtilityPasteImportModal';
import styles from './SitesView.module.css';

// IndexedDB key for the uploaded utility list — the one
// the user maps onto the app's known utility names. Each row carries the
// uploaded name + commodity / state / country, plus a `mappedTo` field
// holding the reference utility name the user matched it to.
const NAME_MAP_LIST_KEY = 'utility-name-map-list-override';

// Minimum fuzzy score before we pre-suggest a reference utility for an
// uploaded name. Same scale as findFuzzyMatch (0-100); a touch higher
// than the interval matcher so the auto-suggestion is reasonably safe to
// accept in bulk.
const NAME_MAP_SUGGEST_THRESHOLD = 45;

// Column-mapping fields for the name-map upload / paste. Utility Name is
// the only required column; commodity / state / country / status are
// optional metadata carried alongside each name. (Status can also be
// pasted on its own later via the Paste Status flow / STATUS_FIELDS.)
const NAME_MAP_FIELDS = [
  { key: 'name', label: 'Utility Name', required: true, match: (h) => /\b(utility|provider|lse|ldc|company|name)\b/i.test(h) },
  { key: 'commodity', label: 'Commodity', required: false, match: (h) => /commodity|fuel|\bservice\s*type\b|\b(electric|electricity|gas|water)\b/i.test(h) },
  { key: 'state', label: 'State / Province', required: false, match: (h) => /\b(state|province|st|prov|region)\b/i.test(h) },
  { key: 'country', label: 'Country', required: false, match: (h) => /\b(country|nation)\b/i.test(h) },
  { key: 'status', label: 'Status', required: false, match: (h) => /\bstatus\b|\bstage\b|disposition|outreach|\bactive\b|availab/i.test(h) },
  { key: 'requirements', label: 'Requirements / Comments', required: false, match: (h) => /requirement|comment|note|remark/i.test(h) },
];

// Paste-status import: a utility-name column plus the status to attach to
// each matched row. Statuses are merged onto the existing name-map rows by
// matching the pasted name to the uploaded name (exact first, then fuzzy).
const STATUS_FIELDS = [
  { key: 'name', label: 'Utility Name', required: true, match: (h) => /\b(utility|provider|lse|ldc|company|name)\b/i.test(h) },
  { key: 'status', label: 'Status', required: true, match: (h) => /\bstatus\b|\bstage\b|\bstate\s*of\b|disposition|outreach/i.test(h) },
];

// Column model for the Utility Name Mapping table. Drives header order,
// default widths, per-column search, resize, and the visibility toggle.
// `status` is a user-editable / pasteable free-text field stored on each
// row; `mapping` is the derived known-utility indicator.
const NAME_MAP_COLUMNS = [
  { key: 'name', label: 'Uploaded Utility', width: 240 },
  { key: 'commodity', label: 'Commodity', width: 120 },
  { key: 'state', label: 'State', width: 90 },
  { key: 'country', label: 'Country', width: 90 },
  { key: 'mappedTo', label: 'Map to known utility', width: 320 },
  { key: 'status', label: 'Status', width: 170 },
  { key: 'requirements', label: 'Requirements / Comments', width: 260 },
  { key: 'mapping', label: 'Mapping', width: 140 },
];

const COL_WIDTHS_KEY = 'utility-name-map-col-widths';
const COL_VISIBLE_KEY = 'utility-name-map-col-visible';
const MIN_COL_WIDTH = 60;

// Read a persisted column-preference object from localStorage, merged onto
// the defaults so a newly-added column always has a value.
function loadColPref(key, defaults) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return { ...defaults };
    return { ...defaults, ...JSON.parse(raw) };
  } catch {
    return { ...defaults };
  }
}

const DEFAULT_COL_WIDTHS = Object.fromEntries(NAME_MAP_COLUMNS.map(c => [c.key, c.width]));
const DEFAULT_COL_VISIBLE = Object.fromEntries(NAME_MAP_COLUMNS.map(c => [c.key, true]));

function pickColumn(headers, re, fallback = '') {
  return headers.find(h => re.test(String(h))) || fallback;
}

export function UtilityMappingView({ siteUtilities = [], referenceUtilityNames = [], onExportSiteMapping }) {
  const [exporting, setExporting] = useState(false);

  // ---- Name-mapping section state --------------------------------------
  const [nameMapList, setNameMapList] = useState([]); // [{ name, commodity, state, country, mappedTo }]
  const [nameMapMeta, setNameMapMeta] = useState(null);
  const [nameMapBusy, setNameMapBusy] = useState(false);
  const [nameMapError, setNameMapError] = useState('');
  const [showNameMapPaste, setShowNameMapPaste] = useState(false);
  const [showStatusPaste, setShowStatusPaste] = useState(false);
  const [nameMapFilter, setNameMapFilter] = useState('');
  const nameMapFileRef = useRef(null);

  // ---- Name-map table: column widths / visibility / per-column search ---
  const [colWidths, setColWidths] = useState(() => loadColPref(COL_WIDTHS_KEY, DEFAULT_COL_WIDTHS));
  const [colVisible, setColVisible] = useState(() => loadColPref(COL_VISIBLE_KEY, DEFAULT_COL_VISIBLE));
  const [colSearch, setColSearch] = useState({}); // key -> query string
  const [showColMenu, setShowColMenu] = useState(false);
  const resizingRef = useRef(null);

  useEffect(() => { try { localStorage.setItem(COL_WIDTHS_KEY, JSON.stringify(colWidths)); } catch { /* ignore */ } }, [colWidths]);
  useEffect(() => { try { localStorage.setItem(COL_VISIBLE_KEY, JSON.stringify(colVisible)); } catch { /* ignore */ } }, [colVisible]);

  // Close the column-visibility menu on any outside click.
  useEffect(() => {
    if (!showColMenu) return undefined;
    const close = () => setShowColMenu(false);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [showColMenu]);

  // Column resize: drag the handle on a header's right edge. We read the
  // live width off a ref so the move handler stays stable across renders.
  const onResizeMove = useCallback((e) => {
    const r = resizingRef.current;
    if (!r) return;
    const w = Math.max(MIN_COL_WIDTH, r.startWidth + (e.clientX - r.startX));
    setColWidths(prev => ({ ...prev, [r.key]: w }));
  }, []);
  const onResizeEnd = useCallback(() => {
    resizingRef.current = null;
    document.removeEventListener('mousemove', onResizeMove);
    document.removeEventListener('mouseup', onResizeEnd);
  }, [onResizeMove]);
  const onResizeStart = useCallback((key, e) => {
    e.preventDefault();
    e.stopPropagation();
    resizingRef.current = { key, startX: e.clientX, startWidth: colWidths[key] ?? DEFAULT_COL_WIDTHS[key] };
    document.addEventListener('mousemove', onResizeMove);
    document.addEventListener('mouseup', onResizeEnd);
  }, [colWidths, onResizeMove, onResizeEnd]);

  const toggleColumn = useCallback((key) => {
    setColVisible(prev => ({ ...prev, [key]: prev[key] === false }));
  }, []);

  // ---- Name-mapping section: restore + upload + paste + persist --------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const saved = await loadListFromIDB(NAME_MAP_LIST_KEY);
      if (cancelled || !Array.isArray(saved) || saved.length === 0) return;
      setNameMapList(saved);
      const first = saved[0] || {};
      setNameMapMeta({
        fileName: first._fileName || 'saved list',
        count: saved.length,
        nameCol: first._nameCol || 'Utility',
      });
    })();
    return () => { cancelled = true; };
  }, []);

  // Pre-fill each uploaded row's suggested reference utility (best fuzzy
  // match above threshold) at import time. The user's explicit choices
  // live in `mappedTo`; rows left untouched keep the suggestion.
  const withSuggestions = useCallback((rows) => rows.map(r => {
    if (typeof r.mappedTo === 'string') return r;
    const hit = referenceUtilityNames.length
      ? findFuzzyMatch(r.name, referenceUtilityNames, { threshold: NAME_MAP_SUGGEST_THRESHOLD })
      : null;
    return { ...r, mappedTo: hit?.name || '' };
  }), [referenceUtilityNames]);

  const persistNameMap = useCallback(async (rows) => {
    setNameMapList(rows);
    try { await saveListToIDB(NAME_MAP_LIST_KEY, rows); } catch { /* IDB best-effort */ }
  }, []);

  const handleNameMapUpload = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (nameMapFileRef.current) nameMapFileRef.current.value = '';
    if (!file) return;
    setNameMapBusy(true);
    setNameMapError('');
    try {
      const buf = await file.arrayBuffer();
      const { rows, headers } = parseBestSheet(buf);
      if (!rows.length) throw new Error('No data rows found in the file.');
      const nameCol = pickColumn(headers, /\b(utility|provider|lse|ldc|company|name)\b/i, headers[0] || '');
      const commodityCol = pickColumn(headers, /commodity|fuel|\bservice\s*type\b|\b(electric|electricity|gas|water)\b/i);
      const stateCol = pickColumn(headers, /\b(state|province|st|prov|region)\b/i);
      const countryCol = pickColumn(headers, /\b(country|nation)\b/i);
      const statusCol = pickColumn(headers, /\bstatus\b|\bstage\b|disposition|outreach|\bactive\b|availab/i);
      const requirementsCol = pickColumn(headers, /requirement|comment|note|remark/i);
      const parsed = rows
        .map(r => ({
          ...r,
          name: String(r[nameCol] ?? '').trim(),
          commodity: commodityCol ? String(r[commodityCol] ?? '').trim() : '',
          state: stateCol ? String(r[stateCol] ?? '').trim() : '',
          country: countryCol ? String(r[countryCol] ?? '').trim() : '',
          status: statusCol ? String(r[statusCol] ?? '').trim() : '',
          requirements: requirementsCol ? String(r[requirementsCol] ?? '').trim() : '',
          _fileName: file.name,
          _nameCol: nameCol,
        }))
        .filter(r => r.name);
      if (!parsed.length) throw new Error('No utility names found in the chosen name column.');
      await persistNameMap(withSuggestions(parsed));
      setNameMapMeta({ fileName: file.name, count: parsed.length, nameCol });
    } catch (err) {
      setNameMapError(err?.message || 'Failed to read the utilities file.');
    } finally {
      setNameMapBusy(false);
    }
  }, [persistNameMap, withSuggestions]);

  const handleNameMapPasteImport = useCallback(async (parsed, pasteMeta) => {
    setNameMapBusy(true);
    setNameMapError('');
    try {
      await persistNameMap(withSuggestions(parsed));
      setNameMapMeta(pasteMeta);
      setShowNameMapPaste(false);
    } catch (err) {
      setNameMapError(err?.message || 'Failed to import the pasted utilities.');
    } finally {
      setNameMapBusy(false);
    }
  }, [persistNameMap, withSuggestions]);

  const handleNameMapClear = useCallback(async () => {
    if (!window.confirm('Remove the uploaded utility name-mapping list?')) return;
    await clearListFromIDB(NAME_MAP_LIST_KEY);
    setNameMapList([]);
    setNameMapMeta(null);
    setNameMapFilter('');
  }, []);

  // Update a single row's mapped reference name (or clear it) and persist.
  const setRowMapping = useCallback((idx, value) => {
    setNameMapList(prev => {
      const next = prev.map((r, i) => (i === idx ? { ...r, mappedTo: value } : r));
      saveListToIDB(NAME_MAP_LIST_KEY, next).catch(() => { /* best-effort */ });
      return next;
    });
  }, []);

  // Update an arbitrary editable field on a single row (e.g. the pasteable
  // free-text `status`) and persist.
  const setRowField = useCallback((idx, key, value) => {
    setNameMapList(prev => {
      const next = prev.map((r, i) => (i === idx ? { ...r, [key]: value } : r));
      saveListToIDB(NAME_MAP_LIST_KEY, next).catch(() => { /* best-effort */ });
      return next;
    });
  }, []);

  // Merge a pasted "utility name → status" list onto the existing rows.
  // Match the pasted name to each uploaded name by exact (case-insensitive)
  // hit first, then fuzzy match so minor spelling differences still land.
  const handleStatusPasteImport = useCallback(async (parsed) => {
    const pasted = (parsed || []).filter(p => String(p.name || '').trim());
    const byName = new Map();
    for (const p of pasted) {
      const k = String(p.name).trim().toLowerCase();
      if (!byName.has(k)) byName.set(k, String(p.status ?? '').trim());
    }
    const pastedNames = pasted.map(p => p.name);
    let matched = 0;
    setNameMapList(prev => {
      const next = prev.map(r => {
        const key = String(r.name || '').trim().toLowerCase();
        let status = byName.has(key) ? byName.get(key) : undefined;
        if (status === undefined && pastedNames.length) {
          const hit = findFuzzyMatch(r.name, pastedNames, { threshold: 60 });
          if (hit) status = byName.get(String(hit.name).trim().toLowerCase());
        }
        if (status === undefined) return r;
        matched++;
        return { ...r, status };
      });
      saveListToIDB(NAME_MAP_LIST_KEY, next).catch(() => { /* best-effort */ });
      return next;
    });
    setShowStatusPaste(false);
    setNameMapError(matched ? '' : 'No pasted statuses matched an uploaded utility name.');
  }, []);

  function downloadNameMapTemplate() {
    const ws = XLSX.utils.aoa_to_sheet([
      ['Utility', 'Commodity', 'State', 'Country', 'Status', 'Requirements / Comments'],
      ['Pacific Gas & Electric', 'Electric', 'CA', 'USA', '', 'Needs LOA before bid'],
      ['Consolidated Edison', 'Gas', 'NY', 'USA', '', ''],
      ['Hydro One', 'Electric', 'ON', 'Canada', '', ''],
    ]);
    ws['!cols'] = [{ wch: 32 }, { wch: 14 }, { wch: 10 }, { wch: 14 }, { wch: 14 }, { wch: 32 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Utilities');
    const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const url = URL.createObjectURL(new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'Utility Name Mapping Template.xlsx';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  // Export the styled utility-mapping analysis (NAM + Global maps + Site
  // Detail). The geographic render + per-site classification live in
  // SitesView (which holds the full uploaded site rows + geo data); we
  // hand it the Utility Name Mapping table this view maintains so each
  // site's electric utility is classified by its mapping there.
  async function handleExportSiteMapping() {
    if (!onExportSiteMapping) return;
    setNameMapError('');
    setExporting(true);
    try {
      await onExportSiteMapping(nameMapList);
    } catch (err) {
      setNameMapError(err?.message || 'Failed to export the utility-mapping analysis.');
    } finally {
      setExporting(false);
    }
  }

  // Sorted, de-duped reference utility names for the datalist the user
  // picks from. A single shared <datalist> backs every row's input, so
  // hundreds of reference names cost one render rather than one per row.
  const referenceOptions = useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const n of referenceUtilityNames) {
      const t = String(n || '').trim();
      if (!t || seen.has(t)) continue;
      seen.add(t);
      out.push(t);
    }
    return out.sort((a, b) => a.localeCompare(b));
  }, [referenceUtilityNames]);
  const referenceSet = useMemo(() => new Set(referenceOptions), [referenceOptions]);

  const nameMapStats = useMemo(() => {
    let mapped = 0;
    let unmatched = 0; // mappedTo set but not a known reference name
    for (const r of nameMapList) {
      const v = String(r.mappedTo || '').trim();
      if (!v) continue;
      if (referenceSet.has(v)) mapped++;
      else unmatched++;
    }
    return { mapped, unmatched, unmapped: nameMapList.length - mapped - unmatched };
  }, [nameMapList, referenceSet]);

  // Plain-text value of a column for a row — used by both the per-column
  // header search and (for the derived `mapping` column) as the display
  // fallback. `mapping` has no stored field, so its text is computed from
  // the same logic the cell renders.
  const getColText = useCallback((key, r) => {
    switch (key) {
      case 'mapping': {
        const v = String(r.mappedTo || '').trim();
        if (!v) return 'Unmapped';
        return referenceSet.has(v) ? 'Mapped' : 'Not a known utility';
      }
      default:
        return String(r[key] ?? '');
    }
  }, [referenceSet]);

  // Filtered view of the uploaded name-map rows. Keep the original index on
  // each row so edits write back to the right entry in nameMapList. Rows
  // must pass the global filter (name/mapped) AND every active per-column
  // header search.
  const filteredNameMap = useMemo(() => {
    const q = nameMapFilter.trim().toLowerCase();
    const colQueries = NAME_MAP_COLUMNS
      .map(c => [c.key, String(colSearch[c.key] || '').trim().toLowerCase()])
      .filter(([, val]) => val);
    const indexed = nameMapList.map((r, idx) => ({ r, idx }));
    if (!q && !colQueries.length) return indexed;
    return indexed.filter(({ r, idx }) => {
      if (q && !(
        String(r.name || '').toLowerCase().includes(q) ||
        String(r.mappedTo || '').toLowerCase().includes(q)
      )) return false;
      for (const [key, val] of colQueries) {
        if (!getColText(key, r, idx).toLowerCase().includes(val)) return false;
      }
      return true;
    });
  }, [nameMapList, nameMapFilter, colSearch, getColText]);

  const visibleColumns = useMemo(
    () => NAME_MAP_COLUMNS.filter(c => colVisible[c.key] !== false),
    [colVisible],
  );
  const tableWidth = useMemo(
    () => visibleColumns.reduce((sum, c) => sum + (colWidths[c.key] ?? c.width), 0),
    [visibleColumns, colWidths],
  );

  const card = { flex: 1, minWidth: 140, padding: '0.75rem 1rem', borderRadius: 8, border: '1px solid var(--color-border)', background: '#fff' };
  const cardNum = { fontSize: '1.4rem', fontWeight: 700, lineHeight: 1.1 };
  const cardLabel = { fontSize: '0.72rem', color: 'var(--color-text-muted)', marginTop: 2 };

  const cellInputStyle = { width: '100%', boxSizing: 'border-box', padding: '0.3rem 0.5rem', border: '1px solid var(--color-border)', borderRadius: 5, fontSize: '0.78rem', fontFamily: 'inherit', background: '#fff' };

  // Render a single table cell for a column key. Editable columns (mappedTo,
  // status) render inputs; mapping renders a derived indicator.
  function renderCell(key, r, idx) {
    switch (key) {
      case 'name':
        return <span style={{ fontWeight: 600, color: '#1E293B' }}>{r.name}</span>;
      case 'commodity':
      case 'state':
      case 'country':
        return r[key] ? <span style={{ color: 'var(--color-text-muted)' }}>{r[key]}</span> : <span style={{ color: '#CBD5E1' }}>—</span>;
      case 'mappedTo':
        return (
          <input
            type="text"
            list="utility-name-map-options"
            value={r.mappedTo || ''}
            onChange={e => setRowMapping(idx, e.target.value)}
            placeholder="— pick a known utility —"
            style={cellInputStyle}
          />
        );
      case 'status':
        return (
          <input
            type="text"
            value={r.status || ''}
            onChange={e => setRowField(idx, 'status', e.target.value)}
            placeholder="—"
            style={cellInputStyle}
          />
        );
      case 'requirements':
        return (
          <input
            type="text"
            value={r.requirements || ''}
            onChange={e => setRowField(idx, 'requirements', e.target.value)}
            placeholder="—"
            style={cellInputStyle}
          />
        );
      case 'mapping': {
        const v = String(r.mappedTo || '').trim();
        const known = !!v && referenceSet.has(v);
        if (!v) return <span style={{ color: '#92400E', fontWeight: 600 }}>Unmapped</span>;
        return known ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: '#166534', fontWeight: 600 }}>
            <span aria-hidden="true">✓</span>Mapped
          </span>
        ) : (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: '#B91C1C', fontWeight: 600 }} title="This value isn't one of the app's known utility names.">
            <span aria-hidden="true">⚠</span>Not a known utility
          </span>
        );
      }
      default:
        return null;
    }
  }

  return (
    <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '0.75rem 1rem 2rem' }}>
      <div>
        <div className={styles.header}>
          <div>
            <h1 className={styles.title}>Utility Name Mapping</h1>
            <div className={styles.subtitle}>
              Upload a list of utility names (with optional commodity, state, and country) and map each one to the
              app's known utility names. Suggestions are pre-filled by fuzzy match — confirm or override per row.
            </div>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <input
              ref={nameMapFileRef}
              type="file"
              accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={handleNameMapUpload}
              style={{ display: 'none' }}
            />
            <button
              type="button"
              onClick={downloadNameMapTemplate}
              title="Download a template: Utility name + Commodity + State + Country."
              style={{ padding: '0.4rem 0.8rem', border: '1px solid var(--color-border)', background: '#fff', borderRadius: 6, fontSize: '0.8rem', cursor: 'pointer', fontFamily: 'inherit', color: '#1E293B' }}
            >⬇ Template</button>
            <button
              type="button"
              disabled={nameMapBusy}
              onClick={() => { setNameMapError(''); setShowNameMapPaste(true); }}
              title="Paste utility rows copied from Excel / Google Sheets and map the columns."
              style={{ padding: '0.4rem 0.8rem', border: '1px solid var(--color-border)', background: '#fff', borderRadius: 6, fontSize: '0.8rem', cursor: 'pointer', fontFamily: 'inherit', color: '#1E293B' }}
            >📋 Paste Data</button>
            {nameMapList.length > 0 && (
              <button
                type="button"
                disabled={nameMapBusy}
                onClick={() => { setNameMapError(''); setShowStatusPaste(true); }}
                title="Paste a utility-name + status list to fill the Status column, matched by name."
                style={{ padding: '0.4rem 0.8rem', border: '1px solid var(--color-border)', background: '#fff', borderRadius: 6, fontSize: '0.8rem', cursor: 'pointer', fontFamily: 'inherit', color: '#1E293B' }}
              >📋 Paste Status</button>
            )}
            <button
              type="button"
              disabled={nameMapBusy}
              onClick={() => nameMapFileRef.current?.click()}
              title="Upload an Excel/CSV list of utility names to map."
              style={{ padding: '0.4rem 0.8rem', border: '1px solid var(--color-border)', background: '#fff', borderRadius: 6, fontSize: '0.8rem', cursor: 'pointer', fontFamily: 'inherit' }}
            >{nameMapBusy ? 'Working…' : (nameMapList.length ? 'Replace List' : 'Upload Utilities List')}</button>
            {(() => {
              const noSites = siteUtilities.length === 0;
              const noMap = nameMapList.length === 0;
              const disabled = nameMapBusy || exporting || noSites || noMap;
              const title = noSites
                ? 'Upload your site list on the Utility Lookup tab first.'
                : noMap
                  ? 'Upload or paste a utility list in this section first so each site’s utility can be classified.'
                  : 'Download the styled analysis: NAM + Global utility-mapping coverage maps plus a per-site detail tab.';
              return (
                <button
                  type="button"
                  disabled={disabled}
                  onClick={handleExportSiteMapping}
                  title={title}
                  style={{ padding: '0.4rem 0.9rem', border: '1px solid', borderColor: disabled ? 'var(--color-border)' : '#009530', background: disabled ? '#F1F5F9' : '#009530', borderRadius: 6, fontSize: '0.8rem', fontWeight: 600, cursor: disabled ? 'not-allowed' : 'pointer', fontFamily: 'inherit', color: disabled ? '#94A3B8' : '#fff' }}
                >{exporting ? 'Exporting…' : '⬇ Download Analysis'}</button>
              );
            })()}
            {nameMapList.length > 0 && (
              <button
                type="button"
                disabled={nameMapBusy}
                onClick={handleNameMapClear}
                style={{ padding: '0.4rem 0.8rem', border: '1px solid #FCA5A5', background: '#fff', color: '#B91C1C', borderRadius: 6, fontSize: '0.8rem', cursor: 'pointer', fontFamily: 'inherit' }}
              >Clear</button>
            )}
          </div>
        </div>

        {(siteUtilities.length === 0 || nameMapList.length === 0) && (
          <div style={{ margin: '0.25rem 0 0', fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
            <strong>⬇ Download Analysis</strong> needs both: sites on the <strong>Utility Lookup</strong> tab
            {' '}({siteUtilities.length > 0 ? '✓ loaded' : 'not loaded'}) and a utility list in this section
            {' '}({nameMapList.length > 0 ? '✓ loaded' : 'upload or paste one'}).
          </div>
        )}

        {nameMapError && (
          <div style={{ margin: '0.5rem 0', padding: '0.5rem 0.75rem', borderRadius: 6, background: '#FEF2F2', border: '1px solid #FECACA', color: '#B91C1C', fontSize: '0.8rem' }}>
            {nameMapError}
          </div>
        )}

        {nameMapList.length === 0 ? (
          <div style={{ marginTop: '1rem', padding: '1.5rem', borderRadius: 8, border: '1px dashed var(--color-border)', background: '#F8FAFC', color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
            No utility list uploaded yet. Upload (or paste) a list with a utility-name column — plus optional Commodity,
            State, and Country columns — and each name will be matched against the {referenceOptions.length.toLocaleString()} known
            utilities so you can confirm the mapping.
          </div>
        ) : (
          <>
            {nameMapMeta && (
              <div style={{ margin: '0.25rem 0 0.75rem', fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                ✓ {nameMapMeta.count.toLocaleString()} utilities loaded from <strong>{nameMapMeta.fileName}</strong>
                {' '}· matching on “{nameMapMeta.nameCol}”
              </div>
            )}
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', margin: '0.5rem 0 1rem' }}>
              <div style={card}>
                <div style={{ ...cardNum, color: '#166534' }}>{nameMapStats.mapped.toLocaleString()}</div>
                <div style={cardLabel}>mapped to a known utility</div>
              </div>
              <div style={card}>
                <div style={{ ...cardNum, color: nameMapStats.unmapped ? '#92400E' : '#1E293B' }}>{nameMapStats.unmapped.toLocaleString()}</div>
                <div style={cardLabel}>not yet mapped</div>
              </div>
              {nameMapStats.unmatched > 0 && (
                <div style={card}>
                  <div style={{ ...cardNum, color: '#B91C1C' }}>{nameMapStats.unmatched.toLocaleString()}</div>
                  <div style={cardLabel}>mapped value not a known utility</div>
                </div>
              )}
            </div>

            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
              <input
                type="text"
                value={nameMapFilter}
                onChange={e => setNameMapFilter(e.target.value)}
                placeholder="Filter by uploaded or mapped name…"
                style={{ width: 'min(360px, 100%)', padding: '0.4rem 0.6rem', border: '1px solid var(--color-border)', borderRadius: 6, fontSize: '0.8rem', fontFamily: 'inherit' }}
              />
              {/* Column-visibility menu. The wrapper stops the document click
                  listener from closing the menu when interacting inside it. */}
              <div style={{ position: 'relative' }} onClick={e => e.stopPropagation()}>
                <button
                  type="button"
                  onClick={() => setShowColMenu(s => !s)}
                  title="Choose which columns are visible."
                  style={{ padding: '0.4rem 0.8rem', border: '1px solid var(--color-border)', background: '#fff', borderRadius: 6, fontSize: '0.8rem', cursor: 'pointer', fontFamily: 'inherit', color: '#1E293B' }}
                >▦ Columns ▾</button>
                {showColMenu && (
                  <div style={{ position: 'absolute', zIndex: 20, top: '100%', left: 0, marginTop: 4, background: '#fff', border: '1px solid var(--color-border)', borderRadius: 6, boxShadow: '0 4px 16px rgba(15, 23, 42, 0.15)', padding: '0.4rem', minWidth: 200 }}>
                    {NAME_MAP_COLUMNS.map(c => (
                      <label key={c.key} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0.25rem 0.35rem', fontSize: '0.78rem', cursor: 'pointer', color: '#1E293B' }}>
                        <input
                          type="checkbox"
                          checked={colVisible[c.key] !== false}
                          onChange={() => toggleColumn(c.key)}
                        />
                        {c.label}
                      </label>
                    ))}
                    <div style={{ borderTop: '1px solid var(--color-border)', marginTop: 4, paddingTop: 4 }}>
                      <button
                        type="button"
                        onClick={() => { setColVisible({ ...DEFAULT_COL_VISIBLE }); setColWidths({ ...DEFAULT_COL_WIDTHS }); }}
                        style={{ width: '100%', padding: '0.3rem 0.4rem', border: 'none', background: 'transparent', borderRadius: 4, fontSize: '0.75rem', cursor: 'pointer', fontFamily: 'inherit', color: '#475569', textAlign: 'left' }}
                      >Reset columns &amp; widths</button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* One shared datalist backs every row's input. */}
            <datalist id="utility-name-map-options">
              {referenceOptions.map(n => <option key={n} value={n} />)}
            </datalist>

            <div style={{ overflowX: 'auto', border: '1px solid var(--color-border)', borderRadius: 6 }}>
              <table style={{ borderCollapse: 'collapse', fontSize: '0.8rem', tableLayout: 'fixed', width: tableWidth }}>
                <colgroup>
                  {visibleColumns.map(c => (
                    <col key={c.key} style={{ width: colWidths[c.key] ?? c.width }} />
                  ))}
                </colgroup>
                <thead>
                  <tr style={{ textAlign: 'left', borderBottom: '2px solid var(--color-border)' }}>
                    {visibleColumns.map(c => (
                      <th key={c.key} style={{ padding: '0.4rem 0.5rem', position: 'relative', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                        {c.label}
                        {/* Drag handle on the right edge to resize this column. */}
                        <span
                          onMouseDown={e => onResizeStart(c.key, e)}
                          title="Drag to resize"
                          style={{ position: 'absolute', top: 0, right: 0, width: 8, height: '100%', cursor: 'col-resize', userSelect: 'none' }}
                        />
                      </th>
                    ))}
                  </tr>
                  <tr style={{ borderBottom: '1px solid var(--color-border)', background: '#F8FAFC' }}>
                    {visibleColumns.map(c => (
                      <th key={c.key} style={{ padding: '0.2rem 0.4rem' }}>
                        <input
                          type="text"
                          value={colSearch[c.key] || ''}
                          onChange={e => setColSearch(prev => ({ ...prev, [c.key]: e.target.value }))}
                          placeholder="Search…"
                          style={{ width: '100%', boxSizing: 'border-box', padding: '0.2rem 0.35rem', border: '1px solid var(--color-border)', borderRadius: 4, fontSize: '0.72rem', fontFamily: 'inherit', fontWeight: 400 }}
                        />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredNameMap.map(({ r, idx }) => (
                    <tr key={idx} style={{ borderBottom: '1px solid var(--color-border)' }}>
                      {visibleColumns.map(c => (
                        <td
                          key={c.key}
                          style={{ padding: '0.4rem 0.5rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: (c.key === 'mappedTo' || c.key === 'status') ? 'normal' : 'nowrap', color: (c.key === 'commodity' || c.key === 'state' || c.key === 'country') ? 'var(--color-text-muted)' : undefined }}
                        >
                          {renderCell(c.key, r, idx)}
                        </td>
                      ))}
                    </tr>
                  ))}
                  {filteredNameMap.length === 0 && (
                    <tr><td colSpan={visibleColumns.length} style={{ padding: '0.75rem 0.5rem', color: 'var(--color-text-muted)', fontStyle: 'italic' }}>No rows match the current filters.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {showNameMapPaste && (
        <UtilityPasteImportModal
          title="Paste utility names to map"
          fields={NAME_MAP_FIELDS}
          onClose={() => setShowNameMapPaste(false)}
          onImport={handleNameMapPasteImport}
        />
      )}

      {showStatusPaste && (
        <UtilityPasteImportModal
          title="Paste utility statuses"
          fields={STATUS_FIELDS}
          onClose={() => setShowStatusPaste(false)}
          onImport={handleStatusPasteImport}
        />
      )}
    </div>
  );
}
