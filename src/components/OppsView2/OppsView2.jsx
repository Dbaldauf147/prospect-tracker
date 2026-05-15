import { useState, useEffect, useLayoutEffect, useMemo, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import { DataTable } from '../common/DataTable';
import { dbGet, dbPut } from '../../utils/db';
import { SOLUTIONS_CATALOG, DROPDOWN_LISTS } from '../../data/dropdownLists';
import styles from './OppsView2.module.css';

// Second Opps tab — user-entered opps stored in Firestore
// (`opps2Data/{uid}`) with an IndexedDB cache (`opps2-cache`, key
// `data`) for instant rehydration on reload. The original Opps tab
// stays the canonical Google Sheets view; Opps 2 is the place the
// user types new opps directly into the app.

const OPPS2_STORE = 'opps2-cache';
const OPPS2_CACHE_KEY = 'data';
const OPPS2_FIRESTORE_COLLECTION = 'opps2Data';

async function loadOpps2Cache() {
  try { return await dbGet(OPPS2_STORE, OPPS2_CACHE_KEY); }
  catch (err) { console.error('opps2: IndexedDB load failed', err); return null; }
}

async function saveOpps2Cache(data) {
  try { await dbPut(OPPS2_STORE, data, OPPS2_CACHE_KEY); }
  catch (err) { console.error('opps2: IndexedDB save failed', err); }
}

async function loadOpps2FromFirestore(userId) {
  try {
    const ref = doc(db, OPPS2_FIRESTORE_COLLECTION, userId);
    const snap = await getDoc(ref);
    if (snap.exists()) {
      const raw = snap.data();
      if (raw?.json) return JSON.parse(raw.json);
    }
  } catch (err) { console.error('opps2: Firestore load failed', err); }
  return null;
}

async function saveOpps2ToFirestore(userId, data) {
  try {
    const ref = doc(db, OPPS2_FIRESTORE_COLLECTION, userId);
    await setDoc(ref, { json: JSON.stringify(data), updatedAt: new Date().toISOString() });
  } catch (err) { console.error('opps2: Firestore save failed', err); }
}

// Default column set, seeded so the table has columns to show / sort /
// filter / hide / resize even before any data exists.
const DEFAULT_HEADERS = [
  'Account', 'Open Year', 'Contact', 'Stage', 'Scope', 'Source', 'Type',
  'Start Date', 'Status', 'Quoted Amount', 'Sites', 'Age',
  'Last Client Heard From Us', 'Last Spoke', 'Follow Up', 'Call In', 'Notes',
  'Competition', 'Waiting On', 'Close Date', 'BFO Link',
];

// Key columns to show by default (the rest are available via Columns toggle)
const KEY_COLS = [
  'Account', 'Contact', 'Stage', 'Scope', 'Source', 'Type',
  'Start Date', 'Status', 'Quoted Amount', 'Sites', 'Age',
  'Last Client Heard From Us', 'Last Spoke', 'Follow Up', 'Call In', 'Notes',
  'Competition', 'Waiting On', 'Close Date',
];

// Columns the user wants treated as dates — rendered with a calendar
// popup cell (HTML5 date input) and pre-populated with today on new
// opps so a fresh entry shows useful defaults instead of blanks.
const DATE_COLUMNS = new Set(['Start Date', 'Last Client Heard From Us', 'Follow Up']);

// Read-only columns whose value is derived from other cells.
//   Call In    = calendar days from today to the Follow Up date
//   Last Spoke = business days from Last Client Heard From Us to today
// Always append these to header sets loaded from the legacy Opps cache
// so they show up even when the cached headers predate the columns.
const COMPUTED_COLUMNS = ['Last Spoke', 'Call In'];

function todayISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function makeBlankOpp(id, headers, accountOverride) {
  const row = { _id: id, id }; // id mirrored so DataTable's row key stays stable across edits
  const cols = (Array.isArray(headers) && headers.length) ? headers : DEFAULT_HEADERS;
  for (const h of cols) row[h] = '';
  // Leave Account blank when there's no override so the inline cell
  // autocomplete (fed from Table View companies) starts surfacing
  // matches the moment the user types — instead of having to first
  // clear a placeholder string.
  row['Account'] = typeof accountOverride === 'string' && accountOverride.trim() ? accountOverride.trim() : '';
  row['Open Year'] = String(new Date().getFullYear());
  row['Stage'] = 'Not Started';
  row['Status'] = 'Client waiting on ESS team member';
  // Default the three date columns the user tracks day-to-day to
  // today's date. Stored as ISO (YYYY-MM-DD) so the HTML5 date input
  // accepts it directly; DateCell displays a localized format.
  const today = todayISO();
  for (const dateCol of DATE_COLUMNS) {
    if (cols.includes(dateCol)) row[dateCol] = today;
  }
  return row;
}

// Header combobox — same prefix-then-substring autocomplete as the
// Account-column EditableCell, but committing a value creates a brand
// new opp pre-filled with that company name instead of mutating a
// single cell. Lets the user surface an existing company by typing a
// few letters; typing something brand-new and pressing Enter still
// works and creates an opp with that new account name.
function AddCompanyCombobox({ suggestions, onCommit, placeholder = 'Add company…' }) {
  const [draft, setDraft] = useState('');
  const [open, setOpen] = useState(false);
  const [hoverIdx, setHoverIdx] = useState(0);
  const wrapRef = useRef(null);

  const matches = useMemo(() => {
    if (!suggestions?.length) return [];
    const q = String(draft || '').trim().toLowerCase();
    // No query yet — show the first 8 suggestions alphabetically so
    // the dropdown signals "predictive text is available" as soon as
    // the user clicks into the field.
    if (!q) return suggestions.slice(0, 8);
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

  function commit(picked) {
    const v = (picked == null ? draft : picked).trim();
    if (!v) return;
    onCommit(v);
    setDraft('');
    setOpen(false);
    setHoverIdx(0);
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <input
        type="text"
        value={draft}
        placeholder={placeholder}
        onChange={(e) => { setDraft(e.target.value); setOpen(true); setHoverIdx(0); }}
        onFocus={() => { if (draft) setOpen(true); }}
        onBlur={() => {
          requestAnimationFrame(() => {
            if (!wrapRef.current?.contains(document.activeElement)) setOpen(false);
          });
        }}
        onKeyDown={(e) => {
          if (open && matches.length > 0) {
            if (e.key === 'ArrowDown') { e.preventDefault(); setHoverIdx(i => (i + 1) % matches.length); return; }
            if (e.key === 'ArrowUp')   { e.preventDefault(); setHoverIdx(i => (i - 1 + matches.length) % matches.length); return; }
            if (e.key === 'Enter' || e.key === 'Tab') {
              e.preventDefault();
              commit(matches[hoverIdx] || matches[0]);
              return;
            }
            if (e.key === 'Escape') { e.preventDefault(); setOpen(false); return; }
          } else if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          } else if (e.key === 'Escape') {
            setDraft('');
            setOpen(false);
          }
        }}
        style={{
          width: 240,
          padding: '0.4rem 0.6rem',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-md)',
          fontSize: 'var(--font-size-sm)',
          fontFamily: 'inherit',
          color: 'var(--color-text)',
          background: 'var(--color-bg)',
        }}
      />
      {open && matches.length > 0 && (
        <div
          onMouseDown={(e) => e.preventDefault()}
          style={{
            position: 'absolute', top: '100%', left: 0, minWidth: '100%',
            zIndex: 50, background: '#fff', border: '1px solid var(--color-border)',
            borderRadius: 4, boxShadow: '0 8px 20px rgba(15, 23, 42, 0.12)',
            maxHeight: 240, overflowY: 'auto', fontSize: '0.82rem', marginTop: 2,
          }}
        >
          {matches.map((m, i) => (
            <div
              key={m + i}
              onClick={() => commit(m)}
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
}

// Click-to-edit cell. Plain text by default; on click flips into an
// input that commits on Enter or blur and reverts on Escape. When
// `suggestions` is provided, the input also shows a prefix-then-
// substring autocomplete dropdown so the user can pick an existing
// company name (used for the Account column on Opps 2).
// Date cell — renders the value as M/D/YYYY for display, and pops a
// native HTML5 date input (calendar) on click so the user can pick a
// new value. Stores the chosen date as ISO (YYYY-MM-DD) so it round-
// trips cleanly through the same `<input type="date">` later.
function toISODate(raw) {
  if (!raw) return '';
  const s = String(raw).trim();
  // Already ISO?
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const t = Date.parse(s);
  if (isNaN(t)) return '';
  const d = new Date(t);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatDateDisplay(raw) {
  const iso = toISODate(raw);
  if (!iso) return String(raw || '');
  // Render as M/D/YYYY without time-zone offset surprises (parse the
  // ISO string in local time, not UTC).
  const [y, m, d] = iso.split('-').map(n => parseInt(n, 10));
  return `${m}/${d}/${y}`;
}

function DateCell({ value, onChange }) {
  const [editing, setEditing] = useState(false);
  const iso = toISODate(value);
  if (!editing) {
    const isEmpty = !value;
    return (
      <span
        onClick={(e) => { e.stopPropagation(); setEditing(true); }}
        style={{
          display: 'block', cursor: 'pointer', minHeight: '1em',
          padding: '1px 2px',
          color: isEmpty ? 'var(--color-text-muted)' : 'inherit',
        }}
        title="Click to pick a date"
      >
        {isEmpty ? '—' : formatDateDisplay(value)}
      </span>
    );
  }
  return (
    <input
      autoFocus
      type="date"
      value={iso}
      onChange={(e) => onChange(e.target.value)}
      onBlur={() => setEditing(false)}
      onKeyDown={(e) => {
        if (e.key === 'Escape' || e.key === 'Enter') {
          e.preventDefault();
          setEditing(false);
        }
      }}
      onClick={(e) => e.stopPropagation()}
      style={{
        width: '100%', boxSizing: 'border-box',
        border: '1px solid var(--color-accent)', borderRadius: 3,
        padding: '1px 4px',
        fontSize: 'inherit', fontFamily: 'inherit', color: 'var(--color-text)',
        background: '#fff',
      }}
    />
  );
}

// Calendar days from today to the given ISO date. Positive = future,
// negative = past. Returns null for blank / unparseable dates.
function daysFromToday(rawISO) {
  const iso = toISODate(rawISO);
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(n => parseInt(n, 10));
  const target = new Date(y, m - 1, d);
  target.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target - today) / 86400000);
}

// Whole business days (Mon–Fri) elapsed from the given ISO date to
// today. 0 when the date is today or in the future; null when blank.
function businessDaysSince(rawISO) {
  const iso = toISODate(rawISO);
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(n => parseInt(n, 10));
  const start = new Date(y, m - 1, d);
  start.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (today <= start) return 0;
  let count = 0;
  const cur = new Date(start);
  while (cur < today) {
    cur.setDate(cur.getDate() + 1);
    const dow = cur.getDay();
    if (dow !== 0 && dow !== 6) count++;
  }
  return count;
}

// Read-only cell for a column whose value is derived from another cell.
function ComputedCell({ value }) {
  const isEmpty = value == null || value === '';
  return (
    <span
      style={{
        display: 'block', minHeight: '1em',
        padding: '1px 2px',
        color: isEmpty ? 'var(--color-text-muted)' : 'inherit',
      }}
      title="Computed value"
    >
      {isEmpty ? '—' : String(value)}
    </span>
  );
}

function EditableCell({ value, onChange, suggestions, onAddNew, addNewLabel }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? '');
  const [open, setOpen] = useState(false);
  const [hoverIdx, setHoverIdx] = useState(0);
  // Dropdown is portaled to <body> so the table cell's overflow:hidden
  // can't clip it; position is recomputed from the wrapper's bounding
  // rect whenever the dropdown opens.
  const [dropPos, setDropPos] = useState({ top: 0, left: 0, width: 0 });
  const wrapRef = useRef(null);
  useEffect(() => { if (!editing) setDraft(value ?? ''); }, [value, editing]);

  // Matches are a mix of plain strings (existing suggestions) and an
  // optional `+ Add "X"` sentinel object at the end when `onAddNew` is
  // wired up and the current draft isn't an exact match to any
  // suggestion. Keeping both in one array means hover / keyboard nav
  // works uniformly.
  const matches = useMemo(() => {
    const list = suggestions || [];
    const q = String(draft || '').trim().toLowerCase();
    if (!q) {
      // No query yet — surface the first 8 suggestions alphabetically
      // so the dropdown shows as soon as the cell is focused. The add
      // sentinel needs a non-empty draft, so it's not included here.
      return list.slice(0, 8);
    }
    const prefix = [];
    const sub = [];
    for (const s of list) {
      const lower = String(s).toLowerCase();
      if (lower === q) continue;
      if (lower.startsWith(q)) prefix.push(s);
      else if (lower.includes(q)) sub.push(s);
      if (prefix.length + sub.length >= 25) break;
    }
    const result = [...prefix, ...sub].slice(0, 8);
    if (onAddNew) {
      const exact = list.some(s => String(s).toLowerCase() === q);
      if (!exact) {
        const txt = draft.trim();
        const label = typeof addNewLabel === 'function' ? addNewLabel(txt) : `+ Add "${txt}"`;
        result.push({ __add: true, value: txt, label });
      }
    }
    return result;
  }, [draft, suggestions, onAddNew, addNewLabel]);

  const dropdownAvailable = (suggestions?.length || 0) > 0 || !!onAddNew;

  function commit(next) {
    const v = next == null ? draft : next;
    setEditing(false);
    setOpen(false);
    if ((v ?? '') !== (value ?? '')) onChange(v);
  }

  function pickMatch(m) {
    if (m && typeof m === 'object' && m.__add) {
      if (typeof onAddNew === 'function') onAddNew(m.value);
      setDraft(m.value);
      commit(m.value);
      return;
    }
    setDraft(m);
    commit(m);
  }

  useLayoutEffect(() => {
    if (!open || !wrapRef.current) return;
    const rect = wrapRef.current.getBoundingClientRect();
    setDropPos({ top: rect.bottom + 2, left: rect.left, width: rect.width });
  }, [open, draft]);

  if (!editing) {
    const isEmpty = value === '' || value == null;
    return (
      <span
        onClick={(e) => { e.stopPropagation(); setEditing(true); setOpen(dropdownAvailable); }}
        style={{
          display: 'block', cursor: 'text', minHeight: '1em',
          padding: '1px 2px',
          color: isEmpty ? 'var(--color-text-muted)' : 'inherit',
        }}
        title="Click to edit"
      >
        {isEmpty ? '—' : String(value)}
      </span>
    );
  }
  return (
    <div ref={wrapRef} style={{ position: 'relative' }} onClick={(e) => e.stopPropagation()}>
      <input
        autoFocus
        type="text"
        value={draft}
        onChange={(e) => { setDraft(e.target.value); setOpen(true); setHoverIdx(0); }}
        onFocus={() => { if (dropdownAvailable) setOpen(true); }}
        onBlur={() => {
          // Defer so a click on a suggestion lands first.
          requestAnimationFrame(() => {
            if (!wrapRef.current?.contains(document.activeElement)) commit();
          });
        }}
        onKeyDown={(e) => {
          if (open && matches.length > 0) {
            if (e.key === 'ArrowDown') { e.preventDefault(); setHoverIdx(i => (i + 1) % matches.length); return; }
            if (e.key === 'ArrowUp')   { e.preventDefault(); setHoverIdx(i => (i - 1 + matches.length) % matches.length); return; }
            if (e.key === 'Tab')       { e.preventDefault(); pickMatch(matches[hoverIdx] || matches[0]); return; }
            if (e.key === 'Enter')     { e.preventDefault(); pickMatch(matches[hoverIdx] || matches[0]); return; }
            if (e.key === 'Escape')    { e.preventDefault(); setDraft(value ?? ''); setEditing(false); setOpen(false); return; }
          } else {
            if (e.key === 'Enter')  { e.preventDefault(); e.currentTarget.blur(); }
            if (e.key === 'Escape') { setDraft(value ?? ''); setEditing(false); }
          }
        }}
        style={{
          width: '100%', boxSizing: 'border-box',
          border: '1px solid var(--color-accent)', borderRadius: 3,
          padding: '1px 4px',
          fontSize: 'inherit', fontFamily: 'inherit', color: 'var(--color-text)',
          background: '#fff',
        }}
      />
      {open && matches.length > 0 && createPortal(
        <div
          onMouseDown={(e) => e.preventDefault()}
          style={{
            position: 'fixed', top: dropPos.top, left: dropPos.left,
            minWidth: Math.max(dropPos.width, 160),
            zIndex: 9999, background: '#fff', border: '1px solid var(--color-border)',
            borderRadius: 4, boxShadow: '0 8px 20px rgba(15, 23, 42, 0.12)',
            maxHeight: 220, overflowY: 'auto', fontSize: '0.78rem',
          }}
        >
          {matches.map((m, i) => {
            const isAdd = m && typeof m === 'object' && m.__add;
            const label = isAdd ? m.label : m;
            return (
              <div
                key={isAdd ? '__add' : String(m) + i}
                onClick={() => pickMatch(m)}
                onMouseEnter={() => setHoverIdx(i)}
                style={{
                  padding: '0.3rem 0.55rem', cursor: 'pointer',
                  background: i === hoverIdx ? '#DCFCE7' : 'transparent',
                  color: i === hoverIdx ? '#166534' : (isAdd ? '#7C3AED' : '#1E293B'),
                  fontStyle: isAdd ? 'italic' : 'normal',
                  fontWeight: i === hoverIdx ? 700 : 500,
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  borderTop: isAdd && i > 0 ? '1px solid var(--color-border-light)' : 'none',
                }}
              >{label}</div>
            );
          })}
        </div>,
        document.body,
      )}
    </div>
  );
}

// Contact-column cell — extends EditableCell with a per-row scoped
// suggestion list pulled from the prospect whose `company` matches
// this row's Account. Picking the synthetic "+ Add" entry appends a
// new contact (firstname / lastname split from the typed text) to
// that prospect via updateProspect so it persists for future opps.
function ContactCell({ value, onChange, account, prospects, updateProspect }) {
  const matched = useMemo(() => {
    const target = String(account || '').trim().toLowerCase();
    if (!target) return null;
    return (prospects || []).find(p => String(p?.company || '').trim().toLowerCase() === target) || null;
  }, [account, prospects]);

  const contactSuggestions = useMemo(() => {
    if (!matched?.contacts?.length) return [];
    const seen = new Set();
    const out = [];
    for (const c of matched.contacts) {
      const name = [c?.firstname, c?.lastname].filter(Boolean).join(' ').trim();
      if (!name) continue;
      const k = name.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(name);
    }
    out.sort((a, b) => a.localeCompare(b));
    return out;
  }, [matched]);

  const onAddNew = useMemo(() => {
    if (!matched || typeof updateProspect !== 'function') return undefined;
    return (text) => {
      const name = String(text || '').trim();
      if (!name) return;
      const parts = name.split(/\s+/);
      const firstname = parts[0] || '';
      const lastname = parts.slice(1).join(' ');
      const newContact = {
        id: `c_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        firstname,
        lastname,
        email: '',
        phone: '',
        mobilephone: '',
        jobtitle: '',
        company: matched.company || '',
      };
      const nextContacts = [...(matched.contacts || []), newContact];
      Promise.resolve(updateProspect(matched.id, { contacts: nextContacts })).catch(() => {});
    };
  }, [matched, updateProspect]);

  return (
    <EditableCell
      value={value}
      onChange={onChange}
      suggestions={contactSuggestions}
      onAddNew={onAddNew}
      addNewLabel={(txt) => `+ Add "${txt}" to ${matched?.company || 'this account'}`}
    />
  );
}

// Single-select cell — click to open a popover of options sourced from
// the Dropdowns page (e.g. Source). Picking an option commits the value
// and closes the popover; "Clear" empties it.
function SelectCell({ value, onChange, options }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (!wrapRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const current = String(value || '').trim();
  const isEmpty = !current;
  // Surface any pre-existing free-text value that isn't in the
  // configured list, so legacy data stays selectable instead of
  // silently dropping off the menu.
  const displayOptions = useMemo(() => {
    if (!current) return options;
    if (options.some(o => o.toLowerCase() === current.toLowerCase())) return options;
    return [current, ...options];
  }, [options, current]);

  function pick(opt) {
    onChange(opt);
    setOpen(false);
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative' }} onClick={(e) => e.stopPropagation()}>
      <span
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'block', cursor: 'pointer', minHeight: '1em',
          padding: '1px 2px',
          color: isEmpty ? 'var(--color-text-muted)' : 'inherit',
        }}
        title="Click to pick a source"
      >
        {isEmpty ? '—' : current}
      </span>
      {open && (
        <div
          onMouseDown={(e) => e.stopPropagation()}
          style={{
            position: 'absolute', top: '100%', left: 0, marginTop: 2,
            zIndex: 50, minWidth: '100%', width: 240,
            background: '#fff', border: '1px solid var(--color-border)',
            borderRadius: 4, boxShadow: '0 8px 20px rgba(15, 23, 42, 0.18)',
            fontSize: '0.82rem',
          }}
        >
          <div style={{ maxHeight: 280, overflowY: 'auto' }}>
            {displayOptions.map(opt => {
              const selected = opt.toLowerCase() === current.toLowerCase();
              return (
                <div
                  key={opt}
                  onClick={() => pick(opt)}
                  style={{
                    padding: '0.35rem 0.6rem', cursor: 'pointer',
                    background: selected ? '#DCFCE7' : 'transparent',
                    color: selected ? '#166534' : '#1E293B',
                    fontWeight: selected ? 700 : 500,
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}
                >{opt}</div>
              );
            })}
          </div>
          {!isEmpty && (
            <div style={{
              display: 'flex', justifyContent: 'flex-end',
              padding: '0.3rem 0.5rem', borderTop: '1px solid var(--color-border-light)',
              background: 'var(--color-bg)',
            }}>
              <button
                type="button"
                onClick={() => { onChange(''); setOpen(false); }}
                style={{
                  padding: '0.2rem 0.5rem', background: 'transparent',
                  border: '1px solid var(--color-border)', borderRadius: 3,
                  fontSize: '0.7rem', fontWeight: 600, fontFamily: 'inherit',
                  color: 'var(--color-text-muted)', cursor: 'pointer',
                }}
              >Clear</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Pull the Source picklist out of the shared DROPDOWN_LISTS so the cell
// menu stays in lock-step with the Dropdowns tab.
const SOURCE_OPTIONS = (DROPDOWN_LISTS.find(l => l.key === 'source')?.options) || [];
const STAGE_OPTIONS = (DROPDOWN_LISTS.find(l => l.key === 'status')?.options) || [];

export function OppsView2({ settings, updateSettings, prospects = [], updateProspect } = {}) {
  const { user } = useAuth();
  // Seeded with DEFAULT_HEADERS so the table renders columns immediately;
  // the hydration effect below replaces this with the user's saved
  // headers + records once Firestore / IndexedDB returns.
  const [data, setData] = useState({ headers: DEFAULT_HEADERS, records: [] });
  const [loading, setLoading] = useState(true);
  const [error] = useState(null);
  // Persisting only kicks in after the initial hydration finishes —
  // otherwise the seed value would be written back, wiping the saved
  // state for any user who happens to refresh before the load
  // resolves.
  const hydratedRef = useRef(false);
  const firestoreSaveTimerRef = useRef(null);
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState('opps');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [activityFilter, setActivityFilter] = useState('all');
  const servicesDefaultAppliedRef = useRef(false);
  useEffect(() => {
    if (activeTab === 'services' && !servicesDefaultAppliedRef.current) {
      servicesDefaultAppliedRef.current = true;
      setActivityFilter(prev => (prev === 'all' ? 'active' : prev));
    }
  }, [activeTab]);
  const [hiddenServices, setHiddenServices] = useState(() => new Set());
  const [showHidden, setShowHidden] = useState(false);

  // Hydration — load the user's saved opps. Prefer Firestore (cross-
  // device truth), fall back to the IndexedDB cache (last-known on
  // this browser), fall back to the original Opps tab's header order
  // so a brand-new Opps 2 user still sees the same column layout as
  // the live Opps tab. Runs once per user change.
  useEffect(() => {
    if (!user?.uid) {
      // Logged-out / pre-auth: keep the seed but don't enable saves
      // (we'd hit the dbPut scoping guard).
      setLoading(false);
      return;
    }
    let cancelled = false;
    hydratedRef.current = false;
    setLoading(true);
    (async () => {
      let next = null;
      const fromFs = await loadOpps2FromFirestore(user.uid);
      if (cancelled) return;
      if (fromFs && (Array.isArray(fromFs.records) || Array.isArray(fromFs.headers))) {
        next = fromFs;
        // Cache the Firestore copy locally for the next reload.
        saveOpps2Cache(fromFs);
      } else {
        const fromIdb = await loadOpps2Cache();
        if (cancelled) return;
        if (fromIdb && (Array.isArray(fromIdb.records) || Array.isArray(fromIdb.headers))) {
          next = fromIdb;
        }
      }
      if (!next) {
        // No saved opps yet — borrow header order from the live Opps
        // tab's cache so the column layout matches what the user is
        // used to. Records stay empty.
        try {
          const oppsCache = await dbGet('opps-cache', 'data');
          const cachedHeaders = oppsCache?.headers;
          if (Array.isArray(cachedHeaders) && cachedHeaders.length > 0) {
            const seen = new Set();
            const dedup = [];
            for (const h of cachedHeaders) {
              const t = String(h || '').trim();
              if (!t || seen.has(t)) continue;
              seen.add(t);
              dedup.push(t);
            }
            next = { headers: dedup, records: [] };
          }
        } catch {}
      }
      if (cancelled) return;
      if (next) {
        // Ensure the computed columns (Call In, Last Spoke) are present
        // on any header set we hydrate from — Firestore, IndexedDB, or
        // the legacy Opps cache may all predate them.
        const headerSet = new Set((next.headers || []).map(h => String(h || '').trim()).filter(Boolean));
        const extra = COMPUTED_COLUMNS.filter(c => !headerSet.has(c));
        if (extra.length) next = { ...next, headers: [...(next.headers || []), ...extra] };
        setData(next);
      }
      setLoading(false);
      hydratedRef.current = true;
    })();
    return () => { cancelled = true; };
  }, [user?.uid]);

  // Persistence — IndexedDB writes immediately (cheap, survives
  // reload), Firestore writes are debounced 1.5s so a flurry of cell
  // edits collapses into a single round-trip.
  useEffect(() => {
    if (!hydratedRef.current) return;
    saveOpps2Cache(data);
    if (!user?.uid) return;
    if (firestoreSaveTimerRef.current) clearTimeout(firestoreSaveTimerRef.current);
    firestoreSaveTimerRef.current = setTimeout(() => {
      saveOpps2ToFirestore(user.uid, data);
    }, 1500);
    return () => {
      if (firestoreSaveTimerRef.current) clearTimeout(firestoreSaveTimerRef.current);
    };
  }, [data, user?.uid]);

  // Flush any pending Firestore save when the tab is closed / reloaded
  // so the last keystroke before a reload still survives the round
  // trip.
  useEffect(() => {
    function flush() {
      if (firestoreSaveTimerRef.current && user?.uid) {
        clearTimeout(firestoreSaveTimerRef.current);
        firestoreSaveTimerRef.current = null;
        saveOpps2ToFirestore(user.uid, data);
      }
    }
    window.addEventListener('beforeunload', flush);
    return () => window.removeEventListener('beforeunload', flush);
  }, [data, user?.uid]);

  const addNewOpp = useCallback((accountName) => {
    setData(prev => {
      const records = prev?.records || [];
      const headers = prev?.headers?.length ? prev.headers : DEFAULT_HEADERS;
      const nextId = records.reduce((m, r) => Math.max(m, r._id || 0), 0) + 1;
      return { ...prev, headers, records: [makeBlankOpp(nextId, headers, accountName), ...records] };
    });
  }, []);

  const updateOppField = useCallback((id, field, value) => {
    setData(prev => {
      const records = prev?.records || [];
      return {
        ...prev,
        records: records.map(r => r._id === id ? { ...r, [field]: value } : r),
      };
    });
  }, []);

  const toggleHideService = useCallback((scope) => {
    setHiddenServices(prev => {
      const next = new Set(prev);
      if (next.has(scope)) next.delete(scope); else next.add(scope);
      return next;
    });
  }, []);

  const headers = data?.headers || [];
  const records = useMemo(() => {
    const raw = data?.records || [];
    return raw.filter(r => {
      const v = String(r['Open Year'] ?? '').trim();
      return v && v !== '-' && v !== '#N/A';
    });
  }, [data]);

  // Sorted, deduped list of company names — fed into the Account
  // column's autocomplete. Pulls from Table View prospects first
  // (the user's authoritative customer list); also folds in any
  // Account names already present in this tab's opps so adding a
  // follow-up opp for an existing account still autocompletes even
  // when the Table View hasn't loaded.
  const companySuggestions = useMemo(() => {
    const seen = new Set();
    const out = [];
    const push = (name) => {
      const c = String(name || '').trim();
      if (!c) return;
      const k = c.toLowerCase();
      if (seen.has(k)) return;
      seen.add(k);
      out.push(c);
    };
    for (const p of (prospects || [])) push(p?.company);
    for (const r of (data?.records || [])) push(r?.Account);
    out.sort((a, b) => a.localeCompare(b));
    return out;
  }, [prospects, data?.records]);

  const columns = useMemo(() => {
    const seen = new Set();
    return headers
      .filter(h => {
        if (!h || seen.has(h)) return false;
        seen.add(h);
        return true;
      })
      .map(h => ({
        key: h,
        label: h === 'BFO Link' ? 'BFO Opportunity Name' : h,
        defaultWidth: h === 'Notes' ? 250 : h === 'Account' ? 200 : h === 'BFO Link' ? 220 : h === 'Scope' ? 220 : h.length > 20 ? 160 : 120,
        sticky: h === 'Account',
        // Every cell is click-to-edit so a freshly created opp can be
        // filled in directly. getFilterValue exposes the raw text to
        // the per-column filter so search keeps working on the value
        // the user sees, not the rendered <input>.
        getFilterValue: (row) => row[h] ?? '',
        render: (row) => {
          if (h === 'Call In') {
            // Days until the Follow Up date (negative = overdue).
            const n = daysFromToday(row['Follow Up']);
            return <ComputedCell value={n == null ? '' : n} />;
          }
          if (h === 'Last Spoke') {
            // Business days since the Last Client Heard From Us date.
            const n = businessDaysSince(row['Last Client Heard From Us']);
            return <ComputedCell value={n == null ? '' : n} />;
          }
          if (DATE_COLUMNS.has(h)) {
            return <DateCell value={row[h]} onChange={(v) => updateOppField(row._id, h, v)} />;
          }
          if (h === 'Scope') {
            return (
              <MultiSelectCell
                value={row[h]}
                onChange={(v) => updateOppField(row._id, h, v)}
                options={SOLUTIONS_CATALOG}
              />
            );
          }
          if (h === 'Source') {
            return (
              <SelectCell
                value={row[h]}
                onChange={(v) => updateOppField(row._id, h, v)}
                options={SOURCE_OPTIONS}
              />
            );
          }
          if (h === 'Stage') {
            return (
              <SelectCell
                value={row[h]}
                onChange={(v) => updateOppField(row._id, h, v)}
                options={STAGE_OPTIONS}
              />
            );
          }
          if (h === 'Contact') {
            return (
              <ContactCell
                value={row[h]}
                onChange={(v) => updateOppField(row._id, h, v)}
                account={row['Account']}
                prospects={prospects}
                updateProspect={updateProspect}
              />
            );
          }
          return (
            <EditableCell
              value={row[h]}
              onChange={(v) => updateOppField(row._id, h, v)}
              suggestions={h === 'Account' ? companySuggestions : undefined}
            />
          );
        },
      }));
  }, [headers, updateOppField, companySuggestions, prospects, updateProspect]);

  const stageOrder = ['Lead', 'Not Started', 'Qualifying', 'Quoting', 'Quoted', 'Verbal', 'Sold', 'Not Sold'];
  const CLOSED_STAGES = useMemo(() => new Set(['Sold', 'Not Sold']), []);

  const statusOptions = useMemo(() => {
    const set = new Set();
    for (const r of records) {
      const v = (r['Status'] || '').trim();
      if (v && v !== '-' && v !== '#N/A') set.add(v);
    }
    return Array.from(set).sort();
  }, [records]);

  const prefiltered = useMemo(() => {
    const fromTs = dateFrom ? Date.parse(dateFrom) : null;
    const toTs = dateTo ? Date.parse(dateTo) + 86399999 : null;
    return records.filter(r => {
      if (fromTs != null || toTs != null) {
        const raw = r['Start Date'];
        const ts = raw ? Date.parse(raw) : NaN;
        if (isNaN(ts)) return false;
        if (fromTs != null && ts < fromTs) return false;
        if (toTs != null && ts > toTs) return false;
      }
      if (statusFilter !== 'all' && (r['Status'] || '').trim() !== statusFilter) return false;
      const stage = (r['Stage'] || '').trim();
      if (activityFilter === 'active' && CLOSED_STAGES.has(stage)) return false;
      if (activityFilter === 'closed' && !CLOSED_STAGES.has(stage)) return false;
      return true;
    });
  }, [records, dateFrom, dateTo, statusFilter, activityFilter, CLOSED_STAGES]);

  const filtered = useMemo(() => {
    if (!search.trim()) return prefiltered;
    const term = search.toLowerCase();
    return prefiltered.filter(r =>
      Object.values(r).some(v => v && String(v).toLowerCase().includes(term))
    );
  }, [prefiltered, search]);

  const stageCounts = useMemo(() => {
    const counts = {};
    for (const r of prefiltered) {
      const stage = r['Stage'] || 'Unknown';
      counts[stage] = (counts[stage] || 0) + 1;
    }
    return counts;
  }, [prefiltered]);

  const serviceBreakdown = useMemo(() => {
    const stats = {};
    const totalOpps = prefiltered.length;
    for (const r of prefiltered) {
      const raw = (r['Scope'] || '').trim();
      const cleaned = raw && raw !== '-' && raw !== '#N/A' ? raw : '';
      const services = cleaned
        ? cleaned.split(',').map(s => s.trim()).filter(Boolean)
        : ['(Unspecified)'];
      const stage = (r['Stage'] || '').trim();
      const isWin = stage === 'Sold';
      const isLoss = stage === 'Not Sold';
      const seen = new Set();
      for (const s of services) {
        if (seen.has(s)) continue;
        seen.add(s);
        if (!stats[s]) stats[s] = { total: 0, wins: 0, losses: 0 };
        stats[s].total += 1;
        if (isWin) stats[s].wins += 1;
        else if (isLoss) stats[s].losses += 1;
      }
    }
    const rows = Object.entries(stats)
      .map(([scope, s]) => {
        const decided = s.wins + s.losses;
        return {
          scope,
          count: s.total,
          wins: s.wins,
          winRate: decided > 0 ? (s.wins / decided) * 100 : null,
          percent: totalOpps > 0 ? (s.total / totalOpps) * 100 : 0,
        };
      })
      .sort((a, b) => b.count - a.count);
    return { rows, total: totalOpps };
  }, [prefiltered]);

  const filtersActive = !!(dateFrom || dateTo || statusFilter !== 'all' || activityFilter !== 'all');
  const clearFilters = () => {
    setDateFrom(''); setDateTo(''); setStatusFilter('all'); setActivityFilter('all');
  };

  const servicesColumns = useMemo(() => [
    { key: 'scope', label: 'Service (Scope)', defaultWidth: 260 },
    {
      key: 'wins',
      label: 'Wins',
      defaultWidth: 90,
      render: (row) => <div style={{ textAlign: 'right' }}>{row.wins}</div>,
    },
    {
      key: 'winRate',
      label: 'Win Rate',
      defaultWidth: 110,
      render: (row) => (
        <div style={{ textAlign: 'right' }}>
          {row.winRate == null ? '—' : `${row.winRate.toFixed(1)}%`}
        </div>
      ),
    },
    {
      key: 'percent',
      label: '% of Total',
      defaultWidth: 220,
      render: (row) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ minWidth: '48px', textAlign: 'right' }}>{row.percent.toFixed(1)}%</span>
          <div className={styles.serviceBar} style={{ flex: 1 }}>
            <div className={styles.serviceBarFill} style={{ width: `${row.percent}%` }} />
          </div>
        </div>
      ),
    },
    {
      key: 'count',
      label: 'Total Opps',
      defaultWidth: 110,
      render: (row) => (
        <div style={{ textAlign: 'right', fontWeight: 600 }}>{row.count}</div>
      ),
    },
    {
      key: '_actions',
      label: '',
      defaultWidth: 90,
      render: (row) => (
        <button
          className={styles.hideServiceBtn}
          onClick={(e) => { e.stopPropagation(); toggleHideService(row.scope); }}
          title={row._hidden ? 'Unhide service' : 'Hide service'}
        >
          {row._hidden ? 'Unhide' : 'Hide'}
        </button>
      ),
    },
  ], [toggleHideService]);

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <div>
          <h2 className={styles.title}>Opps 2</h2>
          <span className={styles.lastSync}>Sandbox copy — not connected to any data source</span>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <AddCompanyCombobox
            suggestions={companySuggestions}
            onCommit={(name) => addNewOpp(name)}
          />
          <button className={styles.syncBtn} onClick={() => addNewOpp()}>+ New Opp</button>
        </div>
      </div>

      {error && <div className={styles.error}>{error}</div>}

      <div className={styles.tabs}>
        <button
          className={activeTab === 'opps' ? styles.tabActive : styles.tab}
          onClick={() => setActiveTab('opps')}
        >Opportunities</button>
        <button
          className={activeTab === 'services' ? styles.tabActive : styles.tab}
          onClick={() => setActiveTab('services')}
        >By Service</button>
      </div>

      <div className={styles.filterRow}>
        <label className={styles.filterLabel}>
          Start Date from
          <input
            type="date"
            className={styles.filterInput}
            value={dateFrom}
            onChange={e => setDateFrom(e.target.value)}
          />
        </label>
        <label className={styles.filterLabel}>
          to
          <input
            type="date"
            className={styles.filterInput}
            value={dateTo}
            onChange={e => setDateTo(e.target.value)}
          />
        </label>
        <label className={styles.filterLabel}>
          Status
          <select
            className={styles.filterInput}
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
          >
            <option value="all">All</option>
            {statusOptions.map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </label>
        <label className={styles.filterLabel}>
          Show
          <select
            className={styles.filterInput}
            value={activityFilter}
            onChange={e => setActivityFilter(e.target.value)}
          >
            <option value="active">Active only</option>
            <option value="closed">Closed only</option>
            <option value="all">All</option>
          </select>
        </label>
        {filtersActive && (
          <button className={styles.clearFiltersBtn} onClick={clearFilters}>Clear filters</button>
        )}
      </div>

      {activeTab === 'opps' ? (
        <>
          <div className={styles.summary}>
            {stageOrder.filter(s => stageCounts[s]).map(stage => (
              <div key={stage} className={styles.summaryChip}>
                <span className={styles.summaryChipValue}>{stageCounts[stage]}</span>
                <span className={styles.summaryChipLabel}>{stage}</span>
              </div>
            ))}
            {Object.keys(stageCounts).filter(s => !stageOrder.includes(s) && s !== 'Unknown').map(stage => (
              <div key={stage} className={styles.summaryChip}>
                <span className={styles.summaryChipValue}>{stageCounts[stage]}</span>
                <span className={styles.summaryChipLabel}>{stage}</span>
              </div>
            ))}
          </div>

          <div className={styles.searchRow}>
            <input
              className={styles.searchInput}
              type="text"
              placeholder="Search opps..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            <span className={styles.resultCount}>{filtered.length} of {prefiltered.length}{filtersActive && prefiltered.length !== records.length ? ` (filtered from ${records.length})` : ''}</span>
          </div>

          {loading && !data ? (
            <div className={styles.loading}>Loading...</div>
          ) : (
            <DataTable
              tableId="opps2"
              columns={columns}
              rows={filtered}
              alwaysVisible={['Account']}
              enableColumnFilters
              emptyMessage="No opps yet — click + New Opp to create one."
              settings={settings}
              updateSettings={updateSettings}
            />
          )}
        </>
      ) : (
        <>
          <div className={styles.searchRow}>
            <span className={styles.resultCount}>
              {(() => {
                const visibleCount = serviceBreakdown.rows.filter(r => showHidden || !hiddenServices.has(r.scope)).length;
                return `${visibleCount} service${visibleCount === 1 ? '' : 's'} · ${serviceBreakdown.total} total opps`;
              })()}
            </span>
            {hiddenServices.size > 0 && (
              <label className={styles.showHiddenLabel}>
                <input
                  type="checkbox"
                  checked={showHidden}
                  onChange={e => setShowHidden(e.target.checked)}
                />
                Show {hiddenServices.size} hidden
              </label>
            )}
          </div>
          <DataTable
            tableId="opps2-services"
            columns={servicesColumns}
            rows={serviceBreakdown.rows
              .filter(r => showHidden || !hiddenServices.has(r.scope))
              .map(r => ({ ...r, id: r.scope, _hidden: hiddenServices.has(r.scope) }))}
            alwaysVisible={['scope']}
            rowStyle={(row) => row._hidden ? { opacity: 0.5 } : undefined}
            emptyMessage="No services to display."
            settings={settings}
            updateSettings={updateSettings}
          />
        </>
      )}
    </div>
  );
}
