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

// IndexedDB key for the uploaded "utilities → interval data availability"
// list. Mirrors the SITES_STORAGE_KEY / utility-rates pattern so the list
// survives refreshes and syncs to Firestore via uploadedListStore.
const INTERVAL_LIST_KEY = 'utility-interval-list-override';

// IndexedDB key for the second section's uploaded utility list — the one
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
  { key: 'mapping', label: 'Mapping', width: 140 },
  { key: 'interval', label: 'Interval Data', width: 140 },
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

// Header heuristics for the two columns we care about in the uploaded
// file: the utility/provider name, and the interval-data-availability
// flag. Everything else on the row is preserved as-is so the user can
// keep extra notes columns in their source file.
function pickUtilityNameColumn(headers) {
  return headers.find(h => /\b(utility|provider|lse|ldc|company|name)\b/i.test(String(h))) || headers[0] || '';
}
function pickIntervalColumn(headers) {
  return headers.find(h => /interval|\bami\b|granular|smart\s*meter|green\s*button|availab/i.test(String(h))) || '';
}

// Interval data is "available" when the cell carries a real positive
// value. Treat the usual negatives / blanks / placeholders as
// unavailable; anything else (including a granularity like "15-min" or
// "hourly") counts as available.
function intervalIsAvailable(v) {
  const s = String(v ?? '').trim().toLowerCase();
  if (!s) return false;
  return !/^(no|n|none|false|0|unavailable|not\s*available|n\/a|na|tbd|unknown|-)$/.test(s);
}

export function UtilityMappingView({ siteUtilities = [], referenceUtilityNames = [], onExportSiteMapping }) {
  const [list, setList] = useState([]); // [{ name, interval, _raw }]
  const [meta, setMeta] = useState(null); // { fileName, count, nameCol, intervalCol }
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const [showPaste, setShowPaste] = useState(false);
  const fileRef = useRef(null);

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

  // Restore any previously-uploaded list on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const saved = await loadListFromIDB(INTERVAL_LIST_KEY);
      if (cancelled || !Array.isArray(saved) || saved.length === 0) return;
      setList(saved);
      const first = saved[0] || {};
      setMeta({
        fileName: first._fileName || 'saved list',
        count: saved.length,
        nameCol: first._nameCol || 'Utility',
        intervalCol: first._intervalCol || 'Interval Data',
      });
    })();
    return () => { cancelled = true; };
  }, []);

  const handleUpload = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (fileRef.current) fileRef.current.value = '';
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      const buf = await file.arrayBuffer();
      const { rows, headers } = parseBestSheet(buf);
      if (!rows.length) throw new Error('No data rows found in the file.');
      const nameCol = pickUtilityNameColumn(headers);
      const intervalCol = pickIntervalColumn(headers);
      if (!intervalCol) {
        throw new Error('Could not find an interval-data column. Add a column whose header includes "Interval", "AMI", "Granularity", or "Available".');
      }
      const parsed = rows
        .map(r => ({
          ...r,
          name: String(r[nameCol] ?? '').trim(),
          interval: String(r[intervalCol] ?? '').trim(),
          _fileName: file.name,
          _nameCol: nameCol,
          _intervalCol: intervalCol,
        }))
        .filter(r => r.name);
      if (!parsed.length) throw new Error('No utility names found in the chosen name column.');
      await saveListToIDB(INTERVAL_LIST_KEY, parsed);
      setList(parsed);
      setMeta({ fileName: file.name, count: parsed.length, nameCol, intervalCol });
    } catch (err) {
      setError(err?.message || 'Failed to read the utilities file.');
    } finally {
      setBusy(false);
    }
  }, []);

  const handleClear = useCallback(async () => {
    if (!window.confirm('Remove the uploaded utilities list?')) return;
    await clearListFromIDB(INTERVAL_LIST_KEY);
    setList([]);
    setMeta(null);
  }, []);

  // Pasted data arrives already parsed + column-mapped by the modal, in
  // the same row shape as handleUpload's `parsed`. Persist it the same
  // way so it survives refresh / Firestore sync.
  const handlePasteImport = useCallback(async (parsed, pasteMeta) => {
    setBusy(true);
    setError('');
    try {
      await saveListToIDB(INTERVAL_LIST_KEY, parsed);
      setList(parsed);
      setMeta(pasteMeta);
      setShowPaste(false);
    } catch (err) {
      setError(err?.message || 'Failed to import the pasted utilities.');
    } finally {
      setBusy(false);
    }
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
      const parsed = rows
        .map(r => ({
          ...r,
          name: String(r[nameCol] ?? '').trim(),
          commodity: commodityCol ? String(r[commodityCol] ?? '').trim() : '',
          state: stateCol ? String(r[stateCol] ?? '').trim() : '',
          country: countryCol ? String(r[countryCol] ?? '').trim() : '',
          status: statusCol ? String(r[statusCol] ?? '').trim() : '',
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
      ['Utility', 'Commodity', 'State', 'Country'],
      ['Pacific Gas & Electric', 'Electric', 'CA', 'USA'],
      ['Consolidated Edison', 'Gas', 'NY', 'USA'],
      ['Hydro One', 'Electric', 'ON', 'Canada'],
    ]);
    ws['!cols'] = [{ wch: 32 }, { wch: 14 }, { wch: 10 }, { wch: 14 }];
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

  function downloadTemplate() {
    const ws = XLSX.utils.aoa_to_sheet([
      ['Utility', 'Interval Data Available'],
      ['Pacific Gas & Electric', 'Yes'],
      ['Consolidated Edison', 'Hourly'],
      ['Some Municipal Utility', 'No'],
    ]);
    ws['!cols'] = [{ wch: 32 }, { wch: 24 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Utilities');
    const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const url = URL.createObjectURL(new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'Utility Interval Data Template.xlsx';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  // Export the styled site interval-data mapping (NAM map + Site Detail).
  // The geographic render + per-site classification live in SitesView
  // (which holds the full uploaded site rows + geo data); we hand it the
  // interval list this view already loaded.
  async function handleExportSiteMapping() {
    if (!onExportSiteMapping) return;
    setError('');
    setExporting(true);
    try {
      await onExportSiteMapping(list);
    } catch (err) {
      setError(err?.message || 'Failed to export the site interval-data mapping.');
    } finally {
      setExporting(false);
    }
  }

  // Resolve each list entry's interval value by utility name. Names are
  // matched fuzzily (same matcher the Utility Lookup uses) so "PG&E" in
  // the portfolio lines up with "Pacific Gas & Electric" in the list.
  const listNames = useMemo(() => list.map(r => r.name).filter(Boolean), [list]);
  const intervalByName = useMemo(() => {
    const m = new Map();
    for (const r of list) if (r.name) m.set(r.name, r.interval);
    return m;
  }, [list]);

  // Roll the portfolio's sites up by their matched electric utility, then
  // resolve interval-data availability for each utility from the list.
  const mapping = useMemo(() => {
    const byUtility = new Map(); // utility name -> site count
    let noUtility = 0;
    for (const s of siteUtilities) {
      const u = (s.electricUtility || '').trim();
      if (!u) { noUtility++; continue; }
      byUtility.set(u, (byUtility.get(u) || 0) + 1);
    }
    const utilities = [...byUtility.entries()].map(([utility, siteCount]) => {
      const hit = listNames.length ? findFuzzyMatch(utility, listNames, { threshold: 40 }) : null;
      const intervalRaw = hit ? intervalByName.get(hit.name) : null;
      const inList = !!hit;
      const available = inList && intervalIsAvailable(intervalRaw);
      return {
        utility,
        siteCount,
        inList,
        matchedName: hit?.name || '',
        interval: intervalRaw || '',
        available,
      };
    }).sort((a, b) => b.siteCount - a.siteCount || a.utility.localeCompare(b.utility));

    const sitesWithUtility = siteUtilities.length - noUtility;
    const availableSites = utilities.filter(u => u.available).reduce((n, u) => n + u.siteCount, 0);
    const unknownSites = utilities.filter(u => !u.inList).reduce((n, u) => n + u.siteCount, 0);
    return {
      utilities,
      noUtility,
      sitesWithUtility,
      availableSites,
      unknownSites,
      pct: sitesWithUtility > 0 ? Math.round((availableSites / sitesWithUtility) * 100) : 0,
    };
  }, [siteUtilities, listNames, intervalByName]);

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

  // Interval-data availability for each name-map row, resolved against the
  // list loaded in the first section. Look the utility up by its mapped
  // reference name when one is set (the canonical app name lines up best
  // with the interval list), otherwise by the uploaded name. Keyed by the
  // row's original index so the filtered table can read it directly. When
  // no interval list is loaded the map stays empty and the column shows a
  // muted hint instead of a status.
  const availabilityByIdx = useMemo(() => {
    const out = new Map();
    if (!listNames.length) return out;
    for (let i = 0; i < nameMapList.length; i++) {
      const r = nameMapList[i];
      const lookupName = String(r.mappedTo || '').trim() || String(r.name || '').trim();
      if (!lookupName) continue;
      const hit = findFuzzyMatch(lookupName, listNames, { threshold: 40 });
      if (!hit) { out.set(i, { inList: false }); continue; }
      const intervalRaw = intervalByName.get(hit.name);
      out.set(i, { inList: true, available: intervalIsAvailable(intervalRaw), interval: intervalRaw || '' });
    }
    return out;
  }, [nameMapList, listNames, intervalByName]);

  // Plain-text value of a column for a row — used by both the per-column
  // header search and (for derived columns) as the display fallback. The
  // `mapping` and `interval` columns have no stored field, so their text is
  // computed from the same logic the cells render.
  const getColText = useCallback((key, r, idx) => {
    switch (key) {
      case 'mapping': {
        const v = String(r.mappedTo || '').trim();
        if (!v) return 'Unmapped';
        return referenceSet.has(v) ? 'Mapped' : 'Not a known utility';
      }
      case 'interval': {
        if (!list.length) return '';
        const a = availabilityByIdx.get(idx);
        if (!a?.inList) return 'Not in list';
        return a.available ? (a.interval || 'Available') : (a.interval || 'Not available');
      }
      default:
        return String(r[key] ?? '');
    }
  }, [referenceSet, availabilityByIdx, list.length]);

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
  // status) render inputs; mapping / interval render derived indicators.
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
      case 'interval': {
        if (list.length === 0) {
          return <span style={{ color: '#CBD5E1' }} title="Upload an interval-data list in the section above to resolve availability.">—</span>;
        }
        const a = availabilityByIdx.get(idx);
        if (!a?.inList) return <span style={{ color: '#92400E', fontWeight: 600 }}>Not in list</span>;
        return a.available ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: '#166534', fontWeight: 600 }}>
            <span aria-hidden="true">✓</span>{a.interval || 'Available'}
          </span>
        ) : (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: '#B91C1C', fontWeight: 600 }}>
            <span aria-hidden="true">✗</span>{a.interval || 'Not available'}
          </span>
        );
      }
      default:
        return null;
    }
  }

  return (
    <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '0.75rem 1rem 2rem' }}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Utility Mapping</h1>
          <div className={styles.subtitle}>
            Map your Utility Lookup portfolio to interval-data availability using an uploaded list of utilities.
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={handleUpload}
            style={{ display: 'none' }}
          />
          <button
            type="button"
            onClick={downloadTemplate}
            title="Download a two-column template: Utility name + Interval Data Available."
            style={{ padding: '0.4rem 0.8rem', border: '1px solid var(--color-border)', background: '#fff', borderRadius: 6, fontSize: '0.8rem', cursor: 'pointer', fontFamily: 'inherit', color: '#1E293B' }}
          >⬇ Template</button>
          <button
            type="button"
            disabled={busy}
            onClick={() => { setError(''); setShowPaste(true); }}
            title="Paste utility rows copied from Excel / Google Sheets and map the columns."
            style={{ padding: '0.4rem 0.8rem', border: '1px solid var(--color-border)', background: '#fff', borderRadius: 6, fontSize: '0.8rem', cursor: 'pointer', fontFamily: 'inherit', color: '#1E293B' }}
          >📋 Paste Data</button>
          <button
            type="button"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
            title="Upload an Excel/CSV list of utilities with an interval-data-availability column."
            style={{ padding: '0.4rem 0.8rem', border: '1px solid var(--color-border)', background: '#fff', borderRadius: 6, fontSize: '0.8rem', cursor: 'pointer', fontFamily: 'inherit' }}
          >{busy ? 'Working…' : (list.length ? 'Replace Utilities List' : 'Upload Utilities List')}</button>
          {siteUtilities.length > 0 && (
            <button
              type="button"
              disabled={busy || exporting || list.length === 0}
              onClick={handleExportSiteMapping}
              title={list.length === 0
                ? 'Upload an interval-data list first so each site can be classified.'
                : 'Export a styled workbook: a North-America map of sites by interval-data coverage, plus a per-site detail tab.'}
              style={{ padding: '0.4rem 0.8rem', border: '1px solid var(--color-border)', background: '#fff', borderRadius: 6, fontSize: '0.8rem', cursor: (busy || exporting || list.length === 0) ? 'not-allowed' : 'pointer', fontFamily: 'inherit', color: '#1E293B', opacity: list.length === 0 ? 0.5 : 1 }}
            >{exporting ? 'Exporting…' : '⬇ Export Site Mapping'}</button>
          )}
          {list.length > 0 && (
            <button
              type="button"
              disabled={busy}
              onClick={handleClear}
              style={{ padding: '0.4rem 0.8rem', border: '1px solid #FCA5A5', background: '#fff', color: '#B91C1C', borderRadius: 6, fontSize: '0.8rem', cursor: 'pointer', fontFamily: 'inherit' }}
            >Clear</button>
          )}
        </div>
      </div>

      {error && (
        <div style={{ margin: '0.5rem 0', padding: '0.5rem 0.75rem', borderRadius: 6, background: '#FEF2F2', border: '1px solid #FECACA', color: '#B91C1C', fontSize: '0.8rem' }}>
          {error}
        </div>
      )}

      {list.length > 0 && meta && (
        <div style={{ margin: '0.25rem 0 0.75rem', fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
          ✓ {meta.count.toLocaleString()} utilities loaded from <strong>{meta.fileName}</strong>
          {' '}· matching on “{meta.nameCol}”, availability from “{meta.intervalCol}”
        </div>
      )}

      {list.length === 0 ? (
        <div style={{ marginTop: '1rem', padding: '1.5rem', borderRadius: 8, border: '1px dashed var(--color-border)', background: '#F8FAFC', color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
          No utilities list yet. Upload an Excel/CSV with a utility-name column and an interval-data-availability column
          (e.g. <em>Yes/No</em> or a granularity like <em>15-min</em>/<em>hourly</em>). The portfolio below is built from the
          sites loaded on the Utility Lookup tab.
        </div>
      ) : siteUtilities.length === 0 ? (
        <div style={{ marginTop: '1rem', padding: '1.5rem', borderRadius: 8, border: '1px dashed var(--color-border)', background: '#F8FAFC', color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
          No sites loaded. Upload a sites file on the <strong>Utility Lookup</strong> tab and they'll be mapped here automatically.
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', margin: '0.5rem 0 1rem' }}>
            <div style={card}>
              <div style={{ ...cardNum, color: '#166534' }}>{mapping.pct}%</div>
              <div style={cardLabel}>portfolio interval-data availability</div>
            </div>
            <div style={card}>
              <div style={cardNum}>{mapping.availableSites.toLocaleString()}<span style={{ fontSize: '0.9rem', color: 'var(--color-text-muted)', fontWeight: 500 }}> / {mapping.sitesWithUtility.toLocaleString()}</span></div>
              <div style={cardLabel}>sites with interval data available</div>
            </div>
            <div style={card}>
              <div style={{ ...cardNum, color: mapping.unknownSites ? '#92400E' : '#1E293B' }}>{mapping.unknownSites.toLocaleString()}</div>
              <div style={cardLabel}>sites on a utility not in the list</div>
            </div>
            {mapping.noUtility > 0 && (
              <div style={card}>
                <div style={{ ...cardNum, color: '#92400E' }}>{mapping.noUtility.toLocaleString()}</div>
                <div style={cardLabel}>sites with no utility identified</div>
              </div>
            )}
          </div>

          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '2px solid var(--color-border)' }}>
                <th style={{ padding: '0.4rem 0.5rem' }}>Electric Utility (from portfolio)</th>
                <th style={{ padding: '0.4rem 0.5rem', textAlign: 'right' }}># Sites</th>
                <th style={{ padding: '0.4rem 0.5rem' }}>Interval Data</th>
                <th style={{ padding: '0.4rem 0.5rem' }}>Matched list entry</th>
              </tr>
            </thead>
            <tbody>
              {mapping.utilities.map((u) => (
                <tr key={u.utility} style={{ borderBottom: '1px solid var(--color-border)' }}>
                  <td style={{ padding: '0.4rem 0.5rem', fontWeight: 600, color: '#1E293B' }}>{u.utility}</td>
                  <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right' }}>{u.siteCount.toLocaleString()}</td>
                  <td style={{ padding: '0.4rem 0.5rem' }}>
                    {!u.inList ? (
                      <span style={{ color: '#92400E', fontWeight: 600 }}>Not in list</span>
                    ) : u.available ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: '#166534', fontWeight: 600 }}>
                        <span aria-hidden="true">✓</span>{u.interval || 'Available'}
                      </span>
                    ) : (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: '#B91C1C', fontWeight: 600 }}>
                        <span aria-hidden="true">✗</span>{u.interval || 'Not available'}
                      </span>
                    )}
                  </td>
                  <td style={{ padding: '0.4rem 0.5rem', color: 'var(--color-text-muted)' }}>
                    {u.matchedName || <span style={{ color: '#CBD5E1' }}>—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {/* ---- Section 2: map uploaded utility names → known utilities --- */}
      <div style={{ marginTop: '2rem', paddingTop: '1.25rem', borderTop: '2px solid var(--color-border)' }}>
        <div className={styles.header}>
          <div>
            <h2 className={styles.title} style={{ fontSize: '1.05rem' }}>Utility Name Mapping</h2>
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

      {showPaste && (
        <UtilityPasteImportModal
          onClose={() => setShowPaste(false)}
          onImport={handlePasteImport}
        />
      )}

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
