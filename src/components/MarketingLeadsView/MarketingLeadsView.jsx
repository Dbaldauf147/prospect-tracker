import { useCallback, useEffect, useMemo, useRef, useState, memo } from 'react';
import { createPortal } from 'react-dom';
import { CommitOnBlurInput } from '../common/CommitOnBlurInput';
import { SF_INSTANCE_URL, resolveSfUrl } from '../../utils/salesforceLeads';
import { getHubspotContacts, updateHubspotCache, notifyCacheUpdated } from '../../utils/hubspotContactsCache';
import { apiFetch } from '../../utils/apiFetch';
import { STATUS_COLORS } from '../../data/enums';
import { resolveTargetAccountCdm } from '../../utils/cdmMatch';
import { ContactEditModal } from '../ProspectModal/ProspectModal';
import { companyPopupTarget } from '../../utils/companyLookup';
import { getEffectiveDropdownLists } from '../../utils/dropdownListsStore';
import { useAuth } from '../../contexts/AuthContext';
import { resolveSignature, plainBodyToHtml, personalizeDraftText, buildUnsentEml, downloadDrafts, safeFileName } from '../../utils/draftEmail';
import { addQueuedLeads } from '../../utils/draftLeadsQueue';
import { withCompanyOverride } from '../../utils/contactCompanyOverride';
import { saveTagReview } from '../../utils/contactTagReview';
import {
  LEAD_PASTE_TARGETS as PASTE_TARGETS,
  autoDetectLeadMapping as autoDetectMapping,
  makeLeadId as makeId,
  makeLeadRow,
  normalizeLeadName,
  leadEmailKey as emailKey,
  planLeadImport,
  summariseLeadNames,
} from '../../utils/marketingLeadsImport';

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
  { key: 'linkedin',            label: 'LinkedIn',                   defaultWidth: 120 },
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

// Columns present in the original Marketing Leads view. Used only to
// migrate a legacy "visible columns" whitelist into the hidden-list
// model — only these can be auto-hidden by the migration, so every
// column added since (mapping / status / CDM / HubSpot / …) stays
// visible by default even for users who had customized their columns.
const LEGACY_COLUMN_KEYS = [
  'name', 'email', 'jobTitle', 'company', 'status', 'createdDate',
  'leadSource', 'owner', 'country', 'qualificationDetail', 'tvStatus',
];

// Note stamped onto a HubSpot contact the moment it's created from a
// Marketing Lead, so its origin is recorded on the contact's timeline
// (and mirrored into the app's Notes column).
const MARKETING_LEAD_NOTE = 'Marketing Lead';

// The columns a pasted table can fill (PASTE_TARGETS), the header
// auto-detection and the import rules themselves live in
// utils/marketingLeadsImport — the BFO Activity → Leads subtab maps its
// own paste over through the same rules, and the two must not drift.

const EDITABLE_KEYS = COLUMNS.filter(c => !c.readonly).map(c => c.key);

// Fields offered in the Bulk Edit modal — the editable columns whose value
// makes sense to set across many leads at once. Deliberately excludes the
// per-lead-unique fields (Name, Email, Salesforce Link) and the special
// HubSpot Contact picker (a mapping to one contact record, not a value).
const BULK_EDIT_KEYS = [
  'status', 'owner', 'leadSource', 'company', 'mappedCompany',
  'jobTitle', 'country', 'createdDate', 'qualificationDetail',
];

function emptyRow() {
  return makeLeadRow();
}

// How "complete" a lead row is — the count of non-empty editable fields.
// When two rows share an email we keep the richer one (more filled cells,
// e.g. a job title + mapped HubSpot contact) and drop the sparser copies.
function rowRichness(row) {
  let n = 0;
  for (const k of EDITABLE_KEYS) if (String(row?.[k] || '').trim()) n += 1;
  return n;
}

// Collapse rows sharing an email down to a single best row, preserving the
// original order. Rows without an email are always kept. Returns the kept
// rows plus the ids that were dropped (so callers can prune the hidden
// list). For each email the richest row wins; ties keep the earliest.
function dedupeByEmail(rows) {
  const bestIdxByEmail = new Map();
  const dropIds = [];
  rows.forEach((row, idx) => {
    const key = emailKey(row);
    if (!key) return; // keep every email-less row
    const prevIdx = bestIdxByEmail.get(key);
    if (prevIdx == null) { bestIdxByEmail.set(key, idx); return; }
    // A later row replaces the earlier only if it is strictly richer.
    if (rowRichness(row) > rowRichness(rows[prevIdx])) {
      dropIds.push(rows[prevIdx].id);
      bestIdxByEmail.set(key, idx);
    } else {
      dropIds.push(row.id);
    }
  });
  const dropSet = new Set(dropIds);
  return { kept: rows.filter(r => !dropSet.has(r.id)), dropIds };
}

// Tab / comma / semicolon-tolerant split for a clipboard row — handles
// Excel + Salesforce ("Ana Higueras<TAB>ana@x.com<TAB>…") and the
// occasional CSV that leaks in from a spreadsheet export.
function splitPasteRow(line) {
  if (line.includes('\t')) return line.split('\t');
  return line.split(/,(?![^"]*"\s*(?:,|$))|;/).map(s => s.replace(/^"|"$/g, ''));
}

// Turn a stored LinkedIn value into an openable URL. Accepts a full
// http(s) URL, a bare "linkedin.com/in/…" (no scheme), or just a vanity
// slug ("john-doe") — the last becomes a /in/ profile URL. Returns null
// for blanks so the cell can fall back to an editable input.
function linkedinHref(raw) {
  const v = String(raw || '').trim();
  if (!v) return null;
  if (/^https?:\/\//i.test(v)) return v;
  if (/^(www\.)?linkedin\.com/i.test(v)) return `https://${v}`;
  return `https://www.linkedin.com/in/${v.replace(/^\/+/, '')}`;
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

function nameKey(s) {
  return String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

// Placeholder Table View company names ("N/A", "TBD", a lone dash, …)
// that shouldn't pollute the mapping autocomplete or fuzzy index.
function isPlaceholderCompany(s) {
  const t = String(s || '').trim();
  if (!t) return true;
  if (/^[-\u2013\u2014_]+$/.test(t)) return true;
  if (/^(n\.?a\.?|n\/a|none|null|tbd|unknown|\?|\.|test)$/i.test(t)) return true;
  return false;
}

// Inline autocomplete for the Company Mapping cell — filters the Table
// View company list by prefix-then-substring as the user types; ↑ / ↓
// navigates, Enter / click commits, Escape cancels. Local state until
// commit so the table doesn't re-render on every keystroke. Ported from
// the Zoom Info view's company picker.
const CompanyAutocomplete = memo(function CompanyAutocomplete({ value, onCommit, suggestions, placeholder, style, autoFocus, onEditEnd }) {
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
    // Signal the caller that this edit session is over (commit fires on Enter,
    // Tab, suggestion-pick, and blur), so an inline "edit" toggle can close
    // even when the value was left unchanged.
    onEditEnd?.();
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
        autoFocus={autoFocus}
        onChange={e => { setDraft(e.target.value); setOpen(true); setHoverIdx(0); }}
        onFocus={() => setOpen(true)}
        // Commit synchronously on blur (like CommitOnBlurInput) so a
        // type-then-refresh doesn't lose the mapping — a deferred
        // requestAnimationFrame commit never runs as the page tears down.
        // relatedTarget is the element gaining focus, so we still skip the
        // commit when focus merely moves to another control inside the widget.
        onBlur={(e) => { if (!wrapRef.current?.contains(e.relatedTarget)) commit(); }}
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
  if (name && email) return `${name} · ${email}`;
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
              {c.email && <span style={{ color: '#64748B' }}>: {c.email}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
});

export function MarketingLeadsView({ prospects = [], settings, updateSettings, updateSettingsPath, onAddProspect, onSelectProspect, targetAccountsData, onNavigate }) {
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

  // Column visibility — persisted as a HIDDEN list
  // (settings.marketingLeadsHiddenCols) rather than a visible whitelist,
  // so a newly-added column shows by default instead of being hidden for
  // anyone who had previously customized their columns. A one-time
  // migration folds a legacy visible-list into the hidden list, but only
  // for the columns that existed back then — new columns are never
  // auto-hidden. Once migrated, the legacy key is ignored.
  const hiddenCols = useMemo(() => {
    const savedHidden = settings?.marketingLeadsHiddenCols;
    if (Array.isArray(savedHidden)) return new Set(savedHidden);
    const legacyVisible = settings?.marketingLeadsVisibleCols;
    if (Array.isArray(legacyVisible) && legacyVisible.length) {
      const visible = new Set(legacyVisible);
      // Hide only legacy columns the user had turned off; the recently
      // added columns (not present in that saved set's era) stay visible.
      return new Set(LEGACY_COLUMN_KEYS.filter(k => !visible.has(k)));
    }
    return new Set();
  }, [settings]);

  const visibleCols = useMemo(
    () => new Set(COLUMNS.filter(c => !hiddenCols.has(c.key)).map(c => c.key)),
    [hiddenCols],
  );

  function setColVisible(key, on) {
    if (key === 'name') return; // Name is always visible — table needs an anchor
    const next = new Set(hiddenCols);
    if (on) next.delete(key); else next.add(key);
    updateSettings({ marketingLeadsHiddenCols: [...next] });
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
    // + 34 leading select column, + 62 trailing hide/delete-gutter column.
    () => visibleColumnList.reduce((sum, c) => sum + (columnWidths[c.key] || 0), 0) + 34 + 62,
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

  // Resolve a lead's LinkedIn: the value stored on the lead wins; when
  // it's blank, fall back to the LinkedIn URL on the mapped HubSpot
  // contact so a mapped lead shows a link without re-entering it.
  // Returns { value, url, fromHubspot } — value is what's stored on the
  // lead (drives the clear × / editable input), url is the openable link.
  function linkedinForRow(r) {
    const stored = String(r.linkedin || '').trim();
    if (stored) return { value: stored, url: linkedinHref(stored), fromHubspot: false };
    const live = r.hubspotContactId ? findHubspotById(r.hubspotContactId) : null;
    const hs = String(live?.hs_linkedin_url || live?.linkedin_url || live?.hs_linkedinid || '').trim();
    if (hs) return { value: '', url: linkedinHref(hs), fromHubspot: true };
    return { value: '', url: null, fromHubspot: false };
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
    window.alert(`Added ${created.length} contact${created.length === 1 ? '' : 's'} to HubSpot${failed ? `: ${failed} failed` : ''}.`);
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

  // Hidden leads — persisted as a list of lead ids in
  // settings.marketingLeadsHiddenLeads. Hiding is non-destructive (unlike
  // the row × delete): a hidden lead drops out of the default table (and
  // the close-rate), but stays saved and can be brought back from the
  // "Show hidden" view. `showHidden` flips the table to list only the
  // hidden leads so they can be unhidden.
  const hiddenLeadIds = useMemo(() => {
    const arr = settings?.marketingLeadsHiddenLeads;
    return new Set(Array.isArray(arr) ? arr : []);
  }, [settings]);
  const hiddenCount = hiddenLeadIds.size;
  // `showHidden` flips the table to the hidden-only view. The unhide /
  // delete paths that can empty the hidden set flip it back off directly,
  // so there's no view left stranded on an empty list.
  const [showHidden, setShowHidden] = useState(false);

  // Display list = real rows passing the search + per-column filters,
  // sorted if a sort is active, then padded with empty scratch rows up
  // to the minimum — but only in the unfiltered / unsorted default view
  // so a filter or sort never surfaces phantom blank rows. Hidden leads
  // are excluded from the default view and are the only rows shown while
  // `showHidden` is on.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rows = persistedRows.filter(r => {
      if (showHidden ? !hiddenLeadIds.has(r.id) : hiddenLeadIds.has(r.id)) return false;
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
    if (!showHidden && !isFiltering && !isSorting) {
      const padding = Math.max(0, MIN_VISIBLE_ROWS - rows.length);
      const padRows = Array.from({ length: padding }, (_, i) => ({ ...emptyRow(), id: `__pad_${i}` }));
      rows = [...rows, ...padRows];
    }
    return rows;
  }, [persistedRows, hiddenLeadIds, showHidden, search, activeColumnFilters, isFiltering, isSorting, sortKey, sortDir]); // eslint-disable-line react-hooks/exhaustive-deps

  // Close-rate summary over the currently shown leads (padding rows are
  // synthetic scratch rows, so drop them). When a search / column filter
  // is active this reflects just the filtered slice, so the rate updates
  // as you narrow by owner, source, country, etc.
  const closeStats = useMemo(
    () => computeCloseStats(filtered.filter(r => !String(r.id).startsWith('__pad_'))),
    [filtered],
  );

  // ---- Draft emails to the visible leads ------------------------------
  // "Draft Emails" builds one Outlook draft (.eml, X-Unsent) per shown
  // lead that has a real email address, all carrying the same signature
  // from the Draft Emails page (settings.emailSignature). Targets the
  // currently filtered rows so a search / status filter narrows the batch.
  const { isAdmin } = useAuth();
  const [draftModalOpen, setDraftModalOpen] = useState(false);
  const [draftSubject, setDraftSubject] = useState('');
  const [draftBody, setDraftBody] = useState('');
  const [draftResult, setDraftResult] = useState('');

  const emailableLeads = useMemo(() => {
    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const seen = new Set();
    const out = [];
    for (const r of filtered) {
      if (String(r.id).startsWith('__pad_')) continue;
      const email = String(r.email || '').trim();
      if (!emailRe.test(email)) continue;
      const key = email.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(r);
    }
    return out;
  }, [filtered]);

  // ---- Multi-select → Draft Emails page --------------------------------
  // Tick leads here, then "Send to Draft Emails" queues them (as
  // contact-shaped objects) for the Draft Emails composer and jumps to
  // that page. Selection is by lead id and survives search / filtering.
  const [selectedLeadIds, setSelectedLeadIds] = useState(() => new Set());
  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  // Drop ids from the selection once their lead is deleted / re-imported so
  // a stale id can never be sent.
  useEffect(() => {
    setSelectedLeadIds(prev => {
      if (prev.size === 0) return prev;
      const live = new Set(persistedRows.map(r => r.id));
      let changed = false;
      const next = new Set();
      for (const id of prev) { if (live.has(id)) next.add(id); else changed = true; }
      return changed ? next : prev;
    });
  }, [persistedRows]);

  // Real (non-padding) rows currently shown — the pool the header
  // select-all checkbox toggles.
  const shownRealRows = useMemo(
    () => filtered.filter(r => !String(r.id).startsWith('__pad_')),
    [filtered],
  );
  const allShownSelected = shownRealRows.length > 0 && shownRealRows.every(r => selectedLeadIds.has(r.id));
  const someShownSelected = shownRealRows.some(r => selectedLeadIds.has(r.id));

  // Selected leads that actually have an email — the ones we can draft to.
  const selectedEmailable = useMemo(
    () => persistedRows.filter(r => selectedLeadIds.has(r.id) && emailRe.test(String(r.email || '').trim())),
    [persistedRows, selectedLeadIds], // eslint-disable-line react-hooks/exhaustive-deps
  );

  function toggleLeadSelected(id) {
    setSelectedLeadIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function toggleSelectAllShown() {
    setSelectedLeadIds(prev => {
      const next = new Set(prev);
      if (shownRealRows.every(r => next.has(r.id))) {
        for (const r of shownRealRows) next.delete(r.id);
      } else {
        for (const r of shownRealRows) next.add(r.id);
      }
      return next;
    });
  }

  // ---- Bulk edit one field across the selected leads ------------------
  // Pick a field + a value in the modal; Apply writes that value onto
  // every selected lead in a single persist. Leaving the value blank
  // clears the field. The modal stays open after Apply (with a result
  // line) so several fields can be set on the same selection in a row.
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const [bulkField, setBulkField] = useState('status');
  const [bulkValue, setBulkValue] = useState('');
  const [bulkResult, setBulkResult] = useState('');
  const bulkFieldLabel = COLUMNS.find(c => c.key === bulkField)?.label || bulkField;

  function applyBulkEdit() {
    if (!selectedLeadIds.size || !bulkField) return;
    const ids = selectedLeadIds;
    const val = bulkValue;
    persist(persistedRows.map(r => (ids.has(r.id) ? { ...r, [bulkField]: val } : r)));
    const n = ids.size;
    setBulkResult(`Set ${bulkFieldLabel} on ${n} lead${n === 1 ? '' : 's'}${val.trim() ? ` to “${val.trim()}”` : ' (cleared)'}.`);
  }

  // Shape a lead into the contact object the Draft Emails composer expects,
  // splitting the "First Last" name into first / last for {firstName} etc.
  function leadToDraftContact(r) {
    const name = String(r.name || '').trim();
    const parts = name.split(/\s+/).filter(Boolean);
    return {
      id: `lead:${r.id}`,
      name: name || String(r.email || '').trim(),
      firstName: parts[0] || '',
      lastName: parts.slice(1).join(' '),
      email: String(r.email || '').trim(),
      company: String(r.company || '').trim(),
      title: String(r.jobTitle || '').trim(),
    };
  }

  function sendSelectedToDrafts() {
    if (!selectedEmailable.length) return;
    addQueuedLeads(selectedEmailable.map(leadToDraftContact));
    setSelectedLeadIds(new Set());
    if (onNavigate) onNavigate('drafts');
  }

  function createDraftEmails() {
    const signature = resolveSignature(settings, isAdmin);
    const subject = draftSubject.trim();
    if (!subject || !emailableLeads.length) return;
    const drafts = emailableLeads.map(r => {
      const name = String(r.name || '').trim();
      const contact = {
        name,
        firstName: name.split(' ')[0] || '',
        email: String(r.email || '').trim(),
        company: effectiveCompany(r),
        title: String(r.jobTitle || '').trim(),
      };
      const eml = buildUnsentEml({
        toName: name,
        toEmail: contact.email,
        subject: personalizeDraftText(subject, contact),
        bodyHtml: plainBodyToHtml(personalizeDraftText(draftBody, contact)),
        signature,
      });
      return { fileName: `draft_${safeFileName(name || contact.email)}.eml`, eml };
    });
    downloadDrafts(drafts);
    setDraftResult(`${drafts.length} draft .eml file${drafts.length === 1 ? '' : 's'} downloading: double-click each to open in Outlook.`);
  }

  // ---- Contact popup (shared with the other Contacts subtabs) ---------
  // Clicking a lead's Name opens the same ContactEditModal used across the
  // Contacts page. The lead row is held here; the contact object is
  // derived on render. `editingNameId` toggles a row's Name back to an
  // inline input so blank / pad rows can still be typed without the popup.
  const [editingLead, setEditingLead] = useState(null);
  const [editingNameId, setEditingNameId] = useState(null);
  // Toggles a row's Company Mapping (when already mapped to a Table View
  // account, so it renders as a link) back to the inline picker so an existing
  // mapping can be changed in place instead of only cleared.
  const [editingMapId, setEditingMapId] = useState(null);

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
  // "Company ↗" in the contact popup: close the lead's contact editor and
  // open the company it names. A lead's company usually isn't in Table View
  // yet, so companyPopupTarget's name-only fallback is the common case here
  // — the popup opens on the name so it can be added.
  const openCompanyFromContact = useCallback((name) => {
    const target = companyPopupTarget(prospects, name);
    if (!target || !onSelectProspect) return;
    setEditingLead(null);
    onSelectProspect(target);
  }, [prospects, onSelectProspect]);
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

  // Pin the Company name typed in the Edit HubSpot Contact popup, so the
  // next HubSpot refresh doesn't rewrite it back from the Company record
  // the contact is associated with. See utils/contactCompanyOverride.js.
  const saveCompanyOverride = (contactId, value) => {
    const nextLocal = withCompanyOverride(settings?.contactLocalFields, contactId, value);
    if (nextLocal) updateSettings({ contactLocalFields: nextLocal });
  };

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
    const patch = { marketingLeads: persistedRows.filter(r => r.id !== id) };
    // Drop the id from the hidden list too so it can't linger there.
    if (hiddenLeadIds.has(id)) {
      const next = new Set(hiddenLeadIds); next.delete(id);
      patch.marketingLeadsHiddenLeads = [...next];
      if (next.size === 0) setShowHidden(false);
    }
    updateSettings(patch);
  }
  // Delete existing duplicate leads, keeping one row per email (the most
  // complete). Prunes any removed ids from the hidden list too. Counts
  // hidden + visible leads alike so a duplicate can't hide from the sweep.
  function removeDuplicates() {
    const { kept, dropIds } = dedupeByEmail(persistedRows);
    if (!dropIds.length) {
      window.alert('No duplicate contacts found: every saved lead has a unique email.');
      return;
    }
    const ok = window.confirm(
      `Delete ${dropIds.length} duplicate lead${dropIds.length === 1 ? '' : 's'}? ` +
      `The most complete row for each email is kept. This cannot be undone.`,
    );
    if (!ok) return;
    const patch = { marketingLeads: kept };
    const dropSet = new Set(dropIds);
    if ([...hiddenLeadIds].some(id => dropSet.has(id))) {
      const nextHidden = new Set([...hiddenLeadIds].filter(id => !dropSet.has(id)));
      patch.marketingLeadsHiddenLeads = [...nextHidden];
      if (nextHidden.size === 0) setShowHidden(false);
    }
    updateSettings(patch);
    setSelectedLeadIds(prev => {
      if (![...prev].some(id => dropSet.has(id))) return prev;
      return new Set([...prev].filter(id => !dropSet.has(id)));
    });
  }
  // Number of duplicate rows that removeDuplicates would delete — drives
  // the button's enabled state and label.
  const duplicateCount = useMemo(
    () => dedupeByEmail(persistedRows).dropIds.length,
    [persistedRows],
  );

  function clearTable() {
    if (!persistedRows.length) return;
    const ok = window.confirm(
      `Delete all ${persistedRows.length} saved lead${persistedRows.length === 1 ? '' : 's'}? This cannot be undone.`,
    );
    if (!ok) return;
    updateSettings({ marketingLeads: [], marketingLeadsHiddenLeads: [] });
    setShowHidden(false);
  }

  // ---- Hide / unhide leads --------------------------------------------
  // Non-destructive: hidden lead ids are stored in
  // settings.marketingLeadsHiddenLeads and filtered out of the default
  // view. Bulk variants act on the current checkbox selection (reusing the
  // same selection the "Send to Draft Emails" action uses); the per-row
  // buttons act on a single lead.
  function writeHidden(nextSet) {
    updateSettings({ marketingLeadsHiddenLeads: [...nextSet] });
  }
  function hideSelected() {
    if (!selectedLeadIds.size) return;
    const next = new Set(hiddenLeadIds);
    for (const id of selectedLeadIds) if (!String(id).startsWith('__pad_')) next.add(id);
    writeHidden(next);
    setSelectedLeadIds(new Set());
  }
  function unhideSelected() {
    if (!selectedLeadIds.size) return;
    const next = new Set(hiddenLeadIds);
    for (const id of selectedLeadIds) next.delete(id);
    writeHidden(next);
    setSelectedLeadIds(new Set());
    if (next.size === 0) setShowHidden(false);
  }
  function hideRow(id) {
    if (String(id).startsWith('__pad_')) return;
    const next = new Set(hiddenLeadIds); next.add(id);
    writeHidden(next);
    setSelectedLeadIds(prev => { if (!prev.has(id)) return prev; const n = new Set(prev); n.delete(id); return n; });
  }
  function unhideRow(id) {
    const next = new Set(hiddenLeadIds); next.delete(id);
    writeHidden(next);
    setSelectedLeadIds(prev => { if (!prev.has(id)) return prev; const n = new Set(prev); n.delete(id); return n; });
    if (next.size === 0) setShowHidden(false);
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
    // Build the pasted rows as lead rows; planLeadImport below applies the
    // hidden / duplicate / Working-status rules, shared with the BFO
    // Activity → Leads subtab so the two pastes can't disagree about
    // which leads are new.
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
      // list-view copy. Done on the raw name, as it appears in the pasted
      // HTML, before planLeadImport flips it to "First Last".
      if (!fresh.sfUrl && linkMap && fresh.name) {
        const hit = linkMap[nameKey(fresh.name)];
        if (hit) fresh.sfUrl = hit;
      }
      incoming.push(fresh);
    }
    const plan = planLeadImport({
      incoming,
      saved: persistedRows,
      hiddenIds: [...hiddenLeadIds],
      promoteWorkingStatus: true,
    });
    if (plan.additions.length || plan.savedAfter !== persistedRows) {
      persist([...plan.savedAfter, ...plan.additions]);
    }
    setPasteModal(null);
    const notes = [];
    if (plan.statusPromoted > 0) {
      notes.push(
        `${plan.statusPromoted} lead${plan.statusPromoted === 1 ? '' : 's'} moved to Working ` +
        `from a duplicate in the paste.`
      );
    }
    if (plan.blockedDuplicate.length > 0) {
      const n = plan.blockedDuplicate.length;
      notes.push(
        `${n} duplicate${n === 1 ? '' : 's'} skipped (email already saved): ` +
        `${summariseLeadNames(plan.blockedDuplicate)}.`
      );
    }
    if (plan.blockedHidden.length > 0) {
      const n = plan.blockedHidden.length;
      notes.push(
        `${n} lead${n === 1 ? '' : 's'} skipped: ` +
        `${n === 1 ? 'its' : 'their'} email matches a hidden lead ` +
        `(${summariseLeadNames(plan.blockedHidden)}). ` +
        `Unhide from "Show hidden" if you want to import ${n === 1 ? 'it' : 'them'} again.`
      );
    }
    if (notes.length) window.alert(notes.join('\n'));
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
          {persistedRows.length.toLocaleString()} {persistedRows.length === 1 ? 'lead' : 'leads'} saved{hiddenCount ? ` · ${hiddenCount.toLocaleString()} hidden` : ''}
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
        <button
          type="button"
          onClick={() => { setDraftResult(''); setDraftModalOpen(true); }}
          disabled={!emailableLeads.length}
          title={emailableLeads.length
            ? `Draft an Outlook email to each of the ${emailableLeads.length} shown lead${emailableLeads.length === 1 ? '' : 's'} with an email address, using your saved email signature.`
            : 'No shown leads have an email address to draft to.'}
          style={btn({ border: 'none', background: emailableLeads.length ? '#0EA5E9' : '#CBD5E1', color: '#fff', fontWeight: 700, cursor: emailableLeads.length ? 'pointer' : 'not-allowed' })}
        >✉️ Draft {emailableLeads.length || ''} Email{emailableLeads.length === 1 ? '' : 's'}</button>
        <button
          type="button"
          onClick={sendSelectedToDrafts}
          disabled={!selectedEmailable.length}
          title={selectedEmailable.length
            ? `Send the ${selectedEmailable.length} selected lead${selectedEmailable.length === 1 ? '' : 's'} with an email to the Draft Emails page, then open it. Selected leads without an email are skipped.`
            : 'Tick the checkbox on one or more leads (with an email) to send them to the Draft Emails page.'}
          style={btn({ border: 'none', background: selectedEmailable.length ? '#7C3AED' : '#CBD5E1', color: '#fff', fontWeight: 700, cursor: selectedEmailable.length ? 'pointer' : 'not-allowed' })}
        >➤ Send {selectedEmailable.length || ''} to Draft Emails</button>
        <button
          type="button"
          onClick={() => { setBulkResult(''); setBulkEditOpen(true); }}
          disabled={!selectedLeadIds.size}
          title={selectedLeadIds.size
            ? `Set one field (Status, Owner, …) on the ${selectedLeadIds.size} selected lead${selectedLeadIds.size === 1 ? '' : 's'} at once.`
            : 'Tick the checkbox on one or more leads to bulk-edit a field.'}
          style={btn({ border: 'none', background: selectedLeadIds.size ? '#0D9488' : '#CBD5E1', color: '#fff', fontWeight: 700, cursor: selectedLeadIds.size ? 'pointer' : 'not-allowed' })}
        >✏️ Bulk Edit {selectedLeadIds.size || ''}</button>
        {showHidden ? (
          <button
            type="button"
            onClick={unhideSelected}
            disabled={!selectedLeadIds.size}
            title={selectedLeadIds.size
              ? `Unhide the ${selectedLeadIds.size} selected lead${selectedLeadIds.size === 1 ? '' : 's'}: they return to the active list.`
              : 'Tick one or more hidden leads to bring them back.'}
            style={btn({ border: '1px solid #86EFAC', background: selectedLeadIds.size ? '#F0FDF4' : '#F8FAFC', color: selectedLeadIds.size ? '#166534' : '#CBD5E1', cursor: selectedLeadIds.size ? 'pointer' : 'not-allowed' })}
          >👁 Unhide {selectedLeadIds.size || ''}</button>
        ) : (
          <button
            type="button"
            onClick={hideSelected}
            disabled={!selectedLeadIds.size}
            title={selectedLeadIds.size
              ? `Hide the ${selectedLeadIds.size} selected lead${selectedLeadIds.size === 1 ? '' : 's'} from the list. They aren't deleted: bring them back with "Show hidden".`
              : 'Tick the checkbox on one or more leads to hide them.'}
            style={btn({ border: '1px solid #FDBA74', background: selectedLeadIds.size ? '#FFF7ED' : '#F8FAFC', color: selectedLeadIds.size ? '#9A3412' : '#CBD5E1', cursor: selectedLeadIds.size ? 'pointer' : 'not-allowed' })}
          >🙈 Hide {selectedLeadIds.size || ''}</button>
        )}
        {(hiddenCount > 0 || showHidden) && (
          <button
            type="button"
            onClick={() => { setShowHidden(s => !s); setSelectedLeadIds(new Set()); }}
            title={showHidden
              ? 'Back to the active leads.'
              : `Show the ${hiddenCount} hidden lead${hiddenCount === 1 ? '' : 's'} so you can review or unhide them.`}
            style={btn({
              border: `1px solid ${showHidden ? '#009530' : 'var(--color-border)'}`,
              background: showHidden ? '#F0FDF4' : '#fff',
              color: showHidden ? '#166534' : 'var(--color-text-secondary)',
            })}
          >{showHidden ? '← Back to active' : `Show hidden (${hiddenCount})`}</button>
        )}
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
          onClick={removeDuplicates}
          disabled={!duplicateCount}
          title={duplicateCount
            ? `Delete ${duplicateCount} duplicate lead${duplicateCount === 1 ? '' : 's'} (same email), keeping the most complete row for each.`
            : 'No duplicate contacts: every saved lead has a unique email.'}
          style={btn({ border: '1px solid #FCD34D', background: duplicateCount ? '#fff' : '#F8FAFC', color: duplicateCount ? '#B45309' : '#CBD5E1', cursor: duplicateCount ? 'pointer' : 'not-allowed' })}
        >Remove {duplicateCount || ''} duplicate{duplicateCount === 1 ? '' : 's'}</button>
        <button
          type="button"
          onClick={clearTable}
          disabled={!persistedRows.length}
          title={persistedRows.length ? 'Delete every saved lead.' : 'Nothing to clear yet.'}
          style={btn({ border: '1px solid #FCA5A5', background: persistedRows.length ? '#fff' : '#F8FAFC', color: persistedRows.length ? '#B91C1C' : '#CBD5E1', cursor: persistedRows.length ? 'pointer' : 'not-allowed' })}
        >Clear table</button>
      </div>
      <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>
        Tip: in the Salesforce Leads list, select the rows (including the header row), copy, then paste anywhere on this page (or click <strong>📋 Paste from Salesforce</strong>). A column-mapping modal pops up so you can confirm which pasted column fills each field before importing. Click a column header to sort, drag a header to reorder it (drag its right edge to resize), use <strong>Filters</strong> for per-column filtering, and <strong>Columns</strong> to show / hide or reorder columns. The <strong>Company Mapping</strong> column links each lead's company to a Table View account: accept the suggested match or type to pick another. The <strong>Salesforce Link</strong> column captures the record link from each lead's name on paste (an <strong>Open ↗</strong> opens it in Salesforce); you can also paste a link or Lead ID into it by hand. The <strong>HubSpot Contact</strong> column maps each lead to a HubSpot contact: accept the email/name match, search to pick another, or <strong>+ Add to HubSpot</strong> to create a new contact from the lead. The read-only <strong>HubSpot Title</strong> column shows the mapped contact's job title. The <strong>Status</strong> column is a dropdown driven by the <strong>Marketing Lead Status</strong> list on the <strong>Dropdowns</strong> tab: edit that list to change the options. <strong>✉️ Draft Emails</strong> creates an Outlook draft for every shown lead with an email address, signed with your saved email signature (respects the current search / filters). Click a lead's <strong>Name</strong> to open it in the contact popup (the <strong>✎</strong> next to it edits the name inline instead). Tick the checkboxes and click <strong>🙈 Hide</strong> (or the per-row 🙈) to hide leads you're done with: they aren't deleted; use <strong>Show hidden</strong> to review or 👁 unhide them. Tick leads and click <strong>✏️ Bulk Edit</strong> to set one field (Status, Owner, Company Mapping, …) across all of them at once.
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
            {closeStats.rate == null ? '-' : `${(closeStats.rate * 100).toFixed(1)}%`}
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
            placeholder="Paste the copied block: the first row should be the headers (Name, Email, Job Title, …)."
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
            <col style={{ width: 34 }} />
            {visibleColumnList.map(c => (
              <col key={c.key} ref={el => { colRefs.current[c.key] = el; }} style={{ width: `${columnWidths[c.key]}px` }} />
            ))}
            <col style={{ width: 62 }} />
          </colgroup>
          <thead>
            <tr>
              <th style={{ width: 34, textAlign: 'center', background: '#F1F5F9', borderBottom: '1px solid var(--color-border)', position: 'sticky', top: 0, zIndex: 1 }}>
                <input
                  type="checkbox"
                  checked={allShownSelected}
                  ref={el => { if (el) el.indeterminate = someShownSelected && !allShownSelected; }}
                  onChange={toggleSelectAllShown}
                  disabled={shownRealRows.length === 0}
                  title="Select all shown leads"
                  style={{ cursor: shownRealRows.length === 0 ? 'default' : 'pointer' }}
                />
              </th>
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
                <th style={{ background: '#F8FAFC', borderBottom: '1px solid var(--color-border)', position: 'sticky', top: 28, zIndex: 1 }} />
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
                <td colSpan={visibleColumnList.length + 2} style={{ padding: '1.2rem', textAlign: 'center', color: 'var(--color-text-muted)', fontStyle: 'italic', fontSize: '0.78rem' }}>
                  {showHidden ? 'No hidden leads.' : isFiltering ? 'No leads match the current search / filters.' : 'No leads yet: paste from Salesforce to get started.'}
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
                    background: recycled ? '#FEE2E2' : (!isPad && selectedLeadIds.has(r.id) ? '#EFF6FF' : undefined),
                  }}
                >
                  <td style={{ textAlign: 'center', verticalAlign: 'middle' }}>
                    {!isPad && (
                      <input
                        type="checkbox"
                        checked={selectedLeadIds.has(r.id)}
                        onChange={() => toggleLeadSelected(r.id)}
                        title="Select this lead (to hide or send to Draft Emails)"
                        style={{ cursor: 'pointer' }}
                      />
                    )}
                  </td>
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
                      {c.key === 'linkedin' ? (
                        (() => {
                          const { value, url, fromHubspot } = linkedinForRow(r);
                          if (url) {
                            return (
                              <div style={{ padding: '0.45rem 0.6rem', minHeight: '1.4rem', display: 'flex', alignItems: 'center', gap: 6 }}>
                                <a
                                  href={url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  title={fromHubspot
                                    ? `Open this lead's LinkedIn profile (from the mapped HubSpot contact)\n${url}`
                                    : `Open this lead's LinkedIn profile\n${url}`}
                                  style={{ color: '#0A66C2', fontWeight: 700, fontSize: '0.75rem', textDecoration: 'none', whiteSpace: 'nowrap' }}
                                >in ↗</a>
                                {fromHubspot && <span title="From the mapped HubSpot contact" style={{ color: '#94A3B8', fontSize: '0.62rem' }}>HS</span>}
                                {!isPad && value && (
                                  <button
                                    type="button"
                                    onClick={() => updateCell(r.id, 'linkedin', '')}
                                    title="Clear this LinkedIn link"
                                    style={{ border: 'none', background: 'transparent', color: '#94A3B8', cursor: 'pointer', fontSize: '0.85rem', lineHeight: 1, padding: 0 }}
                                  >×</button>
                                )}
                              </div>
                            );
                          }
                          return (
                            <div>
                              <CommitOnBlurInput
                                value={value}
                                onCommit={v => updateCell(r.id, 'linkedin', v)}
                                placeholder={isPad ? '' : 'Paste LinkedIn URL…'}
                                style={cellInputStyle}
                              />
                              {!isPad && (r.name || '').trim() && (
                                <div style={{ padding: '0 0.6rem 0.3rem' }}>
                                  <a
                                    href={`https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent([r.name, effectiveCompany(r)].filter(Boolean).join(' '))}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    title="Search LinkedIn for this person, then paste their profile URL into the field above."
                                    style={{ color: '#0A66C2', fontSize: '0.68rem', fontWeight: 600, textDecoration: 'none', whiteSpace: 'nowrap' }}
                                  >Find ↗</a>
                                </div>
                              )}
                            </div>
                          );
                        })()
                      ) : c.key === 'sfUrl' ? (
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
                                <span style={{ color: '#CBD5E1', fontSize: '0.74rem', fontStyle: 'italic' }}>-</span>
                              </div>
                            );
                          }
                          const color = STATUS_COLORS[status] || '#64748B';
                          return (
                            <div style={{ padding: '0.45rem 0.6rem', minHeight: '1.4rem' }}>
                              <span
                                title={info.statusFrom
                                  ? `Status borrowed from the related account "${info.statusFrom}": "${info.name}" has no status set.`
                                  : `Status for "${info.name}"${info.owned ? '' : ' (from Target Accounts: another CDM)'}`}
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
                              {cdm || <span style={{ color: '#CBD5E1', fontStyle: 'italic' }}>-</span>}
                            </div>
                          );
                        })()
                      ) : c.key === 'tvStatus' ? (
                        <div style={{ padding: '0.45rem 0.6rem', minHeight: '1.4rem' }}>
                          {(() => {
                            const company = effectiveCompany(r);
                            if (!company) return <span style={{ color: '#CBD5E1', fontSize: '0.74rem', fontStyle: 'italic' }}>-</span>;
                            if (isOnTableView(company)) {
                              return (
                                <span title={`"${company}" is already on Table View.`} style={{ background: '#DCFCE7', border: '1px solid #86EFAC', color: '#166534', padding: '2px 8px', borderRadius: 999, fontSize: '0.7rem', fontWeight: 700, whiteSpace: 'nowrap' }}>✓ On Table View</span>
                              );
                            }
                            if (!onAddProspect || isPad) return <span style={{ color: '#CBD5E1', fontSize: '0.74rem', fontStyle: 'italic' }}>-</span>;
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
                              >-</span>
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
                          // Any non-empty mapping renders as its value plus an
                          // inline ✎ (open the picker to change it) and × (clear
                          // it). When the value resolves to one of the user's own
                          // Table View accounts it's a link into that company's
                          // popup; otherwise — e.g. a value that only matches the
                          // cross-CDM Target Accounts list, or free text — it's
                          // plain text, but still fully editable via the ✎. Empty
                          // mappings, pad rows, and the active edit toggle fall
                          // through to the editable picker + suggestion pill below.
                          if (mapped && !isPad && editingMapId !== r.id) {
                            const canLink = prospect && onSelectProspect;
                            return (
                              <div style={{ padding: '0.45rem 0.6rem', minHeight: '1.4rem', display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, overflow: 'hidden' }}>
                                {canLink ? (
                                  <button
                                    type="button"
                                    onClick={() => onSelectProspect(prospect)}
                                    title={`Open the company popup for "${prospect.company || mapped}"`}
                                    style={{ background: 'none', border: 'none', padding: 0, color: '#0369A1', fontWeight: 600, fontSize: '0.8rem', cursor: 'pointer', textAlign: 'left', textDecoration: 'underline', fontFamily: 'inherit', flex: '0 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                                  >{prospect.company || mapped}</button>
                                ) : (
                                  <span
                                    title={`Mapped to "${mapped}": not on your Table View. Click ✎ to change it.`}
                                    style={{ fontSize: '0.8rem', color: '#334155', flex: '0 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                                  >{mapped}</span>
                                )}
                                <button
                                  type="button"
                                  onClick={() => setEditingMapId(r.id)}
                                  title="Change this mapping"
                                  style={{ border: 'none', background: 'transparent', color: '#CBD5E1', cursor: 'pointer', fontSize: '0.75rem', lineHeight: 1, padding: 0, flexShrink: 0 }}
                                  onMouseEnter={e => { e.currentTarget.style.color = '#64748B'; }}
                                  onMouseLeave={e => { e.currentTarget.style.color = '#CBD5E1'; }}
                                >✎</button>
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
                                autoFocus={editingMapId === r.id}
                                onEditEnd={editingMapId === r.id ? () => setEditingMapId(null) : undefined}
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
                              <option value="">{isPad ? '' : '-'}</option>
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
                                placeholder={isPad ? 'Type or paste a lead…' : '-'}
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
                          placeholder="-"
                          style={cellInputStyle}
                        />
                      )}
                    </td>
                  ))}
                  <td style={{ padding: '0.2rem', textAlign: 'center', whiteSpace: 'nowrap' }}>
                    {!isPad && (
                      <button
                        type="button"
                        onClick={() => (showHidden ? unhideRow(r.id) : hideRow(r.id))}
                        title={showHidden ? 'Unhide lead' : 'Hide lead (not deleted)'}
                        style={{ border: 'none', background: 'transparent', color: '#94A3B8', fontSize: '0.9rem', cursor: 'pointer', padding: '0 4px', lineHeight: 1 }}
                        onMouseEnter={e => e.currentTarget.style.color = showHidden ? '#166534' : '#9A3412'}
                        onMouseLeave={e => e.currentTarget.style.color = '#94A3B8'}
                      >{showHidden ? '👁' : '🙈'}</button>
                    )}
                    {!isPad && (
                      <button
                        type="button"
                        onClick={() => deleteRow(r.id)}
                        title="Delete lead"
                        style={{ border: 'none', background: 'transparent', color: '#94A3B8', fontSize: '1rem', cursor: 'pointer', padding: '0 4px', lineHeight: 1 }}
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

      {draftModalOpen && createPortal(
        <div onClick={() => setDraftModalOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 12, padding: '1.5rem', width: 640, maxWidth: '95vw', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.25)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
              <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: 'var(--color-text)' }}>Draft Emails to {emailableLeads.length} Lead{emailableLeads.length === 1 ? '' : 's'}</h3>
              <button onClick={() => setDraftModalOpen(false)} style={{ background: 'none', border: 'none', fontSize: '1.2rem', color: '#94A3B8', cursor: 'pointer', lineHeight: 1 }}>×</button>
            </div>
            <p style={{ fontSize: '0.74rem', color: 'var(--color-text-secondary)', margin: '0 0 0.9rem', lineHeight: 1.5 }}>
              Creates one Outlook draft (<strong>.eml</strong>) per shown lead that has an email address, each addressed to that lead and signed with your saved email signature{resolveSignature(settings, isAdmin) ? '' : ' (none saved yet: add one on the Draft Emails page)'}. Double-click each downloaded file to open it as a draft in Outlook.
              {' '}Tokens: <code>{'{firstName}'}</code>, <code>{'{fullName}'}</code>, <code>{'{company}'}</code>, <code>{'{title}'}</code>, <code>{'{email}'}</code>.
            </p>
            <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 700, color: '#475569', marginBottom: 3 }}>Subject</label>
            <input
              type="text"
              value={draftSubject}
              onChange={e => setDraftSubject(e.target.value)}
              placeholder="e.g. Quick intro for {company}"
              style={{ width: '100%', boxSizing: 'border-box', padding: '0.45rem 0.6rem', border: '1px solid var(--color-border)', borderRadius: 4, fontSize: '0.82rem', fontFamily: 'inherit', marginBottom: '0.7rem' }}
            />
            <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 700, color: '#475569', marginBottom: 3 }}>Body</label>
            <textarea
              value={draftBody}
              onChange={e => setDraftBody(e.target.value)}
              placeholder={'Hi {firstName},\n\n…'}
              style={{ width: '100%', boxSizing: 'border-box', minHeight: 160, padding: '0.5rem 0.6rem', border: '1px solid var(--color-border)', borderRadius: 4, fontSize: '0.82rem', fontFamily: 'inherit', lineHeight: 1.5, resize: 'vertical' }}
            />
            {draftResult && (
              <div style={{ marginTop: '0.7rem', padding: '0.5rem 0.7rem', background: '#F0FDF4', border: '1px solid #86EFAC', borderRadius: 6, fontSize: '0.76rem', color: '#166534', fontWeight: 600 }}>
                {draftResult}
              </div>
            )}
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '1.1rem' }}>
              <button
                type="button"
                onClick={() => setDraftModalOpen(false)}
                style={btn({ border: '1px solid var(--color-border)', background: '#fff', color: 'var(--color-text-secondary)' })}
              >{draftResult ? 'Close' : 'Cancel'}</button>
              <button
                type="button"
                onClick={createDraftEmails}
                disabled={!draftSubject.trim() || !emailableLeads.length}
                title={!draftSubject.trim() ? 'Enter a subject first.' : ''}
                style={btn({ border: 'none', background: (draftSubject.trim() && emailableLeads.length) ? '#009530' : '#CBD5E1', color: '#fff', fontWeight: 700, cursor: (draftSubject.trim() && emailableLeads.length) ? 'pointer' : 'not-allowed' })}
              >Create {emailableLeads.length} draft{emailableLeads.length === 1 ? '' : 's'}</button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {bulkEditOpen && createPortal(
        <div onClick={() => setBulkEditOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 12, padding: '1.5rem', width: 460, maxWidth: '95vw', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.25)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
              <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: 'var(--color-text)' }}>Bulk Edit {selectedLeadIds.size} Lead{selectedLeadIds.size === 1 ? '' : 's'}</h3>
              <button onClick={() => setBulkEditOpen(false)} style={{ background: 'none', border: 'none', fontSize: '1.2rem', color: '#94A3B8', cursor: 'pointer', lineHeight: 1 }}>×</button>
            </div>
            <p style={{ fontSize: '0.74rem', color: 'var(--color-text-secondary)', margin: '0 0 0.9rem', lineHeight: 1.5 }}>
              Pick a field and a value, then <strong>Apply</strong> to set it on all {selectedLeadIds.size} selected lead{selectedLeadIds.size === 1 ? '' : 's'}. Leave the value blank to clear the field. Other fields are left untouched.
            </p>
            <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 700, color: '#475569', marginBottom: 3 }}>Field</label>
            <select
              value={bulkField}
              onChange={e => { setBulkField(e.target.value); setBulkValue(''); setBulkResult(''); }}
              style={{ width: '100%', boxSizing: 'border-box', padding: '0.45rem 0.6rem', border: '1px solid var(--color-border)', borderRadius: 4, fontSize: '0.82rem', fontFamily: 'inherit', marginBottom: '0.7rem', background: '#fff' }}
            >
              {BULK_EDIT_KEYS.map(k => (
                <option key={k} value={k}>{COLUMNS.find(c => c.key === k)?.label || k}</option>
              ))}
            </select>
            <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 700, color: '#475569', marginBottom: 3 }}>
              New {bulkFieldLabel} <span style={{ fontWeight: 400, color: '#94A3B8' }}>(blank clears it)</span>
            </label>
            {bulkField === 'status' && statusOptions.length ? (
              <>
                <input
                  type="text"
                  list="bulk-status-options"
                  value={bulkValue}
                  onChange={e => { setBulkValue(e.target.value); setBulkResult(''); }}
                  placeholder="Pick or type a status…"
                  style={{ width: '100%', boxSizing: 'border-box', padding: '0.45rem 0.6rem', border: '1px solid var(--color-border)', borderRadius: 4, fontSize: '0.82rem', fontFamily: 'inherit' }}
                />
                <datalist id="bulk-status-options">
                  {statusOptions.map(o => <option key={o} value={o} />)}
                </datalist>
              </>
            ) : (
              <input
                type="text"
                value={bulkValue}
                onChange={e => { setBulkValue(e.target.value); setBulkResult(''); }}
                placeholder={`New ${bulkFieldLabel}…`}
                style={{ width: '100%', boxSizing: 'border-box', padding: '0.45rem 0.6rem', border: '1px solid var(--color-border)', borderRadius: 4, fontSize: '0.82rem', fontFamily: 'inherit' }}
              />
            )}
            {bulkResult && (
              <div style={{ marginTop: '0.7rem', padding: '0.5rem 0.7rem', background: '#F0FDF4', border: '1px solid #86EFAC', borderRadius: 6, fontSize: '0.76rem', color: '#166534', fontWeight: 600 }}>
                {bulkResult}
              </div>
            )}
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '1.1rem' }}>
              <button
                type="button"
                onClick={() => setBulkEditOpen(false)}
                style={btn({ border: '1px solid var(--color-border)', background: '#fff', color: 'var(--color-text-secondary)' })}
              >{bulkResult ? 'Done' : 'Cancel'}</button>
              <button
                type="button"
                onClick={applyBulkEdit}
                disabled={!selectedLeadIds.size}
                style={btn({ border: 'none', background: selectedLeadIds.size ? '#0D9488' : '#CBD5E1', color: '#fff', fontWeight: 700, cursor: selectedLeadIds.size ? 'pointer' : 'not-allowed' })}
              >Apply to {selectedLeadIds.size} lead{selectedLeadIds.size === 1 ? '' : 's'}</button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {editingLead && editContact && createPortal(
        <ContactEditModal
          contact={editContact}
          onSave={handleContactSaved}
          onClose={() => setEditingLead(null)}
          onOpenCompany={onSelectProspect ? openCompanyFromContact : null}
          contactNotes={settings?.contactNotes || {}}
          onSaveNote={(cid, v) => saveSettingsMap('contactNotes', cid, v)}
          contactOldEmails={settings?.contactOldEmails || {}}
          onSaveOldEmails={(cid, v) => saveSettingsMap('contactOldEmails', cid, v)}
          contactOldCompany={settings?.contactOldCompany || {}}
          onSaveOldCompany={(cid, v) => saveSettingsMap('contactOldCompany', cid, v)}
          onSaveCompanyOverride={saveCompanyOverride}
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
          contactSentiment={settings?.contactSentiment || {}}
          onSaveSentiment={(cid, v) => {
            if (cid == null) return;
            const next = { ...(settings?.contactSentiment || {}) };
            if (v) next[cid] = v; else delete next[cid];
            updateSettings({ contactSentiment: next });
          }}
          contactTagReview={settings?.contactTagReview || {}}
          onSaveTagReview={(cid, map) => saveTagReview({ cid, map, settings, updateSettings, updateSettingsPath })}
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
          <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: 'var(--color-text)' }}>Import Marketing Leads: Column Mapping</h3>
          <button onClick={onCancel} style={{ background: 'none', border: 'none', fontSize: '1.2rem', color: '#94A3B8', cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>
        <p style={{ fontSize: '0.72rem', color: 'var(--color-text-secondary)', margin: '0 0 1rem 0', lineHeight: 1.4 }}>
          Detected <strong>{rows.length.toLocaleString()}</strong> row{rows.length === 1 ? '' : 's'} and <strong>{headers.length}</strong> column{headers.length === 1 ? '' : 's'} from your clipboard. The first row was treated as headers: pick which pasted column should fill each lead field. Headers that match common names (Name, Email, Company, …) are mapped automatically.
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
                    <span style={{ color: t.required ? '#DC2626' : '#94A3B8', fontSize: '0.68rem', fontWeight: 600 }}>{t.required ? '(not mapped)' : '(optional)'}</span>
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
                    <option value="">(Ignore)</option>
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
                      <td key={t.key} style={{ ...cellBase, color: v ? '#1E293B' : '#CBD5E1', fontStyle: v ? 'normal' : 'italic' }}>{v || '-'}</td>
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
