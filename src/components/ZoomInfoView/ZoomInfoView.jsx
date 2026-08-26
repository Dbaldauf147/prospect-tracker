import { useEffect, useMemo, useRef, useState, memo } from 'react';
import { createPortal } from 'react-dom';
import { CommitOnBlurInput } from '../common/CommitOnBlurInput';
import { buildTypeOptions, persistCustomOption } from '../../utils/prospectOptions';
import { loadEffectiveRaClients, raClientName, raClientCm } from '../../utils/raClientsStore';

// Same fuzzy company match the Portfolio Companies analysis uses for
// its CM lookup, so the CM column on Zoom Info agrees with what shows
// up in PEPortfolioView / the Prospect modal's Client Manager chip.
function companiesMatch(a, b) {
  const na = String(a || '').toLowerCase().trim();
  const nb = String(b || '').toLowerCase().trim();
  if (!na || !nb) return false;
  if (na === nb) return true;
  const longer = na.length >= nb.length ? na : nb;
  const shorter = na.length >= nb.length ? nb : na;
  if (shorter.length >= 4 && shorter.length >= longer.length * 0.6 && longer.includes(shorter)) return true;
  const strip = s => s.replace(/\b(inc|llc|ltd|corp|co|lp)\b\.?/gi, '').replace(/[^a-z0-9 ]/g, '').trim();
  const sa = strip(na);
  const sb = strip(nb);
  if (sa && sb && (sa === sb || sa.includes(sb) || sb.includes(sa))) return true;
  return false;
}

// Headers as specified by the user. The user typed "Webiste" in their
// note — we use the canonical "Website" spelling on the column header
// since both the export and any downstream parsing expect that.
// The first four columns are the canonical "Zoom Info" payload — the
// CSV export grabs them in this order. CDM / Tier come after so they
// stay visible alongside the company without contaminating the export.
// Default column widths in pixels. The user can drag the right edge of
// any header to resize, and the new widths persist via
// settings.zoomInfoColumnWidths so they survive reloads + sync via the
// existing settings → Firestore pipeline.
const COLUMNS = [
  { key: 'company',          label: 'Company',                 defaultWidth: 200 },
  { key: 'zoomId',           label: 'Zoom Company ID',         defaultWidth: 160 },
  { key: 'zoomName',         label: 'Zoom Company Name',       defaultWidth: 200 },
  { key: 'zoomWebsite',      label: 'Zoom Website',            defaultWidth: 220 },
  { key: 'suggestedCompany', label: 'Suggested Company Name',  defaultWidth: 180, readonly: true },
  { key: 'cdm',              label: 'CDM',                     defaultWidth: 130 },
  { key: 'cm',               label: 'CM',                      defaultWidth: 130, readonly: true },
  { key: 'tier',             label: 'Tier',                    defaultWidth: 90 },
  { key: 'type',             label: 'Type',                    defaultWidth: 110 },
  { key: 'tvStatus',         label: 'Table View',              defaultWidth: 160, readonly: true },
];

const MIN_COLUMN_WIDTH = 60;

const EXPORT_COLUMN_KEYS = ['company', 'zoomId', 'zoomName', 'zoomWebsite'];

// Minimum number of rows visible in the table. Empty padding rows fill
// in when the persisted list is shorter so the user always has scratch
// space — typing into a padding cell promotes that row into the
// persisted list on commit.
const MIN_VISIBLE_ROWS = 50;

function makeId() {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function emptyRow() {
  return {
    id: makeId(), company: '', zoomId: '', zoomName: '', zoomWebsite: '',
    cdm: '', tier: '', type: '',
    // Set when the user clicks an amber suggestion pill — the canonical
    // Table View name they accepted. Rendered as a green confirmation
    // pill in the Suggested Company Name column. Cleared on any manual
    // Company edit that doesn't match it, since the suggestion is then
    // stale.
    acceptedSuggestion: '',
  };
}

// Tab / comma / semicolon-tolerant split for clipboard paste — handles
// both Excel ("Acme<TAB>123<TAB>Acme Corp<TAB>acme.com") and the
// occasional CSV that leaks in from a spreadsheet export.
function splitPasteRow(line) {
  if (line.includes('\t')) return line.split('\t');
  return line.split(/,(?![^"]*"\s*(?:,|$))|;/).map(s => s.replace(/^"|"$/g, ''));
}

// Target fields the paste-mapping modal can fill. Company is required.
// Aliases match common Excel header conventions case-insensitively
// after stripping non-alphanumerics — "Zoom_Company_ID", "ZoomInfo
// Company ID", "ZI ID" all hit zoomId.
const PASTE_TARGETS = [
  { key: 'company',     label: 'Company',           required: true,
    aliases: ['company', 'companyname', 'account', 'accountname', 'name', 'organization'] },
  { key: 'zoomId',      label: 'Zoom Company ID',   required: false,
    aliases: ['zoomcompanyid', 'zoominfocompanyid', 'zoominfoid', 'zoomid', 'zicompanyid', 'ziid', 'companyid'] },
  { key: 'zoomName',    label: 'Zoom Company Name', required: false,
    aliases: ['zoomcompanyname', 'zoominfocompanyname', 'zoominfoname', 'zoomname', 'zicompanyname'] },
  { key: 'zoomWebsite', label: 'Zoom Website',      required: false,
    aliases: ['zoomwebsite', 'zoominfowebsite', 'website', 'url', 'domain', 'webaddress'] },
  { key: 'cdm',         label: 'CDM',               required: false,
    aliases: ['cdm', 'rep', 'cdmrep', 'owner', 'accountowner', 'salesrep'] },
  { key: 'tier',        label: 'Tier',              required: false,
    aliases: ['tier', 'accounttier', 'priority'] },
  { key: 'type',        label: 'Type',              required: false,
    aliases: ['type', 'accounttype', 'companytype', 'industry', 'segment', 'category'] },
];

function normaliseHeader(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Build a default header → target-key mapping. Each header is matched
// case- and punctuation-insensitively against every target's aliases;
// the first hit wins so headers can't accidentally double-map.
function autoDetectMapping(headers) {
  const mapping = {}; // targetKey → header
  const used = new Set();
  for (const t of PASTE_TARGETS) {
    for (const h of headers) {
      if (used.has(h)) continue;
      const norm = normaliseHeader(h);
      if (t.aliases.includes(norm)) {
        mapping[t.key] = h;
        used.add(h);
        break;
      }
    }
  }
  return mapping;
}

// Inline autocomplete used for the Company cell. Filters the supplied
// suggestion list by case-insensitive prefix-then-substring as the user
// types; ↑ / ↓ navigates, Enter or click commits, Escape cancels back
// to the original value. Pure local state until commit so the parent
// table doesn't re-render on every keystroke.
const CompanyAutocomplete = memo(function CompanyAutocomplete({
  value, onCommit, suggestions, placeholder, style,
}) {
  const [draft, setDraft] = useState(value ?? '');
  const [open, setOpen] = useState(false);
  const [hoverIdx, setHoverIdx] = useState(0);
  const wrapRef = useRef(null);
  const lastExternal = useRef(value ?? '');

  useEffect(() => {
    const v = value ?? '';
    if (v !== lastExternal.current) {
      lastExternal.current = v;
      setDraft(v);
    }
  }, [value]);

  // Close dropdown on outside click.
  useEffect(() => {
    if (!open) return;
    function onDocDown(e) {
      if (!wrapRef.current?.contains(e.target)) setOpen(false);
    }
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
      if (lower === q) continue; // Skip an exact match — nothing to suggest.
      if (lower.startsWith(q)) prefix.push(s);
      else if (lower.includes(q)) sub.push(s);
      if (prefix.length + sub.length >= 25) break;
    }
    return [...prefix, ...sub].slice(0, 8);
  }, [draft, suggestions]);

  function commit(v) {
    const next = (v ?? draft);
    if (next !== lastExternal.current) {
      lastExternal.current = next;
      onCommit(next);
    }
    setOpen(false);
  }

  function handleKey(e) {
    if (open && matches.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setHoverIdx(i => (i + 1) % matches.length); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setHoverIdx(i => (i - 1 + matches.length) % matches.length); return; }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        const pick = matches[hoverIdx] || matches[0];
        setDraft(pick);
        commit(pick);
        return;
      }
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
        onBlur={() => {
          // Defer so a click on the popover lands first.
          requestAnimationFrame(() => {
            if (!wrapRef.current?.contains(document.activeElement)) commit();
          });
        }}
        onKeyDown={handleKey}
        placeholder={placeholder}
        style={style}
      />
      {open && matches.length > 0 && (
        <div
          onMouseDown={e => e.preventDefault()}
          style={{
            position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 5,
            background: '#fff', border: '1px solid var(--color-border)',
            borderRadius: 4, boxShadow: '0 8px 20px rgba(15, 23, 42, 0.12)',
            maxHeight: 220, overflowY: 'auto', fontSize: '0.78rem',
          }}
        >
          {matches.map((m, i) => (
            <div
              key={m + i}
              onClick={() => { setDraft(m); commit(m); }}
              onMouseEnter={() => setHoverIdx(i)}
              style={{
                padding: '0.35rem 0.6rem', cursor: 'pointer',
                background: i === hoverIdx ? '#DCFCE7' : 'transparent',
                color: i === hoverIdx ? '#166534' : '#1E293B',
                fontWeight: i === hoverIdx ? 700 : 500,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}
            >{m}</div>
          ))}
        </div>
      )}
    </div>
  );
});

// Type cell on the Zoom Info table — same dynamic option set as the
// Table View's Type column, with a "+ Add new Type…" sentinel that
// prompts the user and calls onAddNew so the entry persists in
// settings.customTypes (and the new value is assigned to this row).
const ADD_NEW_TYPE = '__ADD_NEW_TYPE__';
const TypeDropdown = memo(function TypeDropdown({ value, options, onChange, onAddNew }) {
  return (
    <select
      value={value || ''}
      onChange={e => {
        const v = e.target.value;
        if (v === ADD_NEW_TYPE) {
          const raw = window.prompt('Add a new Type:');
          const name = (raw || '').trim();
          if (!name) return;
          const existing = (options || []).find(o => o.toLowerCase() === name.toLowerCase());
          if (existing) onChange(existing);
          else if (onAddNew) onAddNew(name);
          return;
        }
        onChange(v);
      }}
      style={{
        width: '100%', border: 'none', padding: '0.45rem 0.6rem',
        fontFamily: 'inherit', fontSize: '0.8rem',
        background: 'transparent', boxSizing: 'border-box', outline: 'none',
        appearance: 'auto',
      }}
    >
      <option value="">-</option>
      {(options || []).map(o => <option key={o} value={o}>{o}</option>)}
      <option value={ADD_NEW_TYPE}>+ Add new Type…</option>
    </select>
  );
});

export function ZoomInfoView({ prospects = [], settings, updateSettings, onAddProspect }) {
  const persistedRows = useMemo(() => {
    const arr = Array.isArray(settings?.zoomInfo) ? settings.zoomInfo : [];
    return arr.map(r => ({ ...emptyRow(), ...r, id: r.id || makeId() }));
  }, [settings]);

  const [search, setSearch] = useState('');

  // RA Clients lookup table. raClientsStore caches the user-uploaded
  // override (or falls back to the bundled default) so this load is
  // synchronous + cheap; we re-read on focus / settings change so a
  // re-upload of the RA Clients sheet on the Lists tab surfaces here
  // without a manual refresh.
  const [raClients, setRaClients] = useState(() => {
    try { return loadEffectiveRaClients()?.data || []; } catch { return []; }
  });
  useEffect(() => {
    function refresh() {
      try { setRaClients(loadEffectiveRaClients()?.data || []); } catch { /* ignore */ }
    }
    window.addEventListener('focus', refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);

  // Resolves a row's company against the RA Clients sheet and returns
  // the CM string, or '' when unmatched. Same fuzzy matcher the
  // Portfolio Companies analysis uses, so the CM here agrees with the
  // CM displayed on those views.
  function lookupCm(company) {
    const c = String(company || '').trim();
    if (!c || !raClients.length) return '';
    const match = raClients.find(r => companiesMatch(raClientName(r), c));
    return match ? raClientCm(match) : '';
  }

  // Column visibility — toggleable via a "Columns" dropdown on the
  // toolbar, persisted via settings.zoomInfoVisibleCols. Falls back to
  // every column visible when nothing has been saved.
  const visibleCols = useMemo(() => {
    const saved = settings?.zoomInfoVisibleCols;
    if (Array.isArray(saved) && saved.length) return new Set(saved);
    return new Set(COLUMNS.map(c => c.key));
  }, [settings]);

  function setColVisible(key, on) {
    const next = new Set(visibleCols);
    if (on) next.add(key); else next.delete(key);
    // Always keep at least the company column visible — without it
    // the table can't address rows.
    if (next.size === 0) next.add('company');
    updateSettings({ zoomInfoVisibleCols: [...next] });
  }
  const visibleColumnList = useMemo(
    () => COLUMNS.filter(c => visibleCols.has(c.key)),
    [visibleCols]
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

  // Column widths in pixels — keyed by column.key so a future column
  // re-order doesn't scramble the user's saved widths. Hydrates from
  // settings.zoomInfoColumnWidths on every render so a Firestore-driven
  // settings change shows up live, falling back to the column's
  // defaultWidth when no override is saved.
  const columnWidths = useMemo(() => {
    const saved = settings?.zoomInfoColumnWidths || {};
    const out = {};
    for (const c of COLUMNS) {
      const v = Number(saved[c.key]);
      out[c.key] = Number.isFinite(v) && v >= MIN_COLUMN_WIDTH ? v : c.defaultWidth;
    }
    return out;
  }, [settings]);

  // Drag-resize state. While the user is dragging a header edge we
  // keep the in-flight width in a ref so mousemove doesn't trigger a
  // React re-render on every pixel — the cell that owns the handle
  // updates the relevant <col> element directly. On mouseup we commit
  // the final width to settings, which kicks off one re-render.
  const dragRef = useRef(null); // { key, startX, startWidth, colEl }
  const colRefs = useRef({}); // key → <col> element

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
        const nextMap = { ...(settings?.zoomInfoColumnWidths || {}), [drag.key]: Math.round(drag.lastWidth) };
        updateSettings({ zoomInfoColumnWidths: nextMap });
      }
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  function resetColumnWidths() {
    updateSettings({ zoomInfoColumnWidths: {} });
  }
  const hasCustomWidths = !!Object.keys(settings?.zoomInfoColumnWidths || {}).length;

  // Filter out Table View rows whose company column is a placeholder
  // ("N.A.", "N/A", "TBD", "Unknown", a lone dash, etc.) — they used
  // to leak into the autocomplete and fuzzy-match index, so a row with
  // a typed name like "Northrop" could fuzzy-suggest "N.A." over the
  // real account. Mirrors the placeholder check used elsewhere
  // (SitesView's isSupplierPlaceholder).
  const isPlaceholderCompany = (s) => {
    const t = String(s || '').trim();
    if (!t) return true;
    if (/^[-\u2013\u2014_]+$/.test(t)) return true;
    if (/^(n\.?a\.?|n\/a|none|null|tbd|unknown|\?|\.|test)$/i.test(t)) return true;
    return false;
  };

  // Index every Table View prospect by lower-cased company so a row's
  // committed company instantly resolves to its zoom fields. Strips
  // common corp suffixes so "Acme Inc" still matches "Acme".
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
      if (!c) continue;
      const k = c.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(c);
    }
    return out.sort((a, b) => a.localeCompare(b));
  }, [prospects]);

  // The same union the Table View and the company card use: the
  // Dropdowns-tab Type list, then every Type already in use, then legacy
  // customTypes. Shared rather than rebuilt here, so a Type added on the
  // Dropdowns tab reaches this page too.
  const dynamicTypeOptions = useMemo(
    () => buildTypeOptions(prospects, settings),
    [prospects, settings],
  );

  // A Type added from this page's dropdown lands on the Dropdowns-tab Type
  // list, the same place Table View's "+ Add new" writes it — so it's
  // editable there afterwards instead of stranded in a hidden setting.
  function addCustomType(name) {
    persistCustomOption('type', name, settings, updateSettings);
  }

  function findProspectByCompany(company) {
    if (!company) return null;
    const direct = prospectIndex.map.get(String(company).toLowerCase().trim());
    if (direct) return direct;
    const norm = prospectIndex.strip(company);
    return norm ? prospectIndex.map.get(norm) || null : null;
  }

  // Fuzzy suggestion for the "Suggested Company Name" column. When the
  // typed company has no exact / strip-normalized hit on Table View,
  // pick the closest prospect by token-overlap score so the user gets a
  // one-click promotion to the canonical name. Skips rows that already
  // resolve cleanly (no need to suggest what we already matched).
  function suggestCompany(typed) {
    const raw = String(typed || '').trim();
    if (!raw || raw.length < 2) return null;
    if (findProspectByCompany(raw)) return null; // already an exact match
    const target = prospectIndex.strip(raw);
    if (!target) return null;
    const targetTokens = new Set(target.split(' ').filter(Boolean));
    if (!targetTokens.size) return null;
    let best = null;
    let bestScore = 0;
    for (const opt of companyOptions) {
      const norm = prospectIndex.strip(opt);
      if (!norm) continue;
      // Cheap containment win — "acme" inside "acme corporation" is a strong hit.
      let score = 0;
      if (norm === target) score = 100;
      else if (norm.startsWith(target) || target.startsWith(norm)) score = 80;
      else if (norm.includes(target) || target.includes(norm)) score = 70;
      else {
        // Jaccard-like token overlap, rewarded by length match so short
        // tokens don't carry "the" / "of" type words too far.
        const optTokens = new Set(norm.split(' ').filter(Boolean));
        let intersect = 0;
        for (const t of targetTokens) if (optTokens.has(t)) intersect++;
        if (!intersect) continue;
        const union = targetTokens.size + optTokens.size - intersect;
        score = Math.round((intersect / union) * 60); // cap below containment
      }
      if (score > bestScore) {
        best = opt;
        bestScore = score;
      }
    }
    // Threshold so we don't surface random low-confidence guesses. 50
    // roughly corresponds to "more than half the typed tokens hit" or
    // any containment match.
    return bestScore >= 50 ? { name: best, score: bestScore } : null;
  }

  // Visible list = persisted rows + synthetic "padding" rows up to 50.
  // Padding rows have ids prefixed with "__pad_" so updateCell can
  // detect a first-touch promotion to the persisted set.
  const visibleRows = useMemo(() => {
    const padding = Math.max(0, MIN_VISIBLE_ROWS - persistedRows.length);
    const padRows = Array.from({ length: padding }, (_, i) => ({
      id: `__pad_${i}`, company: '', zoomId: '', zoomName: '', zoomWebsite: '',
      cdm: '', tier: '', type: '',
    }));
    return [...persistedRows, ...padRows];
  }, [persistedRows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return visibleRows;
    return visibleRows.filter(r =>
      COLUMNS.some(c => String(r[c.key] || '').toLowerCase().includes(q))
    );
  }, [visibleRows, search]);

  function persist(next) {
    updateSettings({ zoomInfo: next });
  }

  // Returns the row with auto-fill applied: when company is non-empty
  // and matches a Table View prospect, fill any blank zoom fields from
  // that prospect. Existing values on the row are never overwritten.
  function withAutofill(row) {
    if (!row.company) return row;
    const match = findProspectByCompany(row.company);
    if (!match) return row;
    return {
      ...row,
      zoomId:      row.zoomId || match.zoomCompanyId || '',
      zoomName:    row.zoomName || match.zoomCompanyName || '',
      zoomWebsite: row.zoomWebsite || match.website || '',
      cdm:         row.cdm || match.cdm || '',
      tier:        row.tier || match.tier || '',
      type:        row.type || match.type || '',
    };
  }

  function updateCell(rowId, key, value) {
    // Synthetic padding row → only persist when the user typed
    // something. Empty commits stay ephemeral so a tab-through doesn't
    // pollute the saved list with blank rows.
    if (String(rowId).startsWith('__pad_')) {
      if (!String(value || '').trim()) return;
      const fresh = { ...emptyRow(), [key]: value };
      persist([...persistedRows, withAutofill(fresh)]);
      return;
    }
    const updated = persistedRows.map(r => {
      if (r.id !== rowId) return r;
      const next = { ...r, [key]: value };
      // A manual Company edit invalidates a previously-accepted
      // suggestion unless the user edited back to the same canonical
      // name — in that case keep the green confirmation.
      if (key === 'company' && next.acceptedSuggestion && next.acceptedSuggestion !== value) {
        next.acceptedSuggestion = '';
      }
      return key === 'company' ? withAutofill(next) : next;
    });
    persist(updated);
  }

  // One-click promotion from the amber suggestion pill: replace the
  // row's Company with the canonical name, mark the suggestion as
  // accepted (so the cell stays lit up green afterwards), and run the
  // standard autofill so Zoom ID / Name / Website / CDM / Tier light
  // up from the matched prospect.
  function acceptSuggestion(rowId, suggestionName) {
    if (!suggestionName) return;
    if (String(rowId).startsWith('__pad_')) {
      const fresh = { ...emptyRow(), company: suggestionName, acceptedSuggestion: suggestionName };
      persist([...persistedRows, withAutofill(fresh)]);
      return;
    }
    const updated = persistedRows.map(r => {
      if (r.id !== rowId) return r;
      return withAutofill({ ...r, company: suggestionName, acceptedSuggestion: suggestionName });
    });
    persist(updated);
  }

  function addRow() {
    persist([...persistedRows, emptyRow()]);
  }

  function deleteRow(id) {
    if (String(id).startsWith('__pad_')) return; // nothing to delete
    persist(persistedRows.filter(r => r.id !== id));
  }

  const [pasteModal, setPasteModal] = useState(null);
  // pasteModal = { headers: string[], rows: string[][], mapping: {targetKey: header} }
  // null when closed.

  // Excel paste anywhere on the page: pulls the clipboard text and
  // hands it off to the shared ingester (which opens the mapping modal
  // for multi-column blocks or fast-imports a single-column list).
  // The toolbar's "📋 Paste from Excel" button is the discoverable
  // entry point; this listener is the convenience version for users
  // who land on the page already holding ⌘V.
  function handlePaste(e) {
    const tag = (e.target?.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea') return;
    const text = e.clipboardData?.getData('text/plain') || '';
    if (!text.trim()) return;
    e.preventDefault();
    ingestPastedText(text);
  }

  function executePasteImport() {
    if (!pasteModal) return;
    const { headers, rows, mapping } = pasteModal;
    // Header → column index lookup, used by the mapping below.
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
      if (!any) continue;
      incoming.push(withAutofill(fresh));
    }
    if (incoming.length) persist([...persistedRows, ...incoming]);
    setPasteModal(null);
  }

  // Right-side dropdown changes "this header → that target". When the
  // user picks "— Ignore —" (empty target), drop whatever target this
  // header was filling. When the user picks a target, claim it for this
  // header and evict any other header that was using either side of
  // the relationship (1:1 mapping).
  function setHeaderTarget(header, targetKey) {
    setPasteModal(m => {
      if (!m) return m;
      const next = { ...m.mapping };
      // Clear any target currently mapped from this header.
      for (const k of Object.keys(next)) if (next[k] === header) delete next[k];
      if (targetKey) next[targetKey] = header;
      return { ...m, mapping: next };
    });
  }

  // Discoverable "Paste from Excel" affordance — reads the system
  // clipboard via the async API when the browser allows it, then runs
  // the same parser handlePaste does (so the mapping modal pops up
  // for multi-column blocks). When clipboard access is denied we
  // surface a textarea the user can paste into manually.
  const [pasteHelper, setPasteHelper] = useState(null); // null | string
  async function pasteFromExcel() {
    try {
      const text = await navigator.clipboard?.readText?.();
      if (text && text.trim()) {
        ingestPastedText(text);
        return;
      }
    } catch {
      /* permission denied or insecure context — fall through to manual paste */
    }
    setPasteHelper('');
  }

  function ingestPastedText(text) {
    if (!text || !text.trim()) return;
    const allLines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
    if (!allLines.length) return;
    const hasTabs = text.includes('\t');
    if (!hasTabs) {
      const incoming = [];
      for (const line of allLines) {
        const v = line.trim();
        if (!v || /^company$/i.test(v)) continue;
        incoming.push(withAutofill({ ...emptyRow(), company: v }));
      }
      if (incoming.length) persist([...persistedRows, ...incoming]);
      return;
    }
    const parsed = allLines.map(l => splitPasteRow(l).map(c => (c || '').trim()));
    const headerCells = parsed[0] || [];
    const dataRows = parsed.slice(1).filter(r => r.some(c => c));
    if (!dataRows.length) return;
    const headers = [];
    const seenH = new Map();
    for (const raw of headerCells) {
      let h = raw || '(blank)';
      if (seenH.has(h)) {
        const n = seenH.get(h) + 1;
        seenH.set(h, n);
        h = `${h} (${n})`;
      } else {
        seenH.set(h, 1);
      }
      headers.push(h);
    }
    setPasteModal({ headers, rows: dataRows, mapping: autoDetectMapping(headers) });
  }

  // Project a Zoom Info row into a Table View prospect record. Only
  // the fields the Table View knows about are passed through — the
  // suggestedCompany / acceptedSuggestion fields are local to this
  // page and don't belong on the prospect.
  function rowToProspect(r) {
    return {
      company:         (r.company || '').trim(),
      cdm:             (r.cdm || '').trim(),
      tier:            (r.tier || '').trim(),
      type:            (r.type || '').trim(),
      zoomCompanyId:   (r.zoomId || '').trim(),
      zoomCompanyName: (r.zoomName || '').trim(),
      website:         (r.zoomWebsite || '').trim(),
    };
  }

  // List of every persisted row that has a non-empty Company AND isn't
  // already represented on Table View — those are the candidates the
  // bulk button can add. Recomputes whenever prospects or rows change
  // so the count + button-enabled state stay live.
  const unmatchedRows = useMemo(() => {
    return persistedRows.filter(r => {
      const c = (r.company || '').trim();
      if (!c) return false;
      return !findProspectByCompany(c);
    });
  }, [persistedRows, prospects]); // eslint-disable-line react-hooks/exhaustive-deps

  async function addRowToTableView(row) {
    if (!onAddProspect) return;
    const prospect = rowToProspect(row);
    if (!prospect.company) return;
    if (findProspectByCompany(prospect.company)) return; // already there
    try { await onAddProspect(prospect); } catch (err) { console.error('Add to Table View failed', err); }
  }

  async function bulkAddToTableView() {
    if (!onAddProspect || !unmatchedRows.length) return;
    const ok = window.confirm(
      `Add ${unmatchedRows.length} compan${unmatchedRows.length === 1 ? 'y' : 'ies'} to Table View? Companies already on Table View are skipped automatically.`
    );
    if (!ok) return;
    // Track names we've added in this loop so two Zoom Info rows with
    // the same Company don't double-write. Firestore writes are
    // sequential to keep _lastWriteAt sane and to avoid hammering the
    // backend; the Table View list updates automatically as each add
    // completes.
    const seen = new Set();
    for (const r of unmatchedRows) {
      const key = String(r.company || '').toLowerCase().trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const prospect = rowToProspect(r);
      try { await onAddProspect(prospect); } catch (err) { console.error('Bulk add row failed', r.company, err); }
    }
  }

  function clearTable() {
    if (!persistedRows.length) return;
    const ok = window.confirm(
      `Delete all ${persistedRows.length} saved row${persistedRows.length === 1 ? '' : 's'} from the Zoom Info table? The 50 default empty rows will reappear ready for fresh data. This cannot be undone.`
    );
    if (!ok) return;
    persist([]);
  }

  function copyToClipboard() {
    const lines = [COLUMNS.map(c => c.label).join('\t')];
    for (const r of persistedRows) {
      lines.push(COLUMNS.map(c => {
        if (c.key === 'suggestedCompany') {
          // Accepted suggestion (still matching the company) takes
          // precedence over a freshly-computed one — that's what the
          // user sees on screen.
          if (r.acceptedSuggestion && r.acceptedSuggestion === r.company) return r.acceptedSuggestion;
          return suggestCompany(r.company)?.name || '';
        }
        if (c.key === 'cm') return lookupCm(r.company);
        return r[c.key] || '';
      }).join('\t'));
    }
    navigator.clipboard?.writeText(lines.join('\n')).catch(() => {});
  }

  // RFC-4180-ish CSV escape: wrap any field containing a comma, quote,
  // or newline in double quotes and double-up any embedded quotes.
  function csvEscape(value) {
    const s = String(value ?? '');
    if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  }

  function exportCsv() {
    const exportCols = EXPORT_COLUMN_KEYS.map(k => COLUMNS.find(c => c.key === k));
    const lines = [exportCols.map(c => csvEscape(c.label)).join(',')];
    for (const r of persistedRows) {
      // Skip entirely-empty saved rows so the CSV doesn't carry blank lines.
      if (EXPORT_COLUMN_KEYS.every(k => !String(r[k] || '').trim())) continue;
      lines.push(EXPORT_COLUMN_KEYS.map(k => csvEscape(r[k] || '')).join(','));
    }
    // Prepend a UTF-8 BOM so Excel auto-detects the encoding when the
    // user double-clicks the file on Windows.
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `Zoom Info - ${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    requestAnimationFrame(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(a.href);
    });
  }

  const cellInputStyle = {
    width: '100%',
    border: 'none',
    padding: '0.45rem 0.6rem',
    fontFamily: 'inherit',
    fontSize: '0.8rem',
    background: 'transparent',
    boxSizing: 'border-box',
    outline: 'none',
  };

  return (
    <div onPaste={handlePaste} style={{ padding: '0.75rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.6rem', minHeight: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: 'var(--color-text)' }}>Zoom Info</h2>
        <span style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)' }}>
          {persistedRows.length.toLocaleString()} {persistedRows.length === 1 ? 'company' : 'companies'} saved
        </span>
        <div style={{ flex: 1 }} />
        <input
          type="search"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search…"
          style={{ padding: '0.35rem 0.55rem', border: '1px solid var(--color-border)', borderRadius: 4, fontSize: '0.8rem', minWidth: 200 }}
        />
        <button
          type="button"
          onClick={pasteFromExcel}
          title="Paste a tab-separated block copied from Excel. A column-mapping modal will appear so you can confirm which columns fill Company / Zoom ID / Zoom Name / Zoom Website / CDM / Tier / Type."
          style={{ fontSize: '0.75rem', padding: '0.4rem 0.8rem', border: '1px solid #009530', background: '#fff', color: '#009530', borderRadius: 4, cursor: 'pointer', fontWeight: 700 }}
        >📋 Paste from Excel</button>
        <button
          type="button"
          onClick={addRow}
          style={{ fontSize: '0.75rem', padding: '0.4rem 0.8rem', border: 'none', background: '#009530', color: '#fff', borderRadius: 4, cursor: 'pointer', fontWeight: 600 }}
        >+ Add Row</button>
        <button
          type="button"
          onClick={copyToClipboard}
          title="Copy the entire table (all columns) as tab-separated values, ready to paste into Excel."
          style={{ fontSize: '0.75rem', padding: '0.4rem 0.8rem', border: '1px solid var(--color-border)', background: '#fff', color: 'var(--color-text)', borderRadius: 4, cursor: 'pointer', fontWeight: 600 }}
        >Copy as TSV</button>
        <button
          type="button"
          onClick={exportCsv}
          title="Download the first four columns (Company, Zoom Company ID, Zoom Company Name, Zoom Website) as a CSV file."
          style={{ fontSize: '0.75rem', padding: '0.4rem 0.8rem', border: '1px solid var(--color-border)', background: '#fff', color: 'var(--color-text)', borderRadius: 4, cursor: 'pointer', fontWeight: 600 }}
        >Export CSV</button>
        {hasCustomWidths && (
          <button
            type="button"
            onClick={resetColumnWidths}
            title="Restore every column to its default width."
            style={{ fontSize: '0.75rem', padding: '0.4rem 0.8rem', border: '1px solid var(--color-border)', background: '#fff', color: 'var(--color-text-secondary)', borderRadius: 4, cursor: 'pointer', fontWeight: 600 }}
          >Reset widths</button>
        )}
        <div ref={colsPickerRef} style={{ position: 'relative' }}>
          <button
            type="button"
            onClick={() => setColsPickerOpen(o => !o)}
            title="Show or hide individual columns. The Company column is always visible."
            style={{ fontSize: '0.75rem', padding: '0.4rem 0.8rem', border: '1px solid var(--color-border)', background: '#fff', color: 'var(--color-text-secondary)', borderRadius: 4, cursor: 'pointer', fontWeight: 600 }}
          >Columns ({visibleColumnList.length}/{COLUMNS.length})</button>
          {colsPickerOpen && (
            <div style={{
              position: 'absolute', top: '100%', right: 0, marginTop: 4, zIndex: 20,
              background: '#fff', border: '1px solid var(--color-border)', borderRadius: 6,
              boxShadow: '0 8px 20px rgba(15, 23, 42, 0.12)',
              minWidth: 240, padding: '0.4rem 0', fontSize: '0.78rem',
            }}>
              {COLUMNS.map(c => {
                const on = visibleCols.has(c.key);
                const lockCompany = c.key === 'company';
                return (
                  <label
                    key={c.key}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '0.3rem 0.7rem', cursor: lockCompany ? 'not-allowed' : 'pointer',
                      color: lockCompany ? '#94A3B8' : 'var(--color-text)',
                    }}
                    title={lockCompany ? 'Company is always visible.' : `Show / hide the ${c.label} column.`}
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      disabled={lockCompany}
                      onChange={e => setColVisible(c.key, e.target.checked)}
                      style={{ accentColor: '#0078D4' }}
                    />
                    <span style={{ flex: 1 }}>{c.label}</span>
                  </label>
                );
              })}
              <div style={{ borderTop: '1px solid #E2E8F0', marginTop: 4, padding: '0.3rem 0.7rem', display: 'flex', gap: 6 }}>
                <button
                  type="button"
                  onClick={() => updateSettings({ zoomInfoVisibleCols: COLUMNS.map(c => c.key) })}
                  style={{ fontSize: '0.7rem', padding: '0.25rem 0.5rem', border: '1px solid var(--color-border)', background: '#fff', borderRadius: 4, cursor: 'pointer', fontFamily: 'inherit', color: 'var(--color-text-secondary)' }}
                >Show all</button>
                <button
                  type="button"
                  onClick={() => updateSettings({ zoomInfoVisibleCols: ['company'] })}
                  style={{ fontSize: '0.7rem', padding: '0.25rem 0.5rem', border: '1px solid var(--color-border)', background: '#fff', borderRadius: 4, cursor: 'pointer', fontFamily: 'inherit', color: 'var(--color-text-secondary)' }}
                >Hide all</button>
              </div>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={bulkAddToTableView}
          disabled={!onAddProspect || !unmatchedRows.length}
          title={onAddProspect
            ? (unmatchedRows.length
                ? `Add ${unmatchedRows.length} compan${unmatchedRows.length === 1 ? 'y' : 'ies'} that aren't on Table View yet. CDM, Tier, Type, Zoom ID / Name / Website carry over.`
                : 'Every company on this page is already on Table View.')
            : 'Add-to-Table-View is unavailable in this context.'}
          style={{
            fontSize: '0.75rem', padding: '0.4rem 0.8rem',
            border: 'none',
            background: unmatchedRows.length ? '#0EA5E9' : '#CBD5E1',
            color: '#fff',
            borderRadius: 4,
            cursor: unmatchedRows.length ? 'pointer' : 'not-allowed',
            fontWeight: 700,
          }}
        >+ Add {unmatchedRows.length || ''} to Table View</button>
        <button
          type="button"
          onClick={clearTable}
          disabled={!persistedRows.length}
          title={persistedRows.length
            ? `Delete every saved row from the Zoom Info table. The 50 default empty rows will reappear.`
            : 'Nothing to clear yet.'}
          style={{
            fontSize: '0.75rem', padding: '0.4rem 0.8rem',
            border: '1px solid #FCA5A5',
            background: persistedRows.length ? '#fff' : '#F8FAFC',
            color: persistedRows.length ? '#B91C1C' : '#CBD5E1',
            borderRadius: 4,
            cursor: persistedRows.length ? 'pointer' : 'not-allowed',
            fontWeight: 600,
          }}
        >Clear table</button>
      </div>
      <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>
        Tip: click <strong>📋 Paste from Excel</strong> to import a copied block: a column-mapping modal pops up so you can confirm which Excel column fills which Zoom Info field. You can also type directly in the Company column to search Table View; pick a match and the Zoom ID / Name / Website / CDM / Tier / Type auto-fill from that account.
      </div>

      {pasteHelper !== null && (
        <div style={{ border: '1px dashed #009530', borderRadius: 6, padding: '0.6rem', background: '#F0FDF4', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
          <div style={{ fontSize: '0.74rem', fontWeight: 700, color: '#166534' }}>
            Paste your Excel data here (Ctrl/⌘+V), then click Import:
          </div>
          <textarea
            autoFocus
            value={pasteHelper}
            onChange={e => setPasteHelper(e.target.value)}
            placeholder="Paste a block copied from Excel: first row should be the headers (Company, Zoom Company ID, …)."
            style={{ width: '100%', minHeight: 90, padding: '0.4rem', border: '1px solid #86EFAC', borderRadius: 4, fontSize: '0.78rem', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', boxSizing: 'border-box', resize: 'vertical' }}
          />
          <div style={{ display: 'flex', gap: '0.4rem', justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={() => setPasteHelper(null)}
              style={{ fontSize: '0.72rem', padding: '0.3rem 0.7rem', border: '1px solid var(--color-border)', background: '#fff', color: 'var(--color-text-secondary)', borderRadius: 4, cursor: 'pointer', fontWeight: 600 }}
            >Cancel</button>
            <button
              type="button"
              disabled={!pasteHelper.trim()}
              onClick={() => { ingestPastedText(pasteHelper); setPasteHelper(null); }}
              style={{ fontSize: '0.72rem', padding: '0.3rem 0.8rem', border: 'none', background: pasteHelper.trim() ? '#009530' : '#CBD5E1', color: '#fff', borderRadius: 4, cursor: pasteHelper.trim() ? 'pointer' : 'not-allowed', fontWeight: 700 }}
            >Import</button>
          </div>
        </div>
      )}

      <div style={{ flex: 1, overflow: 'auto', border: '1px solid var(--color-border)', borderRadius: 4 }}>
        <table style={{ borderCollapse: 'collapse', fontSize: '0.8rem', tableLayout: 'fixed', width: 'max-content', minWidth: '100%' }}>
          <colgroup>
            {visibleColumnList.map(c => (
              <col
                key={c.key}
                ref={el => { colRefs.current[c.key] = el; }}
                style={{ width: `${columnWidths[c.key]}px` }}
              />
            ))}
            <col style={{ width: 44 }} />
          </colgroup>
          <thead>
            <tr>
              {visibleColumnList.map(c => (
                <th key={c.key} style={{
                  textAlign: 'left',
                  padding: '0.45rem 0.6rem',
                  paddingRight: '0.95rem',
                  background: '#F1F5F9',
                  fontWeight: 700,
                  fontSize: '0.72rem',
                  color: '#475569',
                  borderBottom: '1px solid var(--color-border)',
                  // sticky doubles as the positioning context for the
                  // absolutely-positioned resize handle below.
                  position: 'sticky',
                  top: 0,
                  zIndex: 1,
                  overflow: 'hidden',
                  whiteSpace: 'nowrap',
                  textOverflow: 'ellipsis',
                }}>
                  <span style={{ position: 'relative', display: 'block' }}>
                    {c.label}
                  </span>
                  <span
                    onMouseDown={e => startResize(e, c.key)}
                    onDoubleClick={() => {
                      const def = COLUMNS.find(x => x.key === c.key)?.defaultWidth;
                      if (!def) return;
                      const nextMap = { ...(settings?.zoomInfoColumnWidths || {}) };
                      delete nextMap[c.key];
                      updateSettings({ zoomInfoColumnWidths: nextMap });
                    }}
                    title="Drag to resize. Double-click to reset this column to its default width."
                    style={{
                      position: 'absolute',
                      top: 0,
                      right: 0,
                      width: 8,
                      height: '100%',
                      cursor: 'col-resize',
                      userSelect: 'none',
                      zIndex: 2,
                      // Subtle indicator: a hairline that lights up on
                      // hover so the user can find the handle.
                      borderRight: '1px solid #E2E8F0',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.borderRight = '2px solid #009530'; }}
                    onMouseLeave={e => { e.currentTarget.style.borderRight = '1px solid #E2E8F0'; }}
                  />
                </th>
              ))}
              <th style={{ background: '#F1F5F9', borderBottom: '1px solid var(--color-border)', position: 'sticky', top: 0, zIndex: 1 }} />
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={visibleColumnList.length + 1} style={{ padding: '1.2rem', textAlign: 'center', color: 'var(--color-text-muted)', fontStyle: 'italic', fontSize: '0.78rem' }}>
                  No matches for the current search.
                </td>
              </tr>
            )}
            {filtered.map(r => {
              const isPad = String(r.id).startsWith('__pad_');
              const suggestion = suggestCompany(r.company);
              return (
                <tr key={r.id} style={{ borderBottom: '1px solid var(--color-border-light)' }}>
                  {visibleColumnList.map(c => (
                    <td key={c.key} style={{ padding: 0, verticalAlign: 'top' }}>
                      {c.key === 'company' ? (
                        <CompanyAutocomplete
                          value={r[c.key] || ''}
                          onCommit={v => updateCell(r.id, c.key, v)}
                          suggestions={companyOptions}
                          placeholder={isPad ? 'Type a company…' : '-'}
                          style={cellInputStyle}
                        />
                      ) : c.key === 'tvStatus' ? (
                        <div style={{ padding: '0.45rem 0.6rem', minHeight: '1.4rem' }}>
                          {(() => {
                            const company = (r.company || '').trim();
                            if (!company) {
                              return <span style={{ color: '#CBD5E1', fontSize: '0.74rem', fontStyle: 'italic' }}>-</span>;
                            }
                            const onTV = !!findProspectByCompany(company);
                            if (onTV) {
                              return (
                                <span
                                  title={`"${company}" is already on Table View.`}
                                  style={{ background: '#DCFCE7', border: '1px solid #86EFAC', color: '#166534', padding: '2px 8px', borderRadius: 999, fontSize: '0.7rem', fontWeight: 700, whiteSpace: 'nowrap' }}
                                >✓ On Table View</span>
                              );
                            }
                            if (!onAddProspect || isPad) {
                              return <span style={{ color: '#CBD5E1', fontSize: '0.74rem', fontStyle: 'italic' }}>-</span>;
                            }
                            return (
                              <button
                                type="button"
                                onClick={() => addRowToTableView(r)}
                                title={`Create a new Table View account for "${company}". CDM / Tier / Type / Zoom ID / Name / Website on this row carry over.`}
                                style={{
                                  background: '#fff', border: '1px solid #0EA5E9', color: '#0369A1',
                                  padding: '2px 8px', borderRadius: 999, fontSize: '0.7rem',
                                  fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
                                }}
                              >+ Add to Table View</button>
                            );
                          })()}
                        </div>
                      ) : c.key === 'cm' ? (
                        (() => {
                          const cm = lookupCm(r.company);
                          return (
                            <div style={{ padding: '0.45rem 0.6rem', minHeight: '1.4rem' }}>
                              {cm ? (
                                <span
                                  title={`From RA Clients sheet · matched against "${r.company}"`}
                                  style={{ fontSize: '0.74rem', color: '#166534', fontWeight: 600 }}
                                >{cm}</span>
                              ) : (
                                <span style={{ color: '#CBD5E1', fontSize: '0.74rem', fontStyle: 'italic' }}>-</span>
                              )}
                            </div>
                          );
                        })()
                      ) : c.key === 'type' ? (
                        <TypeDropdown
                          value={r.type || ''}
                          options={dynamicTypeOptions}
                          onChange={v => updateCell(r.id, 'type', v)}
                          onAddNew={(name) => {
                            addCustomType(name);
                            updateCell(r.id, 'type', name);
                          }}
                        />
                      ) : c.key === 'suggestedCompany' ? (
                        <div style={{ padding: '0.45rem 0.6rem', minHeight: '1.4rem' }}>
                          {(r.acceptedSuggestion && r.acceptedSuggestion === r.company) ? (
                            <span
                              title={`Accepted Table View match: "${r.acceptedSuggestion}". Click × to clear.`}
                              style={{
                                display: 'inline-flex', alignItems: 'center', gap: 4,
                                background: '#DCFCE7', border: '1px solid #86EFAC', color: '#166534',
                                padding: '2px 8px', borderRadius: 999, fontSize: '0.7rem',
                                fontWeight: 600, fontFamily: 'inherit',
                                maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                              }}
                            >
                              ✓ {r.acceptedSuggestion}
                              <button
                                type="button"
                                onClick={() => updateCell(r.id, 'acceptedSuggestion', '')}
                                title="Clear accepted suggestion"
                                style={{ border: 'none', background: 'transparent', color: '#16A34A', cursor: 'pointer', padding: 0, fontSize: '0.85rem', lineHeight: 1, fontWeight: 700 }}
                              >×</button>
                            </span>
                          ) : suggestion ? (
                            <button
                              type="button"
                              onClick={() => acceptSuggestion(r.id, suggestion.name)}
                              title={`Click to replace "${r.company}" with the Table View match "${suggestion.name}" (score ${suggestion.score}/100). The Zoom ID / Name / Website / CDM / Tier columns will auto-fill from that prospect.`}
                              style={{
                                background: '#FEF3C7', border: '1px solid #FCD34D', color: '#92400E',
                                padding: '2px 8px', borderRadius: 999, fontSize: '0.7rem',
                                fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                                maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                              }}
                            >→ {suggestion.name}</button>
                          ) : (
                            <span style={{ color: '#CBD5E1', fontSize: '0.74rem', fontStyle: 'italic' }}>-</span>
                          )}
                        </div>
                      ) : (
                        <CommitOnBlurInput
                          value={r[c.key] || ''}
                          onCommit={v => updateCell(r.id, c.key, v)}
                          placeholder="-"
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
                        title="Delete row"
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
        document.body
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

  const missingRequired = PASTE_TARGETS
    .filter(t => t.required && !mapping[t.key])
    .map(t => t.label);

  // Preview: pull the first 3 data rows and project them through the
  // current mapping so the user can sanity-check before importing.
  const previewRows = rows.slice(0, 3);
  const idxOf = useMemo(() => {
    const o = {};
    headers.forEach((h, i) => { o[h] = i; });
    return o;
  }, [headers]);

  const colHeader = { fontSize: '0.7rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.04em', padding: '0.5rem 0.75rem', background: '#F8FAFC', borderBottom: '1px solid #E2E8F0' };
  const cellBase = { padding: '0.4rem 0.75rem', borderBottom: '1px solid #F1F5F9', fontSize: '0.78rem' };

  return (
    <div
      onClick={onCancel}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000 }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ background: '#fff', borderRadius: 12, padding: '1.5rem', width: 1000, maxWidth: '95vw', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.25)' }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: 'var(--color-text)' }}>Paste from Excel: Column Mapping</h3>
          <button
            onClick={onCancel}
            style={{ background: 'none', border: 'none', fontSize: '1.2rem', color: '#94A3B8', cursor: 'pointer', lineHeight: 1 }}
          >×</button>
        </div>
        <p style={{ fontSize: '0.72rem', color: 'var(--color-text-secondary)', margin: '0 0 1rem 0', lineHeight: 1.4 }}>
          Detected <strong>{rows.length.toLocaleString()}</strong> row{rows.length === 1 ? '' : 's'} and <strong>{headers.length}</strong> column{headers.length === 1 ? '' : 's'} from your clipboard. The first row was treated as headers: pick which file column should fill each Zoom Info field. Headers that already match common names ("Zoom Company ID", "Website", etc.) are mapped automatically.
        </p>
        {missingRequired.length > 0 && (
          <div style={{ margin: '0 0 0.75rem', padding: '0.4rem 0.6rem', background: '#FEE2E2', border: '1px solid #FCA5A5', borderRadius: 6, fontSize: '0.75rem', color: '#991B1B', fontWeight: 600 }}>
            Still need to map: {missingRequired.join(', ')}
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
          {/* LEFT — target fields */}
          <div style={{ border: '1px solid #E2E8F0', borderRadius: 6, overflow: 'auto' }}>
            <div style={colHeader}>Zoom Info field</div>
            {PASTE_TARGETS.map(t => {
              const header = mapping[t.key];
              return (
                <div key={t.key} style={{ ...cellBase, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {t.label}
                    {t.required && <span style={{ color: '#DC2626', marginLeft: 2 }}>*</span>}
                  </span>
                  {header ? (
                    <span
                      title={`Mapped from "${header}"`}
                      style={{ background: '#DCFCE7', border: '1px solid #86EFAC', color: '#166534', padding: '1px 8px', borderRadius: 999, fontSize: '0.68rem', fontWeight: 600, maxWidth: '55%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                    >← {header}</span>
                  ) : (
                    <span style={{ color: t.required ? '#DC2626' : '#94A3B8', fontSize: '0.68rem', fontWeight: 600 }}>
                      {t.required ? '(not mapped)' : '(optional)'}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
          {/* RIGHT — source columns */}
          <div style={{ border: '1px solid #E2E8F0', borderRadius: 6, overflow: 'auto' }}>
            <div style={colHeader}>Columns in your paste ({headers.length})</div>
            {headers.map(h => {
              const target = targetForHeader[h] || '';
              return (
                <div key={h} style={{ ...cellBase, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <span
                    title={h}
                    style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                  >{h}</span>
                  <span style={{ color: '#94A3B8', fontSize: '0.7rem' }}>→</span>
                  <select
                    value={target}
                    onChange={e => onChangeMapping(h, e.target.value)}
                    style={{
                      minWidth: 170, maxWidth: 220, padding: '0.25rem 0.4rem',
                      border: '1px solid var(--color-border)', borderRadius: 4,
                      fontFamily: 'inherit', fontSize: '0.75rem',
                      background: target ? '#DCFCE7' : '#fff',
                      color: target ? '#166534' : 'var(--color-text)',
                    }}
                  >
                    <option value="">(Ignore)</option>
                    {PASTE_TARGETS.map(t => (
                      <option key={t.key} value={t.key}>
                        {t.label}{t.required ? ' *' : ''}
                      </option>
                    ))}
                  </select>
                </div>
              );
            })}
          </div>
        </div>

        {/* Preview */}
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
                      <td key={t.key} style={{ ...cellBase, color: v ? '#1E293B' : '#CBD5E1', fontStyle: v ? 'normal' : 'italic' }}>
                        {v || '-'}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '1.25rem' }}>
          <button
            onClick={onCancel}
            style={{ padding: '0.5rem 1rem', border: '1px solid var(--color-border)', borderRadius: 6, background: '#fff', fontSize: '0.8rem', fontFamily: 'inherit', cursor: 'pointer', color: 'var(--color-text-secondary)' }}
          >Cancel</button>
          <button
            onClick={onConfirm}
            disabled={missingRequired.length > 0}
            style={{
              padding: '0.5rem 1rem', border: 'none', borderRadius: 6,
              background: missingRequired.length ? '#CBD5E1' : '#009530',
              color: '#fff', fontSize: '0.8rem', fontFamily: 'inherit',
              cursor: missingRequired.length ? 'not-allowed' : 'pointer', fontWeight: 600,
            }}
          >Import {rows.length.toLocaleString()} row{rows.length === 1 ? '' : 's'}</button>
        </div>
      </div>
    </div>
  );
}
