import { useEffect, useMemo, useRef, useState, memo } from 'react';
import { createPortal } from 'react-dom';
import { CommitOnBlurInput } from '../common/CommitOnBlurInput';

// Marketing Leads subtab on the Contacts page. The user pastes a block
// copied from a Salesforce Leads list view; a column-mapping modal pops
// up so they can confirm which pasted column fills each lead field. The
// leads persist under settings.marketingLeads and sync through the same
// settings → Firestore pipeline every other list tab uses.

// Canonical columns, in the order the Salesforce list surfaces them.
// defaultWidth (px) can be resized by dragging a header edge; the widths
// persist via settings.marketingLeadsColumnWidths.
const COLUMNS = [
  { key: 'name',                label: 'Name',                       defaultWidth: 170 },
  { key: 'email',               label: 'Email',                      defaultWidth: 220 },
  { key: 'jobTitle',            label: 'Job Title',                  defaultWidth: 170 },
  { key: 'company',             label: 'Company',                    defaultWidth: 190 },
  { key: 'mappedCompany',       label: 'Company Mapping',            defaultWidth: 200 },
  { key: 'status',              label: 'Status',                     defaultWidth: 110 },
  { key: 'createdDate',         label: 'Created Date',               defaultWidth: 150 },
  { key: 'leadSource',          label: 'Last Lead Source',           defaultWidth: 150 },
  { key: 'owner',               label: 'Owner',                      defaultWidth: 120 },
  { key: 'country',             label: 'Country',                    defaultWidth: 100 },
  { key: 'qualificationDetail', label: 'Qualification Source Detail', defaultWidth: 220 },
  { key: 'tvStatus',            label: 'Table View',                 defaultWidth: 160, readonly: true },
];

const MIN_COLUMN_WIDTH = 60;
const MIN_VISIBLE_ROWS = 25;

// Target fields the paste-mapping modal can fill. Aliases match common
// Salesforce / Excel header conventions case- and punctuation-
// insensitively, so "Job Title", "jobtitle", "Title" all hit jobTitle.
const PASTE_TARGETS = [
  { key: 'name',                label: 'Name',                       required: true,
    aliases: ['name', 'fullname', 'leadname', 'contactname', 'contact'] },
  { key: 'email',               label: 'Email',                      required: false,
    aliases: ['email', 'emailaddress', 'workemail', 'e-mail'] },
  { key: 'jobTitle',            label: 'Job Title',                  required: false,
    aliases: ['jobtitle', 'title', 'position', 'role'] },
  { key: 'company',             label: 'Company',                    required: false,
    aliases: ['company', 'companyname', 'account', 'accountname', 'organization'] },
  { key: 'status',              label: 'Status',                     required: false,
    aliases: ['status', 'leadstatus'] },
  { key: 'createdDate',         label: 'Created Date',               required: false,
    aliases: ['createddate', 'created', 'datecreated', 'createdon', 'createddatetime'] },
  { key: 'leadSource',          label: 'Last Lead Source',           required: false,
    aliases: ['lastleadsource', 'leadsource', 'source'] },
  { key: 'owner',               label: 'Owner',                      required: false,
    aliases: ['owner', 'leadowner', 'ownername', 'accountowner', 'ownerfullname'] },
  { key: 'country',             label: 'Country',                    required: false,
    aliases: ['country', 'countrycode', 'mailingcountry', 'billingcountry'] },
  { key: 'qualificationDetail', label: 'Qualification Source Detail', required: false,
    aliases: ['qualificationsourcedetail', 'qualificationdetail', 'qualificationsource', 'sourcedetail'] },
];

const EDITABLE_KEYS = COLUMNS.filter(c => !c.readonly).map(c => c.key);

function makeId() {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function emptyRow() {
  const r = { id: makeId() };
  for (const k of EDITABLE_KEYS) r[k] = '';
  return r;
}

// Tab / comma / semicolon-tolerant split for a clipboard row — handles
// Excel + Salesforce ("Ana Higueras<TAB>ana@x.com<TAB>…") and the
// occasional CSV that leaks in from a spreadsheet export.
function splitPasteRow(line) {
  if (line.includes('\t')) return line.split('\t');
  return line.split(/,(?![^"]*"\s*(?:,|$))|;/).map(s => s.replace(/^"|"$/g, ''));
}

function normaliseHeader(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Build a default header → target-key mapping. Each header is matched
// case- and punctuation-insensitively against every target's aliases;
// the first hit wins so a header can't accidentally double-map.
function autoDetectMapping(headers) {
  const mapping = {}; // targetKey → header
  const used = new Set();
  for (const t of PASTE_TARGETS) {
    for (const h of headers) {
      if (used.has(h)) continue;
      if (t.aliases.includes(normaliseHeader(h))) {
        mapping[t.key] = h;
        used.add(h);
        break;
      }
    }
  }
  return mapping;
}

function companyKey(s) {
  return String(s || '').toLowerCase().trim();
}

// Placeholder Table View company names ("N/A", "TBD", a lone dash, …)
// that shouldn't pollute the mapping autocomplete or fuzzy index.
function isPlaceholderCompany(s) {
  const t = String(s || '').trim();
  if (!t) return true;
  if (/^[-—–_]+$/.test(t)) return true;
  if (/^(n\.?a\.?|n\/a|none|null|tbd|unknown|\?|\.|test)$/i.test(t)) return true;
  return false;
}

// Inline autocomplete for the Company Mapping cell — filters the Table
// View company list by prefix-then-substring as the user types; ↑ / ↓
// navigates, Enter / click commits, Escape cancels. Local state until
// commit so the table doesn't re-render on every keystroke. Ported from
// the Zoom Info view's company picker.
const CompanyAutocomplete = memo(function CompanyAutocomplete({ value, onCommit, suggestions, placeholder, style }) {
  const [draft, setDraft] = useState(value ?? '');
  const [open, setOpen] = useState(false);
  const [hoverIdx, setHoverIdx] = useState(0);
  const wrapRef = useRef(null);
  const lastExternal = useRef(value ?? '');

  useEffect(() => {
    const v = value ?? '';
    if (v !== lastExternal.current) { lastExternal.current = v; setDraft(v); }
  }, [value]);

  useEffect(() => {
    if (!open) return;
    function onDocDown(e) { if (!wrapRef.current?.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', onDocDown);
    return () => document.removeEventListener('mousedown', onDocDown);
  }, [open]);

  const matches = useMemo(() => {
    const q = draft.trim().toLowerCase();
    if (!q || !suggestions?.length) return [];
    const prefix = [];
    const sub = [];
    for (const s of suggestions) {
      const lower = String(s).toLowerCase();
      if (lower === q) continue;
      if (lower.startsWith(q)) prefix.push(s);
      else if (lower.includes(q)) sub.push(s);
      if (prefix.length + sub.length >= 25) break;
    }
    return [...prefix, ...sub].slice(0, 8);
  }, [draft, suggestions]);

  function commit(v) {
    const next = v ?? draft;
    if (next !== lastExternal.current) { lastExternal.current = next; onCommit(next); }
    setOpen(false);
  }

  function handleKey(e) {
    if (open && matches.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setHoverIdx(i => (i + 1) % matches.length); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setHoverIdx(i => (i - 1 + matches.length) % matches.length); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); const pick = matches[hoverIdx] || matches[0]; setDraft(pick); commit(pick); return; }
      if (e.key === 'Escape') { e.preventDefault(); setOpen(false); return; }
    }
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <input
        type="text"
        value={draft}
        onChange={e => { setDraft(e.target.value); setOpen(true); setHoverIdx(0); }}
        onFocus={() => setOpen(true)}
        onBlur={() => { requestAnimationFrame(() => { if (!wrapRef.current?.contains(document.activeElement)) commit(); }); }}
        onKeyDown={handleKey}
        placeholder={placeholder}
        style={style}
      />
      {open && matches.length > 0 && (
        <div
          onMouseDown={e => e.preventDefault()}
          style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 5, background: '#fff', border: '1px solid var(--color-border)', borderRadius: 4, boxShadow: '0 8px 20px rgba(15, 23, 42, 0.12)', maxHeight: 220, overflowY: 'auto', fontSize: '0.78rem' }}
        >
          {matches.map((m, i) => (
            <div
              key={m + i}
              onClick={() => { setDraft(m); commit(m); }}
              onMouseEnter={() => setHoverIdx(i)}
              style={{ padding: '0.35rem 0.6rem', cursor: 'pointer', background: i === hoverIdx ? '#DCFCE7' : 'transparent', color: i === hoverIdx ? '#166534' : '#1E293B', fontWeight: i === hoverIdx ? 700 : 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
            >{m}</div>
          ))}
        </div>
      )}
    </div>
  );
});

export function MarketingLeadsView({ prospects = [], settings, updateSettings, onAddProspect }) {
  const persistedRows = useMemo(() => {
    const arr = Array.isArray(settings?.marketingLeads) ? settings.marketingLeads : [];
    return arr.map(r => ({ ...emptyRow(), ...r, id: r.id || makeId() }));
  }, [settings]);

  const [search, setSearch] = useState('');
  // Click-to-sort state (display-only; not persisted). sortDir cycles
  // asc → desc → none as the user re-clicks a header.
  const [sortKey, setSortKey] = useState('');
  const [sortDir, setSortDir] = useState('asc'); // 'asc' | 'desc'
  // Per-column contains-filters, keyed by column key. Shown in a filter
  // row under the header when the "Filters" toggle is on.
  const [columnFilters, setColumnFilters] = useState({});
  const [filtersOpen, setFiltersOpen] = useState(false);

  function cycleSort(key) {
    if (sortKey !== key) { setSortKey(key); setSortDir('asc'); return; }
    if (sortDir === 'asc') { setSortDir('desc'); return; }
    // Was descending → clear the sort back to natural (paste) order.
    setSortKey('');
    setSortDir('asc');
  }
  function setColumnFilter(key, value) {
    setColumnFilters(prev => {
      const next = { ...prev };
      if (value) next[key] = value; else delete next[key];
      return next;
    });
  }
  function clearAllFilters() {
    setColumnFilters({});
    setSearch('');
  }

  // Column visibility — toggleable via the "Columns" dropdown, persisted
  // via settings.marketingLeadsVisibleCols. Falls back to every column
  // visible when nothing has been saved.
  const visibleCols = useMemo(() => {
    const saved = settings?.marketingLeadsVisibleCols;
    if (Array.isArray(saved) && saved.length) return new Set(saved);
    return new Set(COLUMNS.map(c => c.key));
  }, [settings]);

  function setColVisible(key, on) {
    const next = new Set(visibleCols);
    if (on) next.add(key); else next.delete(key);
    if (next.size === 0) next.add('name'); // never hide everything
    updateSettings({ marketingLeadsVisibleCols: [...next] });
  }
  const visibleColumnList = useMemo(
    () => COLUMNS.filter(c => visibleCols.has(c.key)),
    [visibleCols],
  );

  const [colsPickerOpen, setColsPickerOpen] = useState(false);
  const colsPickerRef = useRef(null);
  useEffect(() => {
    if (!colsPickerOpen) return;
    function onDocDown(e) {
      if (!colsPickerRef.current?.contains(e.target)) setColsPickerOpen(false);
    }
    document.addEventListener('mousedown', onDocDown);
    return () => document.removeEventListener('mousedown', onDocDown);
  }, [colsPickerOpen]);

  // Column widths (px), keyed by column.key so a future re-order doesn't
  // scramble saved widths. Hydrates from settings on every render.
  const columnWidths = useMemo(() => {
    const saved = settings?.marketingLeadsColumnWidths || {};
    const out = {};
    for (const c of COLUMNS) {
      const v = Number(saved[c.key]);
      out[c.key] = Number.isFinite(v) && v >= MIN_COLUMN_WIDTH ? v : c.defaultWidth;
    }
    return out;
  }, [settings]);

  const dragRef = useRef(null);
  const colRefs = useRef({});
  function startResize(e, colKey) {
    e.preventDefault();
    e.stopPropagation();
    const colEl = colRefs.current[colKey];
    if (!colEl) return;
    dragRef.current = {
      key: colKey,
      startX: e.clientX,
      startWidth: columnWidths[colKey] || COLUMNS.find(c => c.key === colKey)?.defaultWidth || 120,
      colEl,
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    function onMove(ev) {
      const drag = dragRef.current;
      if (!drag) return;
      const next = Math.max(MIN_COLUMN_WIDTH, drag.startWidth + (ev.clientX - drag.startX));
      drag.colEl.style.width = `${next}px`;
      drag.lastWidth = next;
    }
    function onUp() {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      const drag = dragRef.current;
      dragRef.current = null;
      if (drag && drag.lastWidth && drag.lastWidth !== drag.startWidth) {
        const nextMap = { ...(settings?.marketingLeadsColumnWidths || {}), [drag.key]: Math.round(drag.lastWidth) };
        updateSettings({ marketingLeadsColumnWidths: nextMap });
      }
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }
  const hasCustomWidths = !!Object.keys(settings?.marketingLeadsColumnWidths || {}).length;
  function resetColumnWidths() {
    updateSettings({ marketingLeadsColumnWidths: {} });
  }

  // Index Table View prospects by lower-cased company so a lead's
  // Company resolves to "already on Table View" for the add bridge.
  const prospectCompanies = useMemo(() => {
    const set = new Set();
    for (const p of prospects) {
      const k = companyKey(p?.company);
      if (k) set.add(k);
    }
    return set;
  }, [prospects]);
  function isOnTableView(company) {
    const k = companyKey(company);
    return !!k && prospectCompanies.has(k);
  }

  // The company a lead effectively resolves to: the accepted mapping when
  // set, otherwise the raw pasted Company. Drives the Table View status +
  // add-to-Table-View bridge so mapping a lead to an existing account
  // stops it looking like a brand-new company.
  function effectiveCompany(r) {
    return (r.mappedCompany || '').trim() || (r.company || '').trim();
  }

  // Fuzzy index of Table View companies, mirroring the Zoom Info view so
  // the mapping suggestions here agree with those elsewhere. `strip`
  // drops punctuation + common corp suffixes for loose matching.
  const prospectIndex = useMemo(() => {
    const strip = (s) => String(s || '').toLowerCase()
      .replace(/[.,]/g, '')
      .replace(/\b(inc|llc|ltd|corp|co|lp|gmbh|plc|sa|ag)\b/g, '')
      .replace(/\s+/g, ' ').trim();
    const map = new Map();
    for (const p of prospects) {
      const raw = p?.company;
      if (isPlaceholderCompany(raw)) continue;
      const key = String(raw || '').toLowerCase().trim();
      if (key) map.set(key, p);
      const norm = strip(raw);
      if (norm && !map.has(norm)) map.set(norm, p);
    }
    return { map, strip };
  }, [prospects]);

  const companyOptions = useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const p of prospects) {
      const c = (p?.company || '').trim();
      if (isPlaceholderCompany(c)) continue;
      const k = c.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(c);
    }
    return out.sort((a, b) => a.localeCompare(b));
  }, [prospects]);

  function findProspectByCompany(company) {
    if (!company) return null;
    const direct = prospectIndex.map.get(String(company).toLowerCase().trim());
    if (direct) return direct;
    const norm = prospectIndex.strip(company);
    return norm ? prospectIndex.map.get(norm) || null : null;
  }

  // Best Table View account for a raw company string: an exact / strip-
  // normalized hit wins (exact: true); otherwise the closest fuzzy match
  // by containment + token overlap, gated at score ≥ 50 so we don't
  // surface low-confidence guesses. Returns null when nothing qualifies.
  function bestCompanyMatch(typed) {
    const raw = String(typed || '').trim();
    if (!raw || raw.length < 2) return null;
    const exact = findProspectByCompany(raw);
    if (exact) return { name: (exact.company || raw).trim(), exact: true, score: 100 };
    const target = prospectIndex.strip(raw);
    if (!target) return null;
    const targetTokens = new Set(target.split(' ').filter(Boolean));
    if (!targetTokens.size) return null;
    let best = null;
    let bestScore = 0;
    for (const opt of companyOptions) {
      const norm = prospectIndex.strip(opt);
      if (!norm) continue;
      let score = 0;
      if (norm === target) score = 100;
      else if (norm.startsWith(target) || target.startsWith(norm)) score = 80;
      else if (norm.includes(target) || target.includes(norm)) score = 70;
      else {
        const optTokens = new Set(norm.split(' ').filter(Boolean));
        let intersect = 0;
        for (const t of targetTokens) if (optTokens.has(t)) intersect++;
        if (!intersect) continue;
        const union = targetTokens.size + optTokens.size - intersect;
        score = Math.round((intersect / union) * 60);
      }
      if (score > bestScore) { best = opt; bestScore = score; }
    }
    return bestScore >= 50 ? { name: best, exact: false, score: bestScore } : null;
  }

  // Visible list = persisted rows + synthetic padding rows up to the
  // minimum. Padding rows have ids prefixed with "__pad_" so updateCell
  // can promote them into the persisted set on first edit.
  const activeColumnFilters = useMemo(
    () => Object.entries(columnFilters).filter(([, v]) => String(v || '').trim()),
    [columnFilters],
  );
  const isFiltering = !!search.trim() || activeColumnFilters.length > 0;
  const isSorting = !!sortKey;

  // Compare two rows for the active sort column. Created Date sorts
  // chronologically when both values parse as dates; everything else
  // falls back to a case-insensitive locale string compare. Blank cells
  // always sink to the bottom regardless of direction.
  function sortCompare(a, b) {
    const av = String(a[sortKey] ?? '').trim();
    const bv = String(b[sortKey] ?? '').trim();
    if (!av && !bv) return 0;
    if (!av) return 1;
    if (!bv) return -1;
    let cmp;
    if (sortKey === 'createdDate') {
      const at = Date.parse(av);
      const bt = Date.parse(bv);
      if (!Number.isNaN(at) && !Number.isNaN(bt)) cmp = at - bt;
      else cmp = av.localeCompare(bv, undefined, { numeric: true, sensitivity: 'base' });
    } else {
      cmp = av.localeCompare(bv, undefined, { numeric: true, sensitivity: 'base' });
    }
    return sortDir === 'desc' ? -cmp : cmp;
  }

  // Display list = real rows passing the search + per-column filters,
  // sorted if a sort is active, then padded with empty scratch rows up
  // to the minimum — but only in the unfiltered / unsorted default view
  // so a filter or sort never surfaces phantom blank rows.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rows = persistedRows.filter(r => {
      if (q && !EDITABLE_KEYS.some(k => String(r[k] || '').toLowerCase().includes(q))) return false;
      for (const [key, val] of activeColumnFilters) {
        if (!String(r[key] || '').toLowerCase().includes(String(val).trim().toLowerCase())) return false;
      }
      return true;
    });
    if (isSorting) rows = [...rows].sort(sortCompare);
    if (!isFiltering && !isSorting) {
      const padding = Math.max(0, MIN_VISIBLE_ROWS - rows.length);
      const padRows = Array.from({ length: padding }, (_, i) => ({ ...emptyRow(), id: `__pad_${i}` }));
      rows = [...rows, ...padRows];
    }
    return rows;
  }, [persistedRows, search, activeColumnFilters, isFiltering, isSorting, sortKey, sortDir]); // eslint-disable-line react-hooks/exhaustive-deps

  function persist(next) {
    updateSettings({ marketingLeads: next });
  }

  function updateCell(rowId, key, value) {
    if (String(rowId).startsWith('__pad_')) {
      if (!String(value || '').trim()) return; // don't persist blank padding rows
      persist([...persistedRows, { ...emptyRow(), [key]: value }]);
      return;
    }
    persist(persistedRows.map(r => (r.id === rowId ? { ...r, [key]: value } : r)));
  }

  function addRow() {
    persist([...persistedRows, emptyRow()]);
  }
  function deleteRow(id) {
    if (String(id).startsWith('__pad_')) return;
    persist(persistedRows.filter(r => r.id !== id));
  }
  function clearTable() {
    if (!persistedRows.length) return;
    const ok = window.confirm(
      `Delete all ${persistedRows.length} saved lead${persistedRows.length === 1 ? '' : 's'}? This cannot be undone.`,
    );
    if (!ok) return;
    persist([]);
  }

  // ---- Paste → column mapping -----------------------------------------
  const [pasteModal, setPasteModal] = useState(null); // { headers, rows, mapping } | null
  const [pasteHelper, setPasteHelper] = useState(null); // null | string (manual paste box)

  // Paste anywhere on the page (unless focused in an input/textarea)
  // routes the clipboard text into the mapping ingester.
  function handlePaste(e) {
    const tag = (e.target?.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea') return;
    const text = e.clipboardData?.getData('text/plain') || '';
    if (!text.trim()) return;
    e.preventDefault();
    ingestPastedText(text);
  }

  async function pasteFromClipboard() {
    try {
      const text = await navigator.clipboard?.readText?.();
      if (text && text.trim()) { ingestPastedText(text); return; }
    } catch {
      /* permission denied / insecure context — fall through to manual box */
    }
    setPasteHelper('');
  }

  function ingestPastedText(text) {
    if (!text || !text.trim()) return;
    const allLines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
    if (!allLines.length) return;
    const parsed = allLines.map(l => splitPasteRow(l).map(c => (c || '').trim()));
    const headerCells = parsed[0] || [];
    const dataRows = parsed.slice(1).filter(r => r.some(c => c));
    if (!dataRows.length) return;
    // De-dupe blank / repeated header cells so each column has a stable key.
    const headers = [];
    const seenH = new Map();
    for (const raw of headerCells) {
      let h = raw || '(blank)';
      if (seenH.has(h)) { const n = seenH.get(h) + 1; seenH.set(h, n); h = `${h} (${n})`; }
      else seenH.set(h, 1);
      headers.push(h);
    }
    setPasteModal({ headers, rows: dataRows, mapping: autoDetectMapping(headers) });
  }

  // Right-side dropdown changes "this header → that target". Picking a
  // target claims it for this header and evicts any other header that
  // held it, keeping a 1:1 mapping.
  function setHeaderTarget(header, targetKey) {
    setPasteModal(m => {
      if (!m) return m;
      const next = { ...m.mapping };
      for (const k of Object.keys(next)) if (next[k] === header) delete next[k];
      if (targetKey) next[targetKey] = header;
      return { ...m, mapping: next };
    });
  }

  function executePasteImport() {
    if (!pasteModal) return;
    const { headers, rows, mapping } = pasteModal;
    const idxOf = {};
    headers.forEach((h, i) => { idxOf[h] = i; });
    const incoming = [];
    for (const cells of rows) {
      const fresh = emptyRow();
      let any = false;
      for (const t of PASTE_TARGETS) {
        const h = mapping[t.key];
        if (!h) continue;
        const i = idxOf[h];
        if (i == null) continue;
        const v = (cells[i] || '').trim();
        if (v) any = true;
        fresh[t.key] = v;
      }
      if (any) incoming.push(fresh);
    }
    if (incoming.length) persist([...persistedRows, ...incoming]);
    setPasteModal(null);
  }

  // ---- Add to Table View bridge ---------------------------------------
  // Companies represented by leads that aren't already on Table View —
  // the candidates the bulk button can add.
  const unmatchedCompanies = useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const r of persistedRows) {
      const c = effectiveCompany(r);
      const k = companyKey(c);
      if (!k || seen.has(k) || prospectCompanies.has(k)) continue;
      seen.add(k);
      out.push(c);
    }
    return out;
  }, [persistedRows, prospectCompanies]); // eslint-disable-line react-hooks/exhaustive-deps

  async function addCompanyToTableView(company) {
    if (!onAddProspect) return;
    const c = (company || '').trim();
    if (!c || isOnTableView(c)) return;
    try { await onAddProspect({ company: c }); } catch (err) { console.error('Add to Table View failed', err); }
  }

  async function bulkAddToTableView() {
    if (!onAddProspect || !unmatchedCompanies.length) return;
    const ok = window.confirm(
      `Add ${unmatchedCompanies.length} compan${unmatchedCompanies.length === 1 ? 'y' : 'ies'} from these leads to Table View? Companies already on Table View are skipped.`,
    );
    if (!ok) return;
    for (const c of unmatchedCompanies) {
      try { await onAddProspect({ company: c }); } catch (err) { console.error('Bulk add failed', c, err); }
    }
  }

  function copyToClipboard() {
    const lines = [EDITABLE_KEYS.map(k => COLUMNS.find(c => c.key === k).label).join('\t')];
    for (const r of persistedRows) {
      lines.push(EDITABLE_KEYS.map(k => r[k] || '').join('\t'));
    }
    navigator.clipboard?.writeText(lines.join('\n')).catch(() => {});
  }

  const cellInputStyle = {
    width: '100%', border: 'none', padding: '0.45rem 0.6rem',
    fontFamily: 'inherit', fontSize: '0.8rem', background: 'transparent',
    boxSizing: 'border-box', outline: 'none',
  };
  const btn = (extra) => ({
    fontSize: '0.75rem', padding: '0.4rem 0.8rem', borderRadius: 4,
    cursor: 'pointer', fontWeight: 600, fontFamily: 'inherit', ...extra,
  });

  return (
    <div onPaste={handlePaste} style={{ padding: '0.75rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.6rem', minHeight: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: 'var(--color-text)' }}>Marketing Leads</h2>
        <span style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)' }}>
          {persistedRows.length.toLocaleString()} {persistedRows.length === 1 ? 'lead' : 'leads'} saved
        </span>
        <div style={{ flex: 1 }} />
        <input
          type="search"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search…"
          style={{ padding: '0.35rem 0.55rem', border: '1px solid var(--color-border)', borderRadius: 4, fontSize: '0.8rem', minWidth: 180 }}
        />
        <button
          type="button"
          onClick={pasteFromClipboard}
          title="Paste a block of leads copied from the Salesforce list view. A column-mapping modal appears so you can confirm which pasted column fills each lead field."
          style={btn({ border: '1px solid #009530', background: '#fff', color: '#009530', fontWeight: 700 })}
        >📋 Paste from Salesforce</button>
        <button
          type="button"
          onClick={addRow}
          style={btn({ border: 'none', background: '#009530', color: '#fff' })}
        >+ Add Row</button>
        <button
          type="button"
          onClick={copyToClipboard}
          title="Copy every saved lead as tab-separated values, ready to paste into Excel."
          style={btn({ border: '1px solid var(--color-border)', background: '#fff', color: 'var(--color-text)' })}
        >Copy as TSV</button>
        {hasCustomWidths && (
          <button
            type="button"
            onClick={resetColumnWidths}
            title="Restore every column to its default width."
            style={btn({ border: '1px solid var(--color-border)', background: '#fff', color: 'var(--color-text-secondary)' })}
          >Reset widths</button>
        )}
        <button
          type="button"
          onClick={() => setFiltersOpen(o => !o)}
          title="Show a per-column filter row under the header. Type in any column to narrow the list; filters combine with the search box."
          style={btn({
            border: `1px solid ${filtersOpen || activeColumnFilters.length ? '#009530' : 'var(--color-border)'}`,
            background: filtersOpen || activeColumnFilters.length ? '#F0FDF4' : '#fff',
            color: filtersOpen || activeColumnFilters.length ? '#166534' : 'var(--color-text-secondary)',
          })}
        >Filters{activeColumnFilters.length ? ` (${activeColumnFilters.length})` : ''}</button>
        {(activeColumnFilters.length > 0 || search.trim() || sortKey) && (
          <button
            type="button"
            onClick={() => { clearAllFilters(); setSortKey(''); }}
            title="Clear the search, every column filter, and the active sort."
            style={btn({ border: '1px solid var(--color-border)', background: '#fff', color: 'var(--color-text-secondary)' })}
          >Reset view</button>
        )}
        <div ref={colsPickerRef} style={{ position: 'relative' }}>
          <button
            type="button"
            onClick={() => setColsPickerOpen(o => !o)}
            title="Show or hide individual columns."
            style={btn({ border: '1px solid var(--color-border)', background: '#fff', color: 'var(--color-text-secondary)' })}
          >Columns ({visibleColumnList.length}/{COLUMNS.length})</button>
          {colsPickerOpen && (
            <div style={{
              position: 'absolute', top: '100%', right: 0, marginTop: 4, zIndex: 20,
              background: '#fff', border: '1px solid var(--color-border)', borderRadius: 6,
              boxShadow: '0 8px 20px rgba(15, 23, 42, 0.12)', minWidth: 240, padding: '0.4rem 0', fontSize: '0.78rem',
            }}>
              {COLUMNS.map(c => {
                const on = visibleCols.has(c.key);
                const locked = c.key === 'name';
                return (
                  <label
                    key={c.key}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0.3rem 0.7rem', cursor: locked ? 'not-allowed' : 'pointer', color: locked ? '#94A3B8' : 'var(--color-text)' }}
                    title={locked ? 'Name is always visible.' : `Show / hide the ${c.label} column.`}
                  >
                    <input type="checkbox" checked={on} disabled={locked} onChange={e => setColVisible(c.key, e.target.checked)} style={{ accentColor: '#0078D4' }} />
                    <span style={{ flex: 1 }}>{c.label}</span>
                  </label>
                );
              })}
            </div>
          )}
        </div>
        {onAddProspect && (
          <button
            type="button"
            onClick={bulkAddToTableView}
            disabled={!unmatchedCompanies.length}
            title={unmatchedCompanies.length
              ? `Create Table View accounts for the ${unmatchedCompanies.length} compan${unmatchedCompanies.length === 1 ? 'y' : 'ies'} on these leads that aren't there yet.`
              : 'Every company on these leads is already on Table View.'}
            style={btn({ border: 'none', background: unmatchedCompanies.length ? '#0EA5E9' : '#CBD5E1', color: '#fff', fontWeight: 700, cursor: unmatchedCompanies.length ? 'pointer' : 'not-allowed' })}
          >+ Add {unmatchedCompanies.length || ''} to Table View</button>
        )}
        <button
          type="button"
          onClick={clearTable}
          disabled={!persistedRows.length}
          title={persistedRows.length ? 'Delete every saved lead.' : 'Nothing to clear yet.'}
          style={btn({ border: '1px solid #FCA5A5', background: persistedRows.length ? '#fff' : '#F8FAFC', color: persistedRows.length ? '#B91C1C' : '#CBD5E1', cursor: persistedRows.length ? 'pointer' : 'not-allowed' })}
        >Clear table</button>
      </div>
      <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>
        Tip: in the Salesforce Leads list, select the rows (including the header row), copy, then paste anywhere on this page (or click <strong>📋 Paste from Salesforce</strong>). A column-mapping modal pops up so you can confirm which pasted column fills each field before importing. Click a column header to sort, use <strong>Filters</strong> for per-column filtering, drag a header edge to resize, and <strong>Columns</strong> to show/hide columns. The <strong>Company Mapping</strong> column links each lead's company to a Table View account — accept the suggested match or type to pick another.
      </div>

      {pasteHelper !== null && (
        <div style={{ border: '1px dashed #009530', borderRadius: 6, padding: '0.6rem', background: '#F0FDF4', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
          <div style={{ fontSize: '0.74rem', fontWeight: 700, color: '#166534' }}>
            Paste your Salesforce leads here (Ctrl/⌘+V), then click Next:
          </div>
          <textarea
            autoFocus
            value={pasteHelper}
            onChange={e => setPasteHelper(e.target.value)}
            placeholder="Paste the copied block — the first row should be the headers (Name, Email, Job Title, …)."
            style={{ width: '100%', minHeight: 90, padding: '0.4rem', border: '1px solid #86EFAC', borderRadius: 4, fontSize: '0.78rem', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', boxSizing: 'border-box', resize: 'vertical' }}
          />
          <div style={{ display: 'flex', gap: '0.4rem', justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={() => setPasteHelper(null)}
              style={btn({ fontSize: '0.72rem', padding: '0.3rem 0.7rem', border: '1px solid var(--color-border)', background: '#fff', color: 'var(--color-text-secondary)' })}
            >Cancel</button>
            <button
              type="button"
              disabled={!pasteHelper.trim()}
              onClick={() => { ingestPastedText(pasteHelper); setPasteHelper(null); }}
              style={btn({ fontSize: '0.72rem', padding: '0.3rem 0.8rem', border: 'none', background: pasteHelper.trim() ? '#009530' : '#CBD5E1', color: '#fff', fontWeight: 700, cursor: pasteHelper.trim() ? 'pointer' : 'not-allowed' })}
            >Next: map columns</button>
          </div>
        </div>
      )}

      <div style={{ flex: 1, overflow: 'auto', border: '1px solid var(--color-border)', borderRadius: 4 }}>
        <table style={{ borderCollapse: 'collapse', fontSize: '0.8rem', tableLayout: 'fixed', width: 'max-content', minWidth: '100%' }}>
          <colgroup>
            {visibleColumnList.map(c => (
              <col key={c.key} ref={el => { colRefs.current[c.key] = el; }} style={{ width: `${columnWidths[c.key]}px` }} />
            ))}
            <col style={{ width: 44 }} />
          </colgroup>
          <thead>
            <tr>
              {visibleColumnList.map(c => (
                <th key={c.key} style={{
                  textAlign: 'left', padding: '0.45rem 0.6rem', paddingRight: '0.95rem',
                  background: '#F1F5F9', fontWeight: 700, fontSize: '0.72rem', color: '#475569',
                  borderBottom: '1px solid var(--color-border)', position: 'sticky', top: 0, zIndex: 1,
                  overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
                }}>
                  <span
                    onClick={c.readonly ? undefined : () => cycleSort(c.key)}
                    title={c.readonly ? undefined : `Sort by ${c.label}`}
                    style={{ position: 'relative', display: 'block', paddingRight: 12, cursor: c.readonly ? 'default' : 'pointer', userSelect: 'none' }}
                  >
                    {c.label}
                    {sortKey === c.key && (
                      <span style={{ position: 'absolute', right: 0, top: 0, color: '#009530', fontSize: '0.68rem' }}>
                        {sortDir === 'asc' ? '▲' : '▼'}
                      </span>
                    )}
                  </span>
                  <span
                    onMouseDown={e => startResize(e, c.key)}
                    onDoubleClick={() => {
                      const nextMap = { ...(settings?.marketingLeadsColumnWidths || {}) };
                      delete nextMap[c.key];
                      updateSettings({ marketingLeadsColumnWidths: nextMap });
                    }}
                    title="Drag to resize. Double-click to reset this column to its default width."
                    style={{ position: 'absolute', top: 0, right: 0, width: 8, height: '100%', cursor: 'col-resize', userSelect: 'none', zIndex: 2, borderRight: '1px solid #E2E8F0' }}
                    onMouseEnter={e => { e.currentTarget.style.borderRight = '2px solid #009530'; }}
                    onMouseLeave={e => { e.currentTarget.style.borderRight = '1px solid #E2E8F0'; }}
                  />
                </th>
              ))}
              <th style={{ background: '#F1F5F9', borderBottom: '1px solid var(--color-border)', position: 'sticky', top: 0, zIndex: 1 }} />
            </tr>
            {filtersOpen && (
              <tr>
                {visibleColumnList.map(c => (
                  <th key={c.key} style={{ padding: '2px 4px', background: '#F8FAFC', borderBottom: '1px solid var(--color-border)', position: 'sticky', top: 28, zIndex: 1 }}>
                    {c.readonly ? null : (
                      <input
                        type="text"
                        value={columnFilters[c.key] || ''}
                        onChange={e => setColumnFilter(c.key, e.target.value)}
                        placeholder="Filter…"
                        style={{ width: '100%', boxSizing: 'border-box', padding: '3px 5px', fontSize: '0.72rem', border: '1px solid var(--color-border)', borderRadius: 3, fontFamily: 'inherit', fontWeight: 400 }}
                      />
                    )}
                  </th>
                ))}
                <th style={{ background: '#F8FAFC', borderBottom: '1px solid var(--color-border)', position: 'sticky', top: 28, zIndex: 1 }} />
              </tr>
            )}
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={visibleColumnList.length + 1} style={{ padding: '1.2rem', textAlign: 'center', color: 'var(--color-text-muted)', fontStyle: 'italic', fontSize: '0.78rem' }}>
                  {isFiltering ? 'No leads match the current search / filters.' : 'No leads yet — paste from Salesforce to get started.'}
                </td>
              </tr>
            )}
            {filtered.map(r => {
              const isPad = String(r.id).startsWith('__pad_');
              return (
                <tr key={r.id} style={{ borderBottom: '1px solid var(--color-border-light)' }}>
                  {visibleColumnList.map(c => (
                    <td key={c.key} style={{ padding: 0, verticalAlign: 'top' }}>
                      {c.key === 'tvStatus' ? (
                        <div style={{ padding: '0.45rem 0.6rem', minHeight: '1.4rem' }}>
                          {(() => {
                            const company = effectiveCompany(r);
                            if (!company) return <span style={{ color: '#CBD5E1', fontSize: '0.74rem', fontStyle: 'italic' }}>—</span>;
                            if (isOnTableView(company)) {
                              return (
                                <span title={`"${company}" is already on Table View.`} style={{ background: '#DCFCE7', border: '1px solid #86EFAC', color: '#166534', padding: '2px 8px', borderRadius: 999, fontSize: '0.7rem', fontWeight: 700, whiteSpace: 'nowrap' }}>✓ On Table View</span>
                              );
                            }
                            if (!onAddProspect || isPad) return <span style={{ color: '#CBD5E1', fontSize: '0.74rem', fontStyle: 'italic' }}>—</span>;
                            return (
                              <button
                                type="button"
                                onClick={() => addCompanyToTableView(company)}
                                title={`Create a new Table View account for "${company}".`}
                                style={{ background: '#fff', border: '1px solid #0EA5E9', color: '#0369A1', padding: '2px 8px', borderRadius: 999, fontSize: '0.7rem', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}
                              >+ Add to Table View</button>
                            );
                          })()}
                        </div>
                      ) : c.key === 'mappedCompany' ? (
                        <div>
                          <CompanyAutocomplete
                            value={r.mappedCompany || ''}
                            onCommit={v => updateCell(r.id, 'mappedCompany', v)}
                            suggestions={companyOptions}
                            placeholder={isPad ? '' : 'Map to account…'}
                            style={cellInputStyle}
                          />
                          {!isPad && (() => {
                            // Once a mapping is set, we don't re-badge it here —
                            // the Table View column already shows "✓ On Table
                            // View". Only surface the accept-suggestion pill for
                            // rows that aren't mapped yet.
                            if ((r.mappedCompany || '').trim()) return null;
                            const sugg = bestCompanyMatch(r.company);
                            if (!sugg) return null;
                            return (
                              <div style={{ padding: '0 0.6rem 0.3rem' }}>
                                <button
                                  type="button"
                                  onClick={() => updateCell(r.id, 'mappedCompany', sugg.name)}
                                  title={sugg.exact
                                    ? `Map "${r.company}" to the Table View account "${sugg.name}". Click to accept.`
                                    : `Suggested Table View account for "${r.company}": "${sugg.name}" (fuzzy match, score ${sugg.score}/100). Click to accept.`}
                                  style={{ background: sugg.exact ? '#DCFCE7' : '#FEF3C7', border: `1px solid ${sugg.exact ? '#86EFAC' : '#FCD34D'}`, color: sugg.exact ? '#166534' : '#92400E', padding: '1px 7px', borderRadius: 999, fontSize: '0.68rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                                >→ {sugg.name}</button>
                              </div>
                            );
                          })()}
                        </div>
                      ) : (
                        <CommitOnBlurInput
                          value={r[c.key] || ''}
                          onCommit={v => updateCell(r.id, c.key, v)}
                          placeholder={isPad && c.key === 'name' ? 'Type or paste a lead…' : '—'}
                          style={cellInputStyle}
                        />
                      )}
                    </td>
                  ))}
                  <td style={{ padding: '0.2rem', textAlign: 'center' }}>
                    {!isPad && (
                      <button
                        type="button"
                        onClick={() => deleteRow(r.id)}
                        title="Delete lead"
                        style={{ border: 'none', background: 'transparent', color: '#94A3B8', fontSize: '1rem', cursor: 'pointer', padding: '0 6px', lineHeight: 1 }}
                        onMouseEnter={e => e.currentTarget.style.color = '#DC2626'}
                        onMouseLeave={e => e.currentTarget.style.color = '#94A3B8'}
                      >×</button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {pasteModal && createPortal(
        <PasteMappingModal
          modal={pasteModal}
          onCancel={() => setPasteModal(null)}
          onConfirm={executePasteImport}
          onChangeMapping={setHeaderTarget}
        />,
        document.body,
      )}
    </div>
  );
}

function PasteMappingModal({ modal, onCancel, onConfirm, onChangeMapping }) {
  const { headers, rows, mapping } = modal;
  const targetForHeader = useMemo(() => {
    const out = {};
    for (const t of PASTE_TARGETS) {
      const h = mapping[t.key];
      if (h) out[h] = t.key;
    }
    return out;
  }, [mapping]);

  const missingRequired = PASTE_TARGETS.filter(t => t.required && !mapping[t.key]).map(t => t.label);
  const previewRows = rows.slice(0, 3);
  const idxOf = useMemo(() => {
    const o = {};
    headers.forEach((h, i) => { o[h] = i; });
    return o;
  }, [headers]);

  const colHeader = { fontSize: '0.7rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.04em', padding: '0.5rem 0.75rem', background: '#F8FAFC', borderBottom: '1px solid #E2E8F0' };
  const cellBase = { padding: '0.4rem 0.75rem', borderBottom: '1px solid #F1F5F9', fontSize: '0.78rem' };

  return (
    <div onClick={onCancel} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 12, padding: '1.5rem', width: 1000, maxWidth: '95vw', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.25)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: 'var(--color-text)' }}>Import Marketing Leads — Column Mapping</h3>
          <button onClick={onCancel} style={{ background: 'none', border: 'none', fontSize: '1.2rem', color: '#94A3B8', cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>
        <p style={{ fontSize: '0.72rem', color: 'var(--color-text-secondary)', margin: '0 0 1rem 0', lineHeight: 1.4 }}>
          Detected <strong>{rows.length.toLocaleString()}</strong> row{rows.length === 1 ? '' : 's'} and <strong>{headers.length}</strong> column{headers.length === 1 ? '' : 's'} from your clipboard. The first row was treated as headers — pick which pasted column should fill each lead field. Headers that match common names (Name, Email, Company, …) are mapped automatically.
        </p>
        {missingRequired.length > 0 && (
          <div style={{ margin: '0 0 0.75rem', padding: '0.4rem 0.6rem', background: '#FEE2E2', border: '1px solid #FCA5A5', borderRadius: 6, fontSize: '0.75rem', color: '#991B1B', fontWeight: 600 }}>
            Still need to map: {missingRequired.join(', ')}
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
          <div style={{ border: '1px solid #E2E8F0', borderRadius: 6, overflow: 'auto' }}>
            <div style={colHeader}>Lead field</div>
            {PASTE_TARGETS.map(t => {
              const header = mapping[t.key];
              return (
                <div key={t.key} style={{ ...cellBase, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {t.label}{t.required && <span style={{ color: '#DC2626', marginLeft: 2 }}>*</span>}
                  </span>
                  {header ? (
                    <span title={`Mapped from "${header}"`} style={{ background: '#DCFCE7', border: '1px solid #86EFAC', color: '#166534', padding: '1px 8px', borderRadius: 999, fontSize: '0.68rem', fontWeight: 600, maxWidth: '55%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>← {header}</span>
                  ) : (
                    <span style={{ color: t.required ? '#DC2626' : '#94A3B8', fontSize: '0.68rem', fontWeight: 600 }}>{t.required ? '— not mapped —' : '— optional —'}</span>
                  )}
                </div>
              );
            })}
          </div>
          <div style={{ border: '1px solid #E2E8F0', borderRadius: 6, overflow: 'auto' }}>
            <div style={colHeader}>Columns in your paste ({headers.length})</div>
            {headers.map(h => {
              const target = targetForHeader[h] || '';
              return (
                <div key={h} style={{ ...cellBase, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <span title={h} style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h}</span>
                  <span style={{ color: '#94A3B8', fontSize: '0.7rem' }}>→</span>
                  <select
                    value={target}
                    onChange={e => onChangeMapping(h, e.target.value)}
                    style={{ minWidth: 170, maxWidth: 220, padding: '0.25rem 0.4rem', border: '1px solid var(--color-border)', borderRadius: 4, fontFamily: 'inherit', fontSize: '0.75rem', background: target ? '#DCFCE7' : '#fff', color: target ? '#166534' : 'var(--color-text)' }}
                  >
                    <option value="">— Ignore —</option>
                    {PASTE_TARGETS.map(t => (
                      <option key={t.key} value={t.key}>{t.label}{t.required ? ' *' : ''}</option>
                    ))}
                  </select>
                </div>
              );
            })}
          </div>
        </div>

        <div style={{ marginTop: '1rem', border: '1px solid #E2E8F0', borderRadius: 6, overflow: 'auto' }}>
          <div style={colHeader}>Preview (first {previewRows.length} of {rows.length.toLocaleString()})</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.74rem' }}>
            <thead>
              <tr>
                {PASTE_TARGETS.map(t => (
                  <th key={t.key} style={{ ...cellBase, fontWeight: 700, color: '#475569', background: '#FAFBFC', textAlign: 'left' }}>{t.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {previewRows.map((cells, ri) => (
                <tr key={ri}>
                  {PASTE_TARGETS.map(t => {
                    const h = mapping[t.key];
                    const v = h && idxOf[h] != null ? cells[idxOf[h]] || '' : '';
                    return (
                      <td key={t.key} style={{ ...cellBase, color: v ? '#1E293B' : '#CBD5E1', fontStyle: v ? 'normal' : 'italic' }}>{v || '—'}</td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '1.25rem' }}>
          <button onClick={onCancel} style={{ padding: '0.5rem 1rem', border: '1px solid var(--color-border)', borderRadius: 6, background: '#fff', fontSize: '0.8rem', fontFamily: 'inherit', cursor: 'pointer', color: 'var(--color-text-secondary)' }}>Cancel</button>
          <button
            onClick={onConfirm}
            disabled={missingRequired.length > 0}
            style={{ padding: '0.5rem 1rem', border: 'none', borderRadius: 6, background: missingRequired.length ? '#CBD5E1' : '#009530', color: '#fff', fontSize: '0.8rem', fontFamily: 'inherit', cursor: missingRequired.length ? 'not-allowed' : 'pointer', fontWeight: 600 }}
          >Import {rows.length.toLocaleString()} lead{rows.length === 1 ? '' : 's'}</button>
        </div>
      </div>
    </div>
  );
}
