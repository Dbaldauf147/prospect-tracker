import { useCallback, useEffect, useMemo, useRef, useState, memo } from 'react';
import { createPortal } from 'react-dom';
import { CommitOnBlurInput } from '../common/CommitOnBlurInput';
import { SF_INSTANCE_URL, resolveSfUrl } from '../../utils/salesforceLeads';
import { getHubspotContacts, updateHubspotCache, notifyCacheUpdated } from '../../utils/hubspotContactsCache';
import { apiFetch } from '../../utils/apiFetch';
import { STATUS_COLORS } from '../../data/enums';
import { resolveTargetAccountCdm } from '../../utils/cdmMatch';
import { ContactEditModal } from '../ProspectModal/ProspectModal';
import { getEffectiveDropdownLists } from '../../utils/dropdownListsStore';

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
  { key: 'sfUrl',               label: 'Salesforce Link',            defaultWidth: 120 },
  { key: 'email',               label: 'Email',                      defaultWidth: 220 },
  { key: 'jobTitle',            label: 'Job Title',                  defaultWidth: 170 },
  { key: 'company',             label: 'Company',                    defaultWidth: 190 },
  { key: 'mappedCompany',       label: 'Company Mapping',            defaultWidth: 200 },
  { key: 'companyStatus',       label: 'Company Status',             defaultWidth: 150, readonly: true },
  { key: 'companyCdm',          label: 'CDM',                        defaultWidth: 140, readonly: true },
  { key: 'hubspotContact',      label: 'HubSpot Contact',            defaultWidth: 220 },
  { key: 'hubspotTitle',        label: 'HubSpot Title',              defaultWidth: 170, readonly: true },
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

// Note stamped onto a HubSpot contact the moment it's created from a
// Marketing Lead, so its origin is recorded on the contact's timeline
// (and mirrored into the app's Notes column).
const MARKETING_LEAD_NOTE = 'Marketing Lead';

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
  // Salesforce record link / id. Auto-filled from the clipboard's HTML
  // anchors when pasting a list view; a mapped URL / Lead-ID column takes
  // precedence. Listed last so its generic aliases (url / id / link)
  // don't claim a header a more specific field wants.
  { key: 'sfUrl',               label: 'Salesforce Link',            required: false,
    aliases: ['salesforcelink', 'salesforceurl', 'sfurl', 'sflink', 'leadurl', 'recordurl', 'url', 'link', 'leadid', 'recordid', 'id'] },
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

// A lead whose Status is "Closed-Recycle" (any spacing / punctuation:
// "Closed - Recycle", "Closed Recycle", …). These are dead leads — shown
// with a red background and sunk below the active leads.
function isClosedRecycle(row) {
  return String(row?.status || '').toLowerCase().replace(/[^a-z0-9]/g, '') === 'closedrecycle';
}

// Lead-status classification for the close-rate summary. Statuses are
// free-form text pasted from the Salesforce Leads list, so we match
// loosely: a converted lead is a "win", a Closed-Recycle lead is a
// "loss", and together they make up the closed (decided) population.
// Close rate = wins / decided. Everything still open (Working, Nurture,
// Qualified, …) is excluded from the denominator so in-flight leads
// don't drag the rate down.
function isWonStatus(status) {
  const s = String(status || '').toLowerCase();
  return /convert/.test(s); // "Closed - Converted"
}
function isLostStatus(status) {
  const s = String(status || '').toLowerCase();
  return /recycle/.test(s); // "Closed - Recycle" — lost on this page
}
function computeCloseStats(rows) {
  let won = 0;
  let lost = 0;
  for (const r of rows) {
    if (isWonStatus(r.status)) won++;
    else if (isLostStatus(r.status)) lost++;
  }
  const decided = won + lost;
  return { won, lost, decided, rate: decided ? won / decided : null };
}

// Salesforce-link resolution (SF_INSTANCE_URL / resolveSfUrl) is shared
// with the Agents Activity table via utils/salesforceLeads.

// Pull the per-lead record links out of the clipboard's text/html payload
// (Salesforce list rows carry the record URL as an <a href> on the Name
// cell). Returns a map of lower-cased anchor text → absolute URL, or null
// when nothing usable is found. Relative Lightning hrefs are resolved
// against the SF instance. Parsing is done with DOMParser, which never
// executes scripts or loads sub-resources.
function extractLeadLinks(html) {
  if (!html || typeof DOMParser === 'undefined') return null;
  let doc;
  try { doc = new DOMParser().parseFromString(html, 'text/html'); } catch { return null; }
  if (!doc) return null;
  const map = {};
  for (const a of doc.querySelectorAll('a[href]')) {
    const text = (a.textContent || '').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    let href = a.getAttribute('href') || '';
    if (!href) continue;
    if (/^https?:\/\//i.test(href)) {
      if (!/force\.com|salesforce\.com/i.test(href)) continue;
    } else if (href.startsWith('/')) {
      href = SF_INSTANCE_URL + href;
    } else {
      continue;
    }
    const key = text.toLowerCase();
    if (!(key in map)) map[key] = href;
  }
  return Object.keys(map).length ? map : null;
}

// Salesforce lists render person names "Last, First" (e.g. "Blancarte,
// Victor"). Flip a simple "Last, First" into "First Last" for display,
// HubSpot matching, and the create-contact name split. Names without a
// comma pass through untouched, and it's idempotent so re-running never
// re-flips an already-normalised name.
function normalizeLeadName(raw) {
  const s = String(raw || '').trim();
  if (!s) return s;
  const ci = s.indexOf(',');
  if (ci === -1) return s;
  const last = s.slice(0, ci).trim();
  const first = s.slice(ci + 1).trim();
  // Only flip a clean two-part "Last, First" — bail on empty halves or a
  // multi-comma value so odd inputs aren't mangled.
  if (!last || !first || first.includes(',')) return s;
  return `${first} ${last}`;
}

function nameKey(s) {
  return String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
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

// Display helpers for a cached HubSpot contact record (slim shape: id /
// vid, firstname, lastname, email, …).
function hubspotName(c) {
  return [c?.firstname, c?.lastname].filter(Boolean).join(' ').trim();
}
function hubspotDisplay(c) {
  const name = hubspotName(c);
  const email = (c?.email || '').trim();
  if (name && email) return `${name} — ${email}`;
  return name || email || '(unnamed contact)';
}

// Type-to-search picker over the cached HubSpot contacts. Filters by
// name / email substring; picking a row hands the whole contact object
// back to onPick. Same interaction model as the Company picker.
const HubSpotContactAutocomplete = memo(function HubSpotContactAutocomplete({ contacts, onPick, placeholder, style }) {
  const [draft, setDraft] = useState('');
  const [open, setOpen] = useState(false);
  const [hoverIdx, setHoverIdx] = useState(0);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    function onDocDown(e) { if (!wrapRef.current?.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', onDocDown);
    return () => document.removeEventListener('mousedown', onDocDown);
  }, [open]);

  const matches = useMemo(() => {
    const q = draft.trim().toLowerCase();
    if (!q || !contacts?.length) return [];
    const out = [];
    for (const c of contacts) {
      const name = hubspotName(c).toLowerCase();
      const email = (c.email || '').toLowerCase();
      if (name.includes(q) || email.includes(q)) out.push(c);
      if (out.length >= 8) break;
    }
    return out;
  }, [draft, contacts]);

  function pick(c) { if (c) onPick(c); setDraft(''); setOpen(false); }

  function handleKey(e) {
    if (open && matches.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setHoverIdx(i => (i + 1) % matches.length); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setHoverIdx(i => (i - 1 + matches.length) % matches.length); return; }
      if (e.key === 'Enter') { e.preventDefault(); pick(matches[hoverIdx] || matches[0]); return; }
      if (e.key === 'Escape') { e.preventDefault(); setOpen(false); return; }
    }
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <input
        type="text"
        value={draft}
        onChange={e => { setDraft(e.target.value); setOpen(true); setHoverIdx(0); }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKey}
        placeholder={placeholder}
        style={style}
      />
      {open && matches.length > 0 && (
        <div
          onMouseDown={e => e.preventDefault()}
          style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 5, background: '#fff', border: '1px solid var(--color-border)', borderRadius: 4, boxShadow: '0 8px 20px rgba(15, 23, 42, 0.12)', maxHeight: 240, overflowY: 'auto', fontSize: '0.75rem', minWidth: 240 }}
        >
          {matches.map((c, i) => (
            <div
              key={String(c.id || c.vid || i)}
              onClick={() => pick(c)}
              onMouseEnter={() => setHoverIdx(i)}
              style={{ padding: '0.35rem 0.6rem', cursor: 'pointer', background: i === hoverIdx ? '#DCFCE7' : 'transparent', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
            >
              <span style={{ fontWeight: 600, color: '#1E293B' }}>{hubspotName(c) || '(no name)'}</span>
              {c.email && <span style={{ color: '#64748B' }}> — {c.email}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
});

export function MarketingLeadsView({ prospects = [], settings, updateSettings, onAddProspect, onSelectProspect, targetAccountsData }) {
  const persistedRows = useMemo(() => {
    const arr = Array.isArray(settings?.marketingLeads) ? settings.marketingLeads : [];
    return arr.map(r => {
      const base = { ...emptyRow(), ...r, id: r.id || makeId() };
      // Heal legacy rows stored as "Last, First" so they display (and
      // match / add to HubSpot) as "First Last". Idempotent — any later
      // write persists the normalised form.
      if (base.name) base.name = normalizeLeadName(base.name);
      return base;
    });
  }, [settings]);

  // Status column options come from the "Marketing Lead Status" list on
  // the Dropdowns tab, so the vocabulary is managed in one place. Matched
  // by its stable built-in key, falling back to a case-insensitive label
  // match so a user-created custom list of the same name also binds.
  const statusOptions = useMemo(() => {
    const lists = getEffectiveDropdownLists(settings);
    const norm = s => String(s || '').trim().toLowerCase();
    // Prefer a user-created custom list named "Marketing Lead Status"
    // (they built it deliberately), then the built-in list, then any
    // remaining label match.
    const list = lists.find(l => !l.builtin && norm(l.label) === 'marketing lead status')
      || lists.find(l => l.key === 'marketingLeadStatus')
      || lists.find(l => norm(l.label) === 'marketing lead status');
    return Array.isArray(list?.options) ? list.options.filter(o => String(o || '').trim()) : [];
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

  // Column order — persisted via settings.marketingLeadsColumnOrder as a
  // list of column keys. Any key that's since been removed is dropped, and
  // any newly added column (not yet in the saved order) is appended so a
  // future column never disappears. Falls back to the natural COLUMNS
  // order. Order covers hidden columns too, so toggling a column back on
  // restores it to its chosen position.
  const orderedColumns = useMemo(() => {
    const saved = settings?.marketingLeadsColumnOrder;
    const byKey = new Map(COLUMNS.map(c => [c.key, c]));
    if (!Array.isArray(saved) || !saved.length) return COLUMNS;
    const seen = new Set();
    const out = [];
    for (const k of saved) {
      const c = byKey.get(k);
      if (c && !seen.has(k)) { out.push(c); seen.add(k); }
    }
    for (const c of COLUMNS) if (!seen.has(c.key)) out.push(c);
    return out;
  }, [settings]);

  // Move `fromKey` to sit before (or after) `toKey` and persist the new
  // order. Operates on the full column list so hidden columns keep their
  // relative position.
  function moveColumn(fromKey, toKey, placeAfter = false) {
    if (!fromKey || !toKey || fromKey === toKey) return;
    const keys = orderedColumns.map(c => c.key);
    const from = keys.indexOf(fromKey);
    if (from === -1) return;
    keys.splice(from, 1);
    let to = keys.indexOf(toKey);
    if (to === -1) return;
    if (placeAfter) to += 1;
    keys.splice(to, 0, fromKey);
    updateSettings({ marketingLeadsColumnOrder: keys });
  }
  // Shift a column one slot left / right among ALL columns (used by the
  // Columns dropdown's ▲/▼ controls).
  function nudgeColumn(key, dir) {
    const keys = orderedColumns.map(c => c.key);
    const i = keys.indexOf(key);
    const j = i + dir;
    if (i === -1 || j < 0 || j >= keys.length) return;
    [keys[i], keys[j]] = [keys[j], keys[i]];
    updateSettings({ marketingLeadsColumnOrder: keys });
  }
  const hasCustomOrder = Array.isArray(settings?.marketingLeadsColumnOrder) && settings.marketingLeadsColumnOrder.length > 0;
  function resetColumnOrder() {
    updateSettings({ marketingLeadsColumnOrder: [] });
  }

  const visibleColumnList = useMemo(
    () => orderedColumns.filter(c => visibleCols.has(c.key)),
    [orderedColumns, visibleCols],
  );

  // Header drag-to-reorder state. dragColKey is the column being dragged;
  // dragOverKey / dragAfter drive the drop indicator on the hovered header.
  const [dragColKey, setDragColKey] = useState('');
  const [dragOverKey, setDragOverKey] = useState('');
  const [dragAfter, setDragAfter] = useState(false);

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

  // Definite table width = sum of the visible column widths (+ 44px for
  // the action column). Giving the table an explicit width keeps
  // table-layout:fixed authoritative, so every column honors its dragged
  // width and long cell text (e.g. a HubSpot Title) clips with an ellipsis
  // instead of stretching the column. `width: max-content` let wide
  // readonly cells grow past the dragged width.
  const tableWidth = useMemo(
    () => visibleColumnList.reduce((sum, c) => sum + (columnWidths[c.key] || 0), 0) + 44,
    [visibleColumnList, columnWidths],
  );

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

  // Cross-CDM account lookup from the uploaded Target Accounts workbook
  // (Lists → Target Accounts). Unlike `prospects` — which holds only the
  // current user's own accounts — this spans every CDM's accounts, so a
  // lead mapped to a company another CDM owns still resolves a Status and
  // its CDM. Keyed by lower-cased and strip-normalized company name.
  const targetAccountsIndex = useMemo(() => {
    const map = new Map();
    const data = targetAccountsData;
    if (!data?.sheets) return map;
    const findCol = (r, keywords) => {
      for (const key of Object.keys(r)) {
        const lower = key.toLowerCase();
        for (const kw of keywords) {
          if (lower.includes(kw)) return String(r[key] || '').trim();
        }
      }
      return '';
    };
    const cdmCol = settings?.targetRepColumn || settings?.targetCdmColumn;
    for (const sheetName of data.sheetNames || []) {
      const sheet = data.sheets[sheetName];
      if (!sheet?.records) continue;
      for (const r of sheet.records) {
        const company = findCol(r, ['account', 'company', 'client', 'name']);
        if (!company) continue;
        const rec = { name: company.trim(), status: findCol(r, ['status']), cdm: resolveTargetAccountCdm(r, cdmCol) };
        const keyLower = company.toLowerCase().trim();
        if (keyLower && !map.has(keyLower)) map.set(keyLower, rec);
        const norm = prospectIndex.strip(company);
        if (norm && !map.has(norm)) map.set(norm, rec);
      }
    }
    return map;
  }, [targetAccountsData, settings?.targetRepColumn, settings?.targetCdmColumn, prospectIndex]);

  function findTargetAccount(company) {
    if (!company) return null;
    const direct = targetAccountsIndex.get(String(company).toLowerCase().trim());
    if (direct) return direct;
    const norm = prospectIndex.strip(company);
    return norm ? targetAccountsIndex.get(norm) || null : null;
  }

  // Every account that carries a non-empty Status — the user's own Table
  // View accounts plus the cross-CDM Target Accounts — used to borrow a
  // status for a company whose exact record has a blank one.
  const companyStatusCandidates = useMemo(() => {
    const out = [];
    for (const p of prospects) {
      const name = (p?.company || '').trim();
      const status = (p?.status || '').trim();
      if (!name || !status || isPlaceholderCompany(name)) continue;
      out.push({ name, status, cdm: (p.cdm || '').trim(), owned: true });
    }
    const seen = new Set();
    for (const rec of targetAccountsIndex.values()) {
      if (!rec.name || !rec.status) continue;
      const k = rec.name.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ name: rec.name, status: rec.status, cdm: rec.cdm, owned: false });
    }
    return out;
  }, [prospects, targetAccountsIndex]);

  // Closest account (by name) that HAS a status, for when a company's own
  // record is blank — so "JP Morgan Asset Management" (no status) can
  // surface the status of a sibling like "JP Morgan Asset Management Real
  // Estate". Requires a containment / strong token overlap so unrelated
  // same-word companies (e.g. a different "JP Morgan Chase") don't leak in.
  function fuzzyStatusFor(company) {
    const target = prospectIndex.strip(company);
    if (!target) return null;
    const targetTokens = new Set(target.split(' ').filter(Boolean));
    if (!targetTokens.size) return null;
    let best = null;
    let bestScore = 0;
    for (const e of companyStatusCandidates) {
      const norm = prospectIndex.strip(e.name);
      if (!norm) continue;
      let score = 0;
      if (norm === target) score = 100;
      else if (norm.startsWith(target) || target.startsWith(norm)) score = 85;
      else if (norm.includes(target) || target.includes(norm)) score = 75;
      else {
        const optTokens = new Set(norm.split(' ').filter(Boolean));
        let inter = 0;
        for (const t of targetTokens) if (optTokens.has(t)) inter++;
        if (!inter) continue;
        const union = targetTokens.size + optTokens.size - inter;
        score = Math.round((inter / union) * 60);
      }
      // On ties, prefer the user's own account.
      if (score > bestScore || (score === bestScore && e.owned && !best?.owned)) { best = e; bestScore = score; }
    }
    return bestScore >= 70 ? best : null;
  }

  // Combined company info for a lead's company: the user's own Table View
  // account wins (richest, editable data); otherwise the cross-CDM Target
  // Accounts list. When the exact record's Status is blank, borrow one
  // from the closest related account that has a status (statusFrom names
  // it). Returns { status, cdm, name, owned, statusFrom } or null.
  function lookupCompanyInfo(company) {
    const c = String(company || '').trim();
    if (!c) return null;
    const p = findProspectByCompany(c);
    let primary = null;
    if (p) primary = { status: (p.status || '').trim(), cdm: (p.cdm || '').trim(), name: (p.company || c).trim(), owned: true };
    else {
      const t = findTargetAccount(c);
      if (t) primary = { status: (t.status || '').trim(), cdm: (t.cdm || '').trim(), name: (t.name || c).trim(), owned: false };
    }
    if (primary?.status) return primary;
    // Exact record has no status (or no exact match) — borrow one from the
    // closest related account that does.
    const fuzzy = fuzzyStatusFor(c);
    if (fuzzy) {
      const fromName = fuzzy.name !== (primary?.name || c) ? fuzzy.name : null;
      return {
        status: fuzzy.status,
        cdm: primary?.cdm || fuzzy.cdm,
        name: primary?.name || c,
        owned: primary?.owned ?? fuzzy.owned,
        statusFrom: fromName,
      };
    }
    return primary;
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

  // ---- HubSpot contact mapping ----------------------------------------
  // Cached HubSpot contacts, loaded from IndexedDB and kept fresh via the
  // shared hubspot-cache-updated event (same source the Contacts page
  // subtabs read from). Used to auto-match leads and to power the picker.
  const [hubspotContacts, setHubspotContacts] = useState([]);
  const [hubspotBusyId, setHubspotBusyId] = useState('');
  const [bulkAddingHubspot, setBulkAddingHubspot] = useState(false);
  useEffect(() => {
    let alive = true;
    const load = () => {
      getHubspotContacts()
        .then(cs => { if (alive) setHubspotContacts(Array.isArray(cs) ? cs : []); })
        .catch(() => {});
    };
    load();
    window.addEventListener('hubspot-cache-updated', load);
    return () => { alive = false; window.removeEventListener('hubspot-cache-updated', load); };
  }, []);

  const hubspotByEmail = useMemo(() => {
    const m = new Map();
    for (const c of hubspotContacts) {
      const e = (c.email || '').toLowerCase().trim();
      if (e && !m.has(e)) m.set(e, c);
    }
    return m;
  }, [hubspotContacts]);
  const hubspotByName = useMemo(() => {
    const m = new Map();
    for (const c of hubspotContacts) {
      const n = hubspotName(c).toLowerCase();
      if (n && !m.has(n)) m.set(n, c);
    }
    return m;
  }, [hubspotContacts]);
  const hubspotById = useMemo(() => {
    const m = new Map();
    for (const c of hubspotContacts) {
      const id = String(c.id || c.vid || '');
      if (id) m.set(id, c);
    }
    return m;
  }, [hubspotContacts]);

  const findHubspotById = (id) => (id ? hubspotById.get(String(id)) || null : null);

  // Job title of the HubSpot contact a lead is mapped to. Prefers the live
  // cached record so it tracks title changes in HubSpot; falls back to the
  // snapshot stored at mapping time when the contact isn't in the cache.
  function hubspotTitleForRow(r) {
    const live = r.hubspotContactId ? findHubspotById(r.hubspotContactId) : null;
    return String(live?.jobtitle || r.hubspotContactTitle || '').trim();
  }

  // Best existing HubSpot contact for a lead: an exact email match wins
  // (kind 'email'), else an exact full-name match (kind 'name'). Null when
  // neither hits, in which case the cell offers "+ Add to HubSpot".
  function bestHubspotMatch(row) {
    const email = (row.email || '').toLowerCase().trim();
    if (email && hubspotByEmail.has(email)) return { contact: hubspotByEmail.get(email), kind: 'email' };
    const name = (row.name || '').toLowerCase().trim();
    if (name && hubspotByName.has(name)) return { contact: hubspotByName.get(name), kind: 'name' };
    return null;
  }

  // Persist a lead → HubSpot contact mapping (or clear it with contact =
  // null). Stores the contact id plus a display-label snapshot so the
  // cell still reads sensibly if the contact later drops out of the cache.
  function setHubspotMapping(rowId, contact) {
    const id = contact ? String(contact.id || contact.vid || '') : '';
    const label = contact ? hubspotDisplay(contact) : '';
    const title = contact ? String(contact.jobtitle || '').trim() : '';
    if (String(rowId).startsWith('__pad_')) {
      if (!id) return;
      persist([...persistedRows, { ...emptyRow(), hubspotContactId: id, hubspotContact: label, hubspotContactTitle: title }]);
      return;
    }
    persist(persistedRows.map(r => (r.id === rowId ? { ...r, hubspotContactId: id, hubspotContact: label, hubspotContactTitle: title } : r)));
  }

  // Build the HubSpot contact properties for a lead. Name is split into
  // first / last on whitespace (the name is already normalised to
  // "First Last"), company prefers the mapped Table View account.
  function hubspotPropsForRow(row) {
    const name = (row.name || '').trim();
    const email = (row.email || '').trim();
    const props = {};
    if (name) {
      const parts = name.split(/\s+/);
      props.firstname = parts[0];
      if (parts.length > 1) props.lastname = parts.slice(1).join(' ');
    }
    if (email) props.email = email;
    const companyName = (row.mappedCompany || '').trim() || (row.company || '').trim();
    if (companyName) props.company = companyName;
    if ((row.jobTitle || '').trim()) props.jobtitle = row.jobTitle.trim();
    return props;
  }

  // Create one HubSpot contact from a lead via the same create-contact
  // endpoint the Prospect modal uses. Returns { ok, contact, error }
  // without touching state, so both the single-row and bulk callers can
  // reuse it and batch their cache / mapping writes.
  async function createHubspotContactForRow(row) {
    const name = (row.name || '').trim();
    const email = (row.email || '').trim();
    if (!name && !email) return { ok: false, error: 'needs a name or email' };
    try {
      const res = await apiFetch('/api/hubspot?action=create-contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ properties: hubspotPropsForRow(row) }),
      });
      const data = await res.json().catch(() => null);
      if (data?.success && data?.contact) return { ok: true, contact: data.contact };
      return { ok: false, error: data?.error || 'create failed' };
    } catch (err) {
      return { ok: false, error: err?.message || String(err) };
    }
  }

  // Post a note engagement to a HubSpot contact (its own timeline entry,
  // not a contact property). Returns true when it lands. Best-effort —
  // the caller ignores failures so a note hiccup never blocks the create.
  async function postHubspotContactNote(contactId, body) {
    const id = String(contactId || '');
    const text = String(body || '').trim();
    if (!id || !text) return false;
    try {
      const res = await apiFetch('/api/hubspot?action=create-contact-note', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactId: id, body: text }),
      });
      const data = await res.json().catch(() => null);
      return !!(data?.success || data?.note || data?.engagement);
    } catch {
      return false;
    }
  }

  // Create a brand-new HubSpot contact from the lead's fields, push it
  // into the local cache, map the lead to it, and stamp a "Marketing
  // Lead" note on the contact.
  async function addLeadToHubspot(row) {
    if (String(row.id).startsWith('__pad_')) return;
    if (!(row.name || '').trim() && !(row.email || '').trim()) {
      window.alert('This lead needs at least a name or email to add to HubSpot.');
      return;
    }
    setHubspotBusyId(row.id);
    const res = await createHubspotContactForRow(row);
    if (res.ok && res.contact) {
      try { await updateHubspotCache(draft => { draft.contacts.push({ ...res.contact, _source: 'manual' }); }); } catch { /* ignore */ }
      notifyCacheUpdated();
      setHubspotMapping(row.id, res.contact);
      const contactId = String(res.contact.id || res.contact.vid || '');
      const noted = await postHubspotContactNote(contactId, MARKETING_LEAD_NOTE);
      if (noted && contactId) {
        const cur = settings?.contactNotes || {};
        const prior = String(cur[contactId] || '').trim();
        if (!prior.includes(MARKETING_LEAD_NOTE)) {
          updateSettings({ contactNotes: { ...cur, [contactId]: prior ? `${prior}\n${MARKETING_LEAD_NOTE}` : MARKETING_LEAD_NOTE } });
        }
      }
    } else {
      window.alert(`Could not create the HubSpot contact${res.error ? `: ${res.error}` : '.'}`);
    }
    setHubspotBusyId('');
  }

  // Leads eligible for the bulk "Add all to HubSpot" action: not already
  // mapped, have a name or email, and aren't Closed-Recycle (dead leads
  // shouldn't spawn new HubSpot contacts).
  const hubspotAddable = useMemo(
    () => persistedRows.filter(r =>
      !String(r.hubspotContactId || '').trim()
      && ((r.name || '').trim() || (r.email || '').trim())
      && !isClosedRecycle(r)),
    [persistedRows],
  );

  // Create HubSpot contacts for every eligible lead, then push all new
  // contacts to the cache and persist all lead→contact mappings in a
  // single write (mapping in the loop would each read a stale
  // persistedRows and clobber earlier maps).
  async function bulkAddToHubspot() {
    if (bulkAddingHubspot) return;
    if (!hubspotAddable.length) { window.alert('No unmapped leads to add to HubSpot.'); return; }
    const ok = window.confirm(
      `Create ${hubspotAddable.length} new HubSpot contact${hubspotAddable.length === 1 ? '' : 's'} from the leads that aren't mapped yet? Already-mapped and Closed-Recycle leads are skipped.`,
    );
    if (!ok) return;
    setBulkAddingHubspot(true);
    const created = [];
    const mappingById = new Map();
    let failed = 0;
    for (const row of hubspotAddable) {
      const res = await createHubspotContactForRow(row); // eslint-disable-line no-await-in-loop
      if (res.ok && res.contact) {
        created.push({ ...res.contact, _source: 'manual' });
        mappingById.set(row.id, { id: String(res.contact.id || res.contact.vid || ''), label: hubspotDisplay(res.contact), title: String(res.contact.jobtitle || '').trim() });
      } else {
        failed += 1;
      }
    }
    if (created.length) {
      try { await updateHubspotCache(draft => { for (const c of created) draft.contacts.push(c); }); } catch { /* ignore */ }
      notifyCacheUpdated();
    }
    // Stamp a "Marketing Lead" note on each new contact (best effort),
    // collecting the ones that land so we can mirror them into the local
    // Notes store alongside the mapping write below.
    const curNotes = settings?.contactNotes || {};
    const notesPatch = {};
    for (const c of created) {
      const cid = String(c.id || c.vid || '');
      if (!cid) continue;
      const noted = await postHubspotContactNote(cid, MARKETING_LEAD_NOTE); // eslint-disable-line no-await-in-loop
      if (!noted) continue;
      const prior = String((notesPatch[cid] ?? curNotes[cid]) || '').trim();
      notesPatch[cid] = prior && !prior.includes(MARKETING_LEAD_NOTE) ? `${prior}\n${MARKETING_LEAD_NOTE}` : (prior || MARKETING_LEAD_NOTE);
    }
    // One settings write for both the lead→contact mappings and the note
    // mirror, so the page doesn't churn through two round-trips.
    const patch = {};
    if (mappingById.size) {
      patch.marketingLeads = persistedRows.map(r => {
        const m = mappingById.get(r.id);
        return m ? { ...r, hubspotContactId: m.id, hubspotContact: m.label, hubspotContactTitle: m.title } : r;
      });
    }
    if (Object.keys(notesPatch).length) patch.contactNotes = { ...curNotes, ...notesPatch };
    if (Object.keys(patch).length) updateSettings(patch);
    setBulkAddingHubspot(false);
    window.alert(`Added ${created.length} contact${created.length === 1 ? '' : 's'} to HubSpot${failed ? ` — ${failed} failed` : ''}.`);
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
    // Closed-Recycle leads always sink below the active leads, keeping the
    // current (natural or sorted) order within each group. Stable so the
    // two groups don't otherwise reshuffle.
    const active = [];
    const recycled = [];
    for (const r of rows) (isClosedRecycle(r) ? recycled : active).push(r);
    rows = [...active, ...recycled];
    if (!isFiltering && !isSorting) {
      const padding = Math.max(0, MIN_VISIBLE_ROWS - rows.length);
      const padRows = Array.from({ length: padding }, (_, i) => ({ ...emptyRow(), id: `__pad_${i}` }));
      rows = [...rows, ...padRows];
    }
    return rows;
  }, [persistedRows, search, activeColumnFilters, isFiltering, isSorting, sortKey, sortDir]); // eslint-disable-line react-hooks/exhaustive-deps

  // Close-rate summary over the currently shown leads (padding rows are
  // synthetic scratch rows, so drop them). When a search / column filter
  // is active this reflects just the filtered slice, so the rate updates
  // as you narrow by owner, source, country, etc.
  const closeStats = useMemo(
    () => computeCloseStats(filtered.filter(r => !String(r.id).startsWith('__pad_'))),
    [filtered],
  );

  // ---- Contact popup (shared with the other Contacts subtabs) ---------
  // Clicking a lead's Name opens the same ContactEditModal used across the
  // Contacts page. The lead row is held here; the contact object is
  // derived on render. `editingNameId` toggles a row's Name back to an
  // inline input so blank / pad rows can still be typed without the popup.
  const [editingLead, setEditingLead] = useState(null);
  const [editingNameId, setEditingNameId] = useState(null);

  // Build the contact object handed to ContactEditModal from a lead row.
  // When the lead's email matches a HubSpot contact already in the cache
  // (or the lead is mapped to one) that record is spread in — carrying its
  // id — so the popup edits the real contact; otherwise it's a fresh
  // contact the modal can create in HubSpot on save. Names are already
  // healed to "First Last" by normalizeLeadName on load.
  function buildLeadContact(r) {
    const email = (r.email || '').trim();
    const mapped = r.hubspotContactId ? findHubspotById(r.hubspotContactId) : null;
    const match = mapped || (email ? hubspotByEmail.get(email.toLowerCase()) : null);
    const parts = normalizeLeadName(r.name).split(/\s+/).filter(Boolean);
    const base = {
      firstname: parts[0] || '',
      lastname: parts.length > 1 ? parts.slice(1).join(' ') : '',
      email,
      jobtitle: (r.jobTitle || '').trim(),
      company: effectiveCompany(r),
      country: (r.country || '').trim(),
    };
    return match ? { ...base, ...match } : base;
  }

  // Same-company HubSpot contacts + company-name autocomplete list for the
  // popup's Reports-To / company fields, mirroring the Key Contacts wiring.
  const editContact = editingLead ? buildLeadContact(editingLead) : null;
  const editCompanyContacts = useMemo(() => {
    if (!editContact) return [];
    const k = companyKey(editContact.company);
    if (!k) return [];
    return hubspotContacts.filter(c => companyKey(c?.company) === k);
  }, [editContact?.company, hubspotContacts]); // eslint-disable-line react-hooks/exhaustive-deps
  const editEmailDomains = useMemo(() => {
    if (!editContact) return [];
    const matched = prospects.find(p => companyKey(p.company) === companyKey(editContact.company));
    return matched?.emailDomain
      ? String(matched.emailDomain).split(/[\n;,]+/).map(s => s.trim()).filter(Boolean)
      : [];
  }, [editContact?.company, prospects]); // eslint-disable-line react-hooks/exhaustive-deps
  const editCompanyNames = useMemo(() => prospects.map(p => p.company).filter(Boolean), [prospects]);

  // Per-contact metadata handlers — thin settings-map updaters, identical
  // in shape to the Key Contacts page so notes / tags / nicknames written
  // from either place land in the same Firestore settings.
  const handleContactSaved = useCallback((_updated, opts) => {
    if (!opts?.silent) setEditingLead(null);
  }, []);
  const saveSettingsMap = useCallback((mapKey, cid, value) => {
    if (cid == null) return;
    const cur = settings?.[mapKey] || {};
    const next = { ...cur };
    if (value && String(value).trim()) next[cid] = value; else delete next[cid];
    updateSettings({ [mapKey]: next });
  }, [settings, updateSettings]);

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
    const html = e.clipboardData?.getData('text/html') || '';
    ingestPastedText(text, html ? extractLeadLinks(html) : null);
  }

  async function pasteFromClipboard() {
    try {
      // Prefer the rich clipboard read so we can pull the per-lead record
      // links out of the HTML; fall back to plain text when unavailable.
      if (navigator.clipboard?.read) {
        try {
          const items = await navigator.clipboard.read();
          let text = '';
          let html = '';
          for (const item of items) {
            if (item.types.includes('text/plain')) text = await (await item.getType('text/plain')).text();
            if (item.types.includes('text/html')) html = await (await item.getType('text/html')).text();
          }
          if (text && text.trim()) { ingestPastedText(text, html ? extractLeadLinks(html) : null); return; }
        } catch { /* fall through to readText */ }
      }
      const text = await navigator.clipboard?.readText?.();
      if (text && text.trim()) { ingestPastedText(text, null); return; }
    } catch {
      /* permission denied / insecure context — fall through to manual box */
    }
    setPasteHelper('');
  }

  function ingestPastedText(text, linkMap = null) {
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
    setPasteModal({ headers, rows: dataRows, mapping: autoDetectMapping(headers), linkMap: linkMap || null });
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
    const { headers, rows, mapping, linkMap } = pasteModal;
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
      // Backfill the Salesforce Link from the clipboard's HTML anchors
      // (matched by the lead's name) when no URL / Lead-ID column was
      // mapped — this is how the record link travels through a plain
      // list-view copy.
      if (!fresh.sfUrl && linkMap && fresh.name) {
        const hit = linkMap[nameKey(fresh.name)];
        if (hit) fresh.sfUrl = hit;
      }
      // Flip "Last, First" → "First Last" AFTER the link lookup above,
      // which matches on the raw name as it appears in the pasted HTML.
      fresh.name = normalizeLeadName(fresh.name);
      incoming.push(fresh);
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
        {hasCustomOrder && (
          <button
            type="button"
            onClick={resetColumnOrder}
            title="Restore the columns to their default left-to-right order."
            style={btn({ border: '1px solid var(--color-border)', background: '#fff', color: 'var(--color-text-secondary)' })}
          >Reset order</button>
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
              boxShadow: '0 8px 20px rgba(15, 23, 42, 0.12)', minWidth: 260, padding: '0.4rem 0', fontSize: '0.78rem',
            }}>
              <div style={{ padding: '0.15rem 0.7rem 0.4rem', fontSize: '0.68rem', color: '#94A3B8' }}>
                Check to show, ▲▼ to reorder. Drag a column header to reorder there too.
              </div>
              {orderedColumns.map((c, i) => {
                const on = visibleCols.has(c.key);
                const locked = c.key === 'name';
                return (
                  <div
                    key={c.key}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0.3rem 0.7rem', color: locked ? '#94A3B8' : 'var(--color-text)' }}
                  >
                    <label
                      style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0, cursor: locked ? 'not-allowed' : 'pointer' }}
                      title={locked ? 'Name is always visible.' : `Show / hide the ${c.label} column.`}
                    >
                      <input type="checkbox" checked={on} disabled={locked} onChange={e => setColVisible(c.key, e.target.checked)} style={{ accentColor: '#0078D4' }} />
                      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.label}</span>
                    </label>
                    <button
                      type="button"
                      disabled={i === 0}
                      onClick={() => nudgeColumn(c.key, -1)}
                      title="Move left"
                      style={{ border: 'none', background: 'transparent', cursor: i === 0 ? 'default' : 'pointer', color: i === 0 ? '#E2E8F0' : '#64748B', fontSize: '0.7rem', lineHeight: 1, padding: '2px 4px' }}
                    >▲</button>
                    <button
                      type="button"
                      disabled={i === orderedColumns.length - 1}
                      onClick={() => nudgeColumn(c.key, 1)}
                      title="Move right"
                      style={{ border: 'none', background: 'transparent', cursor: i === orderedColumns.length - 1 ? 'default' : 'pointer', color: i === orderedColumns.length - 1 ? '#E2E8F0' : '#64748B', fontSize: '0.7rem', lineHeight: 1, padding: '2px 4px' }}
                    >▼</button>
                  </div>
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
          onClick={bulkAddToHubspot}
          disabled={!hubspotAddable.length || bulkAddingHubspot}
          title={hubspotAddable.length
            ? `Create HubSpot contacts for the ${hubspotAddable.length} lead${hubspotAddable.length === 1 ? '' : 's'} that aren't mapped yet (Closed-Recycle leads skipped).`
            : 'Every lead is already mapped to a HubSpot contact.'}
          style={btn({ border: 'none', background: (hubspotAddable.length && !bulkAddingHubspot) ? '#FF7A59' : '#CBD5E1', color: '#fff', fontWeight: 700, cursor: (hubspotAddable.length && !bulkAddingHubspot) ? 'pointer' : 'not-allowed' })}
        >{bulkAddingHubspot ? 'Adding to HubSpot…' : `+ Add ${hubspotAddable.length || ''} to HubSpot`}</button>
        <button
          type="button"
          onClick={clearTable}
          disabled={!persistedRows.length}
          title={persistedRows.length ? 'Delete every saved lead.' : 'Nothing to clear yet.'}
          style={btn({ border: '1px solid #FCA5A5', background: persistedRows.length ? '#fff' : '#F8FAFC', color: persistedRows.length ? '#B91C1C' : '#CBD5E1', cursor: persistedRows.length ? 'pointer' : 'not-allowed' })}
        >Clear table</button>
      </div>
      <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>
        Tip: in the Salesforce Leads list, select the rows (including the header row), copy, then paste anywhere on this page (or click <strong>📋 Paste from Salesforce</strong>). A column-mapping modal pops up so you can confirm which pasted column fills each field before importing. Click a column header to sort, drag a header to reorder it (drag its right edge to resize), use <strong>Filters</strong> for per-column filtering, and <strong>Columns</strong> to show / hide or reorder columns. The <strong>Company Mapping</strong> column links each lead's company to a Table View account — accept the suggested match or type to pick another. The <strong>Salesforce Link</strong> column captures the record link from each lead's name on paste (an <strong>Open ↗</strong> opens it in Salesforce); you can also paste a link or Lead ID into it by hand. The <strong>HubSpot Contact</strong> column maps each lead to a HubSpot contact — accept the email/name match, search to pick another, or <strong>+ Add to HubSpot</strong> to create a new contact from the lead. The read-only <strong>HubSpot Title</strong> column shows the mapped contact's job title. The <strong>Status</strong> column is a dropdown driven by the <strong>Marketing Lead Status</strong> list on the <strong>Dropdowns</strong> tab — edit that list to change the options. Click a lead's <strong>Name</strong> to open it in the contact popup (the <strong>✎</strong> next to it edits the name inline instead).
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
        <div
          title="Close rate = converted leads ÷ decided leads (converted + Closed-Recycle). Open leads (Working, Nurture, Qualified, …) are excluded from the denominator."
          style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: '#F0FDF4', border: '1px solid #86EFAC', borderRadius: 999, padding: '0.25rem 0.75rem' }}
        >
          <span style={{ fontSize: '0.7rem', fontWeight: 700, color: '#166534', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Close rate{isFiltering ? ' (filtered)' : ''}
          </span>
          <span style={{ fontSize: '0.95rem', fontWeight: 800, color: '#009530' }}>
            {closeStats.rate == null ? '—' : `${(closeStats.rate * 100).toFixed(1)}%`}
          </span>
        </div>
        <span style={{ fontSize: '0.72rem', color: 'var(--color-text-secondary)' }}>
          <strong style={{ color: '#166534' }}>{closeStats.won.toLocaleString()}</strong> won
          {' · '}
          <strong style={{ color: '#B91C1C' }}>{closeStats.lost.toLocaleString()}</strong> lost
          {' '}<span style={{ color: 'var(--color-text-muted)' }}>(Closed-Recycle)</span>
          {' · '}
          <strong>{closeStats.decided.toLocaleString()}</strong> decided
        </span>
        {closeStats.rate == null && (
          <span style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
            No converted or Closed-Recycle leads yet.
          </span>
        )}
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
        <table style={{ borderCollapse: 'collapse', fontSize: '0.8rem', tableLayout: 'fixed', width: tableWidth, minWidth: '100%' }}>
          <colgroup>
            {visibleColumnList.map(c => (
              <col key={c.key} ref={el => { colRefs.current[c.key] = el; }} style={{ width: `${columnWidths[c.key]}px` }} />
            ))}
            <col style={{ width: 44 }} />
          </colgroup>
          <thead>
            <tr>
              {visibleColumnList.map(c => {
                const isDropTarget = dragColKey && dragOverKey === c.key && dragColKey !== c.key;
                const isDragging = dragColKey === c.key;
                return (
                <th
                  key={c.key}
                  onDragOver={dragColKey ? (e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    const rect = e.currentTarget.getBoundingClientRect();
                    const after = e.clientX > rect.left + rect.width / 2;
                    if (dragOverKey !== c.key || dragAfter !== after) { setDragOverKey(c.key); setDragAfter(after); }
                  } : undefined}
                  onDrop={dragColKey ? (e) => {
                    e.preventDefault();
                    moveColumn(dragColKey, c.key, dragAfter);
                    setDragColKey(''); setDragOverKey('');
                  } : undefined}
                  style={{
                  textAlign: 'left', padding: '0.45rem 0.6rem', paddingRight: '0.95rem',
                  background: '#F1F5F9', fontWeight: 700, fontSize: '0.72rem', color: '#475569',
                  borderBottom: '1px solid var(--color-border)', position: 'sticky', top: 0, zIndex: 1,
                  overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
                  opacity: isDragging ? 0.4 : 1,
                  boxShadow: isDropTarget ? `inset ${dragAfter ? '-3px' : '3px'} 0 0 0 #009530` : undefined,
                }}>
                  <span
                    draggable
                    onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', c.key); } catch { /* noop */ } setDragColKey(c.key); }}
                    onDragEnd={() => { setDragColKey(''); setDragOverKey(''); }}
                    onClick={c.readonly ? undefined : () => cycleSort(c.key)}
                    title={c.readonly ? `Drag to reorder ${c.label}` : `Sort by ${c.label} · drag to reorder`}
                    style={{ position: 'relative', display: 'block', paddingRight: 12, cursor: dragColKey ? 'grabbing' : (c.readonly ? 'grab' : 'pointer'), userSelect: 'none' }}
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
                );
              })}
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
              const recycled = !isPad && isClosedRecycle(r);
              return (
                <tr
                  key={r.id}
                  style={{
                    borderBottom: '1px solid var(--color-border-light)',
                    background: recycled ? '#FEE2E2' : undefined,
                  }}
                >
                  {visibleColumnList.map(c => (
                    <td
                      key={c.key}
                      style={{
                        padding: 0,
                        verticalAlign: 'top',
                        // Clip cell content to the (draggable) column width so
                        // long text hides as the column narrows instead of
                        // spilling into the next column. The two cells that
                        // render an autocomplete dropdown stay visible so the
                        // popover isn't cut off — their inner content clips on
                        // its own (input width 100%, pills ellipsis).
                        overflow: (c.key === 'mappedCompany' || c.key === 'hubspotContact') ? 'visible' : 'hidden',
                      }}
                    >
                      {c.key === 'sfUrl' ? (
                        (() => {
                          const raw = (r.sfUrl || '').trim();
                          const url = resolveSfUrl(raw);
                          if (url) {
                            return (
                              <div style={{ padding: '0.45rem 0.6rem', minHeight: '1.4rem', display: 'flex', alignItems: 'center', gap: 6 }}>
                                <a
                                  href={url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  title={`Open this lead in Salesforce\n${url}`}
                                  style={{ color: '#0369A1', fontWeight: 700, fontSize: '0.75rem', textDecoration: 'none', whiteSpace: 'nowrap' }}
                                >Open ↗</a>
                                {!isPad && (
                                  <button
                                    type="button"
                                    onClick={() => updateCell(r.id, 'sfUrl', '')}
                                    title="Clear this link"
                                    style={{ border: 'none', background: 'transparent', color: '#94A3B8', cursor: 'pointer', fontSize: '0.85rem', lineHeight: 1, padding: 0 }}
                                  >×</button>
                                )}
                              </div>
                            );
                          }
                          return (
                            <CommitOnBlurInput
                              value={raw}
                              onCommit={v => updateCell(r.id, 'sfUrl', v)}
                              placeholder={isPad ? '' : 'Paste link or Lead ID…'}
                              style={cellInputStyle}
                            />
                          );
                        })()
                      ) : c.key === 'companyStatus' ? (
                        (() => {
                          // The company's Status, shown as a colored chip. Uses
                          // the user's own Table View account when present, else
                          // falls back to the cross-CDM Target Accounts list so a
                          // company another CDM owns still shows a status.
                          const info = lookupCompanyInfo(effectiveCompany(r));
                          const status = (info?.status || '').trim();
                          if (!status) {
                            return (
                              <div style={{ padding: '0.45rem 0.6rem', minHeight: '1.4rem' }}>
                                <span style={{ color: '#CBD5E1', fontSize: '0.74rem', fontStyle: 'italic' }}>—</span>
                              </div>
                            );
                          }
                          const color = STATUS_COLORS[status] || '#64748B';
                          return (
                            <div style={{ padding: '0.45rem 0.6rem', minHeight: '1.4rem' }}>
                              <span
                                title={info.statusFrom
                                  ? `Status borrowed from the related account "${info.statusFrom}" — "${info.name}" has no status set.`
                                  : `Status for "${info.name}"${info.owned ? '' : ' (from Target Accounts — another CDM)'}`}
                                style={{ display: 'inline-block', maxWidth: '100%', background: `${color}1A`, border: `1px ${info.statusFrom ? 'dashed' : 'solid'} ${color}`, color, padding: '2px 8px', borderRadius: 999, fontSize: '0.7rem', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                              >{status}{info.statusFrom ? ' *' : ''}</span>
                            </div>
                          );
                        })()
                      ) : c.key === 'companyCdm' ? (
                        (() => {
                          // Who owns the company — the CDM from the user's own
                          // account, else from the cross-CDM Target Accounts list.
                          const info = lookupCompanyInfo(effectiveCompany(r));
                          const cdm = (info?.cdm || '').trim();
                          return (
                            <div title={cdm ? `CDM for "${info.name}"${info.owned ? '' : ' (Target Accounts)'}` : undefined} style={{ padding: '0.45rem 0.6rem', minHeight: '1.4rem', fontSize: '0.78rem', color: info?.owned ? '#334155' : '#7C3AED', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {cdm || <span style={{ color: '#CBD5E1', fontStyle: 'italic' }}>—</span>}
                            </div>
                          );
                        })()
                      ) : c.key === 'tvStatus' ? (
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
                      ) : c.key === 'hubspotTitle' ? (
                        (() => {
                          const title = hubspotTitleForRow(r);
                          if (title) {
                            return (
                              <div title={title} style={{ padding: '0.45rem 0.6rem', minHeight: '1.4rem', fontSize: '0.78rem', color: '#334155', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {title}
                              </div>
                            );
                          }
                          return (
                            <div style={{ padding: '0.45rem 0.6rem', minHeight: '1.4rem' }}>
                              <span
                                title={r.hubspotContactId ? 'The mapped HubSpot contact has no job title set.' : 'Map a HubSpot contact to see its title.'}
                                style={{ color: '#CBD5E1', fontSize: '0.74rem', fontStyle: 'italic' }}
                              >—</span>
                            </div>
                          );
                        })()
                      ) : c.key === 'hubspotContact' ? (
                        (() => {
                          const id = r.hubspotContactId ? String(r.hubspotContactId) : '';
                          if (id) {
                            const live = findHubspotById(id);
                            const label = live ? hubspotDisplay(live) : (r.hubspotContact || 'Mapped contact');
                            return (
                              <div style={{ padding: '0.45rem 0.6rem', minHeight: '1.4rem', display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, overflow: 'hidden' }}>
                                <span title={label} style={{ background: '#DCFCE7', border: '1px solid #86EFAC', color: '#166534', padding: '2px 8px', borderRadius: 999, fontSize: '0.7rem', fontWeight: 600, flex: '0 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>✓ {label}</span>
                                {!isPad && (
                                  <button type="button" onClick={() => setHubspotMapping(r.id, null)} title="Unmap this HubSpot contact" style={{ border: 'none', background: 'transparent', color: '#94A3B8', cursor: 'pointer', fontSize: '0.85rem', lineHeight: 1, padding: 0, flexShrink: 0 }}>×</button>
                                )}
                              </div>
                            );
                          }
                          return (
                            <div>
                              <HubSpotContactAutocomplete
                                contacts={hubspotContacts}
                                onPick={(c) => setHubspotMapping(r.id, c)}
                                placeholder={isPad ? '' : 'Search HubSpot…'}
                                style={cellInputStyle}
                              />
                              {!isPad && (() => {
                                const sugg = bestHubspotMatch(r);
                                if (sugg) {
                                  const disp = hubspotDisplay(sugg.contact);
                                  return (
                                    <div style={{ padding: '0 0.6rem 0.3rem' }}>
                                      <button
                                        type="button"
                                        onClick={() => setHubspotMapping(r.id, sugg.contact)}
                                        title={`Map to HubSpot contact "${disp}" (${sugg.kind === 'email' ? 'email match' : 'name match'}). Click to accept.`}
                                        style={{ background: sugg.kind === 'email' ? '#DCFCE7' : '#FEF3C7', border: `1px solid ${sugg.kind === 'email' ? '#86EFAC' : '#FCD34D'}`, color: sugg.kind === 'email' ? '#166534' : '#92400E', padding: '1px 7px', borderRadius: 999, fontSize: '0.68rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                                      >→ {disp}</button>
                                    </div>
                                  );
                                }
                                if (!(r.name || '').trim() && !(r.email || '').trim()) return null;
                                const busy = hubspotBusyId === r.id;
                                return (
                                  <div style={{ padding: '0 0.6rem 0.3rem' }}>
                                    <button
                                      type="button"
                                      disabled={busy}
                                      onClick={() => addLeadToHubspot(r)}
                                      title="Create a new HubSpot contact from this lead (name, email, company, job title) and map it here."
                                      style={{ background: '#fff', border: '1px solid #0EA5E9', color: '#0369A1', padding: '1px 7px', borderRadius: 999, fontSize: '0.68rem', fontWeight: 700, cursor: busy ? 'default' : 'pointer', fontFamily: 'inherit', opacity: busy ? 0.6 : 1 }}
                                    >{busy ? 'Adding…' : '+ Add to HubSpot'}</button>
                                  </div>
                                );
                              })()}
                            </div>
                          );
                        })()
                      ) : c.key === 'mappedCompany' ? (
                        (() => {
                          const mapped = (r.mappedCompany || '').trim();
                          const prospect = mapped ? findProspectByCompany(mapped) : null;
                          // A mapping that resolves to a Table View account
                          // renders as a link into the company popup, with an ×
                          // to re-map. Unmapped / free-text values keep the
                          // editable picker + accept-suggestion pill below.
                          if (mapped && prospect && onSelectProspect && !isPad) {
                            return (
                              <div style={{ padding: '0.45rem 0.6rem', minHeight: '1.4rem', display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, overflow: 'hidden' }}>
                                <button
                                  type="button"
                                  onClick={() => onSelectProspect(prospect)}
                                  title={`Open the company popup for "${prospect.company || mapped}"`}
                                  style={{ background: 'none', border: 'none', padding: 0, color: '#0369A1', fontWeight: 600, fontSize: '0.8rem', cursor: 'pointer', textAlign: 'left', textDecoration: 'underline', fontFamily: 'inherit', flex: '0 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                                >{prospect.company || mapped}</button>
                                <button
                                  type="button"
                                  onClick={() => updateCell(r.id, 'mappedCompany', '')}
                                  title="Clear this mapping"
                                  style={{ border: 'none', background: 'transparent', color: '#94A3B8', cursor: 'pointer', fontSize: '0.85rem', lineHeight: 1, padding: 0, flexShrink: 0 }}
                                >×</button>
                              </div>
                            );
                          }
                          return (
                            <div>
                              <CompanyAutocomplete
                                value={r.mappedCompany || ''}
                                onCommit={v => updateCell(r.id, 'mappedCompany', v)}
                                suggestions={companyOptions}
                                placeholder={isPad ? '' : 'Map to account…'}
                                style={cellInputStyle}
                              />
                              {!isPad && (() => {
                                // Only surface the accept-suggestion pill for
                                // rows that aren't mapped yet.
                                if (mapped) return null;
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
                          );
                        })()
                      ) : c.key === 'status' ? (
                        (() => {
                          const cur = (r.status || '').trim();
                          // Keep an off-list value (e.g. a status pasted from
                          // Salesforce that isn't in the Dropdowns list) as a
                          // selectable option so it isn't silently dropped.
                          const offList = cur && !statusOptions.includes(cur);
                          return (
                            <select
                              value={cur}
                              onChange={e => updateCell(r.id, 'status', e.target.value)}
                              title={offList ? `"${cur}" isn't in the Marketing Lead Status list. Manage the list on the Dropdowns tab.` : 'Set the lead status (managed on the Dropdowns tab → Marketing Lead Status).'}
                              style={{ ...cellInputStyle, cursor: 'pointer', appearance: 'auto' }}
                            >
                              <option value="">{isPad ? '' : '—'}</option>
                              {offList && <option value={cur}>{cur} (not in list)</option>}
                              {statusOptions.map(opt => (
                                <option key={opt} value={opt}>{opt}</option>
                              ))}
                            </select>
                          );
                        })()
                      ) : c.key === 'name' ? (
                        (() => {
                          const nameVal = (r.name || '').trim();
                          const isEditingName = editingNameId === r.id;
                          // Pad rows, blank names, and the explicit "edit"
                          // toggle fall back to the inline input so leads can
                          // still be typed / renamed in place. A populated
                          // name renders as a link into the contact popup.
                          if (isPad || !nameVal || isEditingName) {
                            return (
                              <CommitOnBlurInput
                                value={r.name || ''}
                                onCommit={v => { updateCell(r.id, 'name', v); if (isEditingName) setEditingNameId(null); }}
                                placeholder={isPad ? 'Type or paste a lead…' : '—'}
                                style={cellInputStyle}
                                autoFocus={isEditingName}
                              />
                            );
                          }
                          return (
                            <div style={{ padding: '0.45rem 0.6rem', minHeight: '1.4rem', display: 'flex', alignItems: 'center', gap: 6 }}>
                              <button
                                type="button"
                                onClick={() => setEditingLead(r)}
                                title={`Open ${nameVal} in the contact popup`}
                                style={{ border: 'none', background: 'transparent', color: '#0369A1', fontWeight: 700, fontSize: '0.8rem', textDecoration: 'underline', textUnderlineOffset: 2, cursor: 'pointer', padding: 0, fontFamily: 'inherit', textAlign: 'left', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}
                              >{nameVal}</button>
                              <button
                                type="button"
                                onClick={() => setEditingNameId(r.id)}
                                title="Edit name inline"
                                style={{ border: 'none', background: 'transparent', color: '#CBD5E1', cursor: 'pointer', fontSize: '0.75rem', lineHeight: 1, padding: 0, flexShrink: 0 }}
                                onMouseEnter={e => { e.currentTarget.style.color = '#64748B'; }}
                                onMouseLeave={e => { e.currentTarget.style.color = '#CBD5E1'; }}
                              >✎</button>
                            </div>
                          );
                        })()
                      ) : (
                        <CommitOnBlurInput
                          value={r[c.key] || ''}
                          onCommit={v => updateCell(r.id, c.key, v)}
                          placeholder="—"
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

      {editingLead && editContact && createPortal(
        <ContactEditModal
          contact={editContact}
          onSave={handleContactSaved}
          onClose={() => setEditingLead(null)}
          contactNotes={settings?.contactNotes || {}}
          onSaveNote={(cid, v) => saveSettingsMap('contactNotes', cid, v)}
          contactOldEmails={settings?.contactOldEmails || {}}
          onSaveOldEmails={(cid, v) => saveSettingsMap('contactOldEmails', cid, v)}
          contactNicknames={settings?.contactNicknames || {}}
          onSaveNickname={(cid, v) => saveSettingsMap('contactNicknames', cid, v)}
          contactTeamNames={settings?.contactTeamNames || {}}
          onSaveTeamName={(cid, v) => saveSettingsMap('contactTeamNames', cid, v && v.trim())}
          contactReportsTo={settings?.contactReportsTo || {}}
          onSaveReportsTo={(cid, managerIds) => {
            if (cid == null) return;
            const cur = settings?.contactReportsTo || {};
            const next = { ...cur };
            const arr = Array.isArray(managerIds) ? managerIds.filter(Boolean).map(String) : (managerIds ? [String(managerIds)] : []);
            if (arr.length) next[cid] = arr; else delete next[cid];
            updateSettings({ contactReportsTo: next });
          }}
          ccMap={settings?.ccMap || {}}
          onSaveCcMap={m => updateSettings({ ccMap: m })}
          toAlsoMap={settings?.toAlsoMap || {}}
          onSaveToAlsoMap={m => updateSettings({ toAlsoMap: m })}
          contactFamilies={settings?.contactFamilies || {}}
          onSaveFamily={(cid, info) => {
            if (cid == null) return;
            const cur = settings?.contactFamilies || {};
            const next = { ...cur };
            const partner = String(info?.partner || '').trim();
            const kids = String(info?.kids || '').trim();
            if (!partner && !kids) delete next[cid]; else next[cid] = { partner, kids };
            updateSettings({ contactFamilies: next });
          }}
          contactMetInPerson={settings?.contactMetInPerson || {}}
          onSaveMetInPerson={(cid, met) => {
            if (cid == null) return;
            updateSettings({ contactMetInPerson: { ...(settings?.contactMetInPerson || {}), [cid]: !!met } });
          }}
          contactInvitedToLouisville={settings?.contactInvitedToLouisville || {}}
          onSaveInvitedToLouisville={(cid, invited) => {
            if (cid == null) return;
            updateSettings({ contactInvitedToLouisville: { ...(settings?.contactInvitedToLouisville || {}), [cid]: !!invited } });
          }}
          companyContacts={editCompanyContacts}
          emailDomains={editEmailDomains}
          companyNames={editCompanyNames}
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
