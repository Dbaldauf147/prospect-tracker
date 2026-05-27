import { useState, useEffect, useLayoutEffect, useMemo, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { doc, getDoc, collection, getDocs, writeBatch, deleteField } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import { ContactEditModal } from '../ProspectModal/ProspectModal';
import { DataTable } from '../common/DataTable';
import {
  buildListRegistry,
  buildAvailableLists,
  parseMulti,
  resolveColumnLink as resolveSharedColumnLink,
  SelectCell,
  MultiSelectCell,
  LinkColumnsModal,
} from '../common/columnLinks';
import { getEffectiveDropdownLists } from '../../utils/dropdownListsStore';
import { dbGet, dbPut } from '../../utils/db';
import { loadOptionLinks, setOppOptionLink, OPTION_LINKS_EVENT } from '../../utils/pricingOptionLinks';
import { OPPS_PRICING_SNAPSHOT_EVENT } from '../../utils/oppsPricingSnapshot';
import { fmtMoneyWhole } from '../../utils/pricingOptionCalc';
import { getHubspotContacts } from '../../utils/hubspotContactsCache';
import { normalizeCompany } from '../../utils/companyNorm';
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

// Stamp every save with a wall-clock timestamp so hydration can pick
// the strictly newer source between IDB and Firestore. Without this,
// a stale Firestore doc (e.g. when a debounced save was cancelled by
// an unmount, the doc grew past the 1 MB Firestore limit and the
// write failed silently, or the network was offline) would clobber a
// fresh local IDB cache.
function stampUpdatedAt(data) {
  return { ...(data || {}), _updatedAt: Date.now() };
}

async function saveOpps2Cache(data) {
  try { await dbPut(OPPS2_STORE, stampUpdatedAt(data), OPPS2_CACHE_KEY); }
  catch (err) { console.error('opps2: IndexedDB save failed', err); }
}

// Firestore caps a single document at ~1 MB. Once Opps 2 grows past
// that, the legacy single-field save fails silently and cross-device
// sync stalls. The JSON is now split across a `chunks` subcollection
// under the user's doc; the parent doc holds metadata and the
// legacy `json` field is cleared on the first chunked write so it
// can't shadow the fresh data. Each chunk stays well below the cap.
const OPPS2_CHUNK_SIZE = 700 * 1024;

async function loadOpps2FromFirestore(userId) {
  try {
    const ref = doc(db, OPPS2_FIRESTORE_COLLECTION, userId);
    const snap = await getDoc(ref);
    if (!snap.exists()) return null;
    const raw = snap.data() || {};
    let json = null;
    if (Number.isFinite(raw.chunkCount) && raw.chunkCount > 0) {
      const parts = new Array(raw.chunkCount).fill('');
      const chunksSnap = await getDocs(collection(ref, 'chunks'));
      chunksSnap.forEach((d) => {
        const idx = Number(d.id);
        if (Number.isFinite(idx) && idx >= 0 && idx < parts.length) {
          parts[idx] = String(d.data()?.json || '');
        }
      });
      json = parts.join('');
    } else if (raw.json) {
      json = raw.json;
    }
    if (!json) return null;
    const parsed = JSON.parse(json);
    // Lift the doc's stored updatedAt onto the payload so the
    // hydration timestamp compare works even when the json blob
    // predates the _updatedAt stamp inside it.
    if (parsed && parsed._updatedAt == null && raw.updatedAt) {
      const t = Date.parse(raw.updatedAt);
      if (Number.isFinite(t)) parsed._updatedAt = t;
    }
    return parsed;
  } catch (err) { console.error('opps2: Firestore load failed', err); }
  return null;
}

// Throws when the save fails so callers (e.g. the Import button) can
// surface the failure instead of silently leaving stale data behind.
async function saveOpps2ToFirestore(userId, data) {
  const stamped = stampUpdatedAt(data);
  const json = JSON.stringify(stamped);
  // Refuse to push a payload the next device can't read back. A
  // stringify result that fails its own parse would land in Firestore
  // and then make every other laptop think the cloud is empty -- their
  // load returns null, their IDB wins hydration, and the good cloud
  // copy gets stomped.
  try { JSON.parse(json); }
  catch (err) { throw new Error(`opps2: refusing to save unparseable JSON (${err.message})`); }
  const ref = doc(db, OPPS2_FIRESTORE_COLLECTION, userId);
  const updatedAt = new Date(stamped._updatedAt).toISOString();
  const chunks = [];
  for (let i = 0; i < json.length; i += OPPS2_CHUNK_SIZE) {
    chunks.push(json.slice(i, i + OPPS2_CHUNK_SIZE));
  }
  // Drop any leftover chunks from a previous (larger) save so a
  // shrinking dataset doesn't reassemble with stale tail data.
  const existing = await getDocs(collection(ref, 'chunks'));
  const batch = writeBatch(db);
  // merge: true is required so deleteField() takes effect -- in a
  // plain set() the Firestore SDK throws and the whole batch aborts,
  // and trySaveOpps2ToFirestore's catch silently swallows the failure
  // (which is how every chunked save was a no-op).
  batch.set(ref, { chunkCount: chunks.length, updatedAt, json: deleteField() }, { merge: true });
  for (let i = 0; i < chunks.length; i++) {
    batch.set(doc(ref, 'chunks', String(i)), { json: chunks[i] });
  }
  existing.forEach((d) => {
    const idx = Number(d.id);
    if (!Number.isFinite(idx) || idx >= chunks.length) batch.delete(d.ref);
  });
  await batch.commit();
}

// Non-throwing wrapper for the auto-save / unmount / beforeunload
// callers that don't have a UI surface for failures — they just want
// best-effort durability and a console error on failure.
async function trySaveOpps2ToFirestore(userId, data) {
  try { await saveOpps2ToFirestore(userId, data); }
  catch (err) { console.error('opps2: Firestore save failed', err); }
}

// Default column set, seeded so the table has columns to show / sort /
// filter / hide / resize even before any data exists.
const DEFAULT_HEADERS = [
  'Account', 'Open Year', 'Contact', 'Stage', 'Scope', 'Source', 'Type',
  'Start Date', 'Status', 'Quoted Amount', 'Sites', 'Age',
  'Last Client Heard From Us', 'Last Spoke', 'Follow Up', 'Call In', 'Notes',
  'Next Steps', 'No Further Action Today', 'Competition', 'Waiting On', 'Close Date', 'BFO Link',
  'Pricing Option',
];

// Key columns to show by default (the rest are available via Columns toggle)
const KEY_COLS = [
  'Account', 'Contact', 'Stage', 'Scope', 'Source', 'Type',
  'Start Date', 'Status', 'Quoted Amount', 'Sites', 'Age',
  'Last Client Heard From Us', 'Last Spoke', 'Follow Up', 'Call In', 'Notes',
  'Next Steps', 'No Further Action Today', 'Competition', 'Waiting On', 'Close Date',
];

// Three-state-checkbox columns. Each cell click cycles
// blank → "Yes" (renders ✓) → "No" (renders ✗) → blank. Stored as
// the literal string so existing string-based filters / exports /
// downstream consumers still work without special handling.
const TRISTATE_COLUMNS = new Set(['No Further Action Today']);

// Columns the user wants treated as dates — rendered with a calendar
// popup cell (HTML5 date input) and pre-populated with today on new
// opps so a fresh entry shows useful defaults instead of blanks.
const DATE_COLUMNS = new Set(['Start Date', 'Last Client Heard From Us', 'Follow Up']);

// Stages the Days-in-Stage tab reports on. Ordered to mirror the
// pipeline progression so a row stays under one bucket as it moves
// forward. Closed stages (Sold / Not Sold) are intentionally excluded
// — the tab tracks how long active opps are stalling in each step.
const TRACKED_STAGES = ['Not Started', 'Lead', 'Qualifying', 'Quoting', 'Quoted', 'Contracting', 'Agreement Sent'];
const TRACKED_STAGES_SET = new Set(TRACKED_STAGES);

// Read-only columns whose value is derived from other cells.
//   Call In    = calendar days from today to the Follow Up date
//   Last Spoke = business days from Last Client Heard From Us to today
// Always append these to header sets loaded from the legacy Opps cache
// so they show up even when the cached headers predate the columns.
const COMPUTED_COLUMNS = ['Last Spoke', 'Call In'];

// Columns that should always be present on hydration even when the
// saved header set predates them. Includes the computed columns
// plus Next Steps (introduced after the original layout shipped) so
// users who saved their layout before this column existed still pick
// it up — and its "Find out the Story" default lands somewhere
// visible on the next new opp.
const ENSURED_COLUMNS = [...COMPUTED_COLUMNS, 'Next Steps', 'Pricing Option', 'No Further Action Today'];

function todayISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function makeBlankOpp(id, headers, accountOverride, sourceOverride) {
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
  // Default Scope to AEM (the most common service the user tags on a
  // new opp) and seed the Next Steps column with the prompt the user
  // always types first. Set unconditionally — even if a column was
  // hidden via the columns toggle the value sticks around for when
  // it's unhidden later.
  row['Scope'] = 'AEM';
  row['Next Steps'] = 'Find out the Story';
  // Source comes from the New Opp prompt — leave blank when the user
  // skipped the picker so the cell still surfaces its dropdown on
  // click.
  if (typeof sourceOverride === 'string' && sourceOverride.trim()) {
    row['Source'] = sourceOverride.trim();
  }
  // Default the three date columns the user tracks day-to-day to
  // today's date. Stored as ISO (YYYY-MM-DD) so the HTML5 date input
  // accepts it directly; DateCell displays a localized format.
  const today = todayISO();
  for (const dateCol of DATE_COLUMNS) {
    if (cols.includes(dateCol)) row[dateCol] = today;
  }
  // Seed Call In with an explicit 0 so a brand-new opp shows up
  // in every Call-In-gated view (Days in Stage, Stage History) from
  // the moment it's created. The first time the user picks a Follow
  // Up date, updateOppField drops this stored value so the live
  // compute (days from today to Follow Up) takes over — i.e. the
  // 0 is a starting point, not a manual override that sticks around.
  if (cols.includes('Call In')) row['Call In'] = 0;
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
  // The native <input type="date"> is permanently mounted but visually
  // hidden and not directly interactable (pointer-events: none, tab
  // disabled). The only way to change the value is via the calendar
  // popup, which we open programmatically from the visible span's
  // click. This blocks every "edit the date itself" affordance the
  // browser exposes on a focused date input — segment typing, arrow-
  // key increments, and spin buttons — so the user can only pick a
  // calendar day.
  const inputRef = useRef(null);
  const iso = toISODate(value);
  const isEmpty = !value;
  return (
    <span
      onClick={(e) => {
        e.stopPropagation();
        const el = inputRef.current;
        if (!el) return;
        try { el.showPicker?.(); } catch { /* older browser — no-op */ }
      }}
      style={{
        position: 'relative',
        display: 'block', cursor: 'pointer', minHeight: '1em',
        padding: '1px 2px',
        color: isEmpty ? 'var(--color-text-muted)' : 'inherit',
      }}
      title="Click to pick a date"
    >
      {isEmpty ? '—' : formatDateDisplay(value)}
      <input
        ref={inputRef}
        type="date"
        value={iso}
        onChange={(e) => onChange(e.target.value)}
        onClick={(e) => e.stopPropagation()}
        tabIndex={-1}
        aria-hidden="true"
        style={{
          position: 'absolute', left: 0, top: 0,
          width: '100%', height: '100%',
          opacity: 0, pointerEvents: 'none',
          border: 0, padding: 0, margin: 0, background: 'transparent',
        }}
      />
    </span>
  );
}

// Break a free-text Next Steps cell into bullet items. Splits on
// newlines, strips any leading marker the user typed (- * • 1. etc.),
// and drops empty lines so the popup / hover render cleanly even when
// the source was loose prose.
function textToBulletItems(text) {
  return String(text ?? '')
    .split(/\r?\n+/)
    .map(line => line.replace(/^\s*(?:[-*•·▪►]|\d+[.)])\s*/, '').trim())
    .filter(Boolean);
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

// Values the Opps Google sheet uses to mean "no data" in cells where
// the cell otherwise carries a number — treat them as blank rather
// than as a parseable string.
const BLANK_SENTINELS = new Set(['', '-', '#N/A', '#n/a', 'N/A', 'n/a']);

// Resolve the displayed value of a row's computed column. When the
// sheet shipped a literal value for that column (imported rows carry
// the Google Sheet's own formula output) we honor it — including
// blank sentinels, so a row the sheet decided to hide stays hidden in
// Opps 2. Hand-typed rows have no stored cell and fall through to a
// live compute from the source date. Returns null for "show blank",
// or a finite number for "show this".
function resolveComputedDays(row, storedKey, sourceField, compute) {
  if (row && storedKey in row) {
    const raw = row[storedKey];
    const s = raw == null ? '' : String(raw).trim();
    if (BLANK_SENTINELS.has(s)) return null;
  }
  // Always prefer a live compute from the source date so the cell
  // reflects today, not the stale snapshot the sheet shipped on
  // import. Falls back to the stored number only when the source
  // field is missing/unparseable (imported rows that arrived without
  // a date).
  const live = compute(row?.[sourceField]);
  if (live != null) return live;
  if (row && storedKey in row) {
    const raw = row[storedKey];
    const s = raw == null ? '' : String(raw).trim();
    const n = parseFloat(s.replace(/[,$%]/g, ''));
    if (Number.isFinite(n)) return n;
  }
  return null;
}
const resolveCallIn = (row) => resolveComputedDays(row, 'Call In', 'Follow Up', daysFromToday);
const resolveLastSpoke = (row) => resolveComputedDays(row, 'Last Spoke', 'Last Client Heard From Us', businessDaysSince);

// One-shot Call-In ascending sort used during initial hydration. Rows
// without a resolvable Call In sink to the bottom. A stable tiebreaker
// (original index) keeps the order deterministic when many rows share
// the same Call In value. Continuous re-sorting during editing would
// yank rows out from under the cursor — that's why this runs only on
// load and not in any update path.
function sortRecordsByCallInAsc(records) {
  if (!Array.isArray(records)) return records;
  const tagged = records.map((r, i) => {
    const n = resolveCallIn(r);
    const key = typeof n === 'number' && Number.isFinite(n) ? n : Number.POSITIVE_INFINITY;
    return { r, i, key };
  });
  tagged.sort((a, b) => (a.key - b.key) || (a.i - b.i));
  return tagged.map(x => x.r);
}

// Three-state checkbox cell. Click cycles blank → ✓ ("Yes") → ✗ ("No")
// → blank. The stored value is the string "Yes" / "No" / "" so it
// round-trips through the same JSON persistence path as every other
// Opps 2 cell — and falls through to the existing search / filter
// machinery unchanged.
function TristateCheckCell({ value, onChange, title }) {
  const cur = String(value || '').trim().toLowerCase();
  const state = cur === 'yes' || cur === 'true' || cur === '✓' ? 'yes'
    : cur === 'no' || cur === 'false' || cur === '✗' ? 'no'
    : 'blank';
  const next = { blank: 'Yes', yes: 'No', no: '' };
  const cycle = (e) => {
    e.stopPropagation();
    onChange?.(next[state]);
  };
  const glyph = state === 'yes' ? '✓' : state === 'no' ? '✗' : '';
  const fg = state === 'yes' ? '#15803D' : state === 'no' ? '#B91C1C' : 'var(--color-text-muted)';
  const bg = state === 'yes' ? '#DCFCE7' : state === 'no' ? '#FEE2E2' : '#fff';
  return (
    <span
      role="checkbox"
      aria-checked={state === 'yes' ? 'true' : state === 'no' ? 'false' : 'mixed'}
      tabIndex={0}
      onClick={cycle}
      onKeyDown={(e) => {
        if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); cycle(e); }
      }}
      title={title || 'Click to cycle: blank → ✓ → ✗ → blank'}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 20, height: 20, lineHeight: 1,
        border: '1px solid var(--color-border)', borderRadius: 3,
        background: bg, color: fg, cursor: 'pointer',
        fontWeight: 700, fontSize: '0.95em', userSelect: 'none',
      }}
    >{glyph}</span>
  );
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

// Call In cell with a manual override. Clicking a populated cell
// stores a blank sentinel under 'Call In' so the row reads empty even
// though Follow Up still has a date; clicking the "+ add" affordance
// on a cleared cell deletes that override so the live compute takes
// over again. Falls through to the read-only ComputedCell when there's
// nothing to toggle (no Follow Up, no stored override).
function CallInCell({ row, onClear, onRestore }) {
  const storedKey = 'Call In';
  const hasStored = row && storedKey in row;
  const rawStored = hasStored ? row[storedKey] : undefined;
  const storedStr = rawStored == null ? '' : String(rawStored).trim();
  const isCleared = hasStored && BLANK_SENTINELS.has(storedStr);
  const live = daysFromToday(row?.['Follow Up']);
  const n = resolveCallIn(row);

  if (isCleared && live != null) {
    return (
      <span
        onClick={(e) => { e.stopPropagation(); onRestore(); }}
        title={`Restore Call In (${live})`}
        style={{
          display: 'block', cursor: 'pointer',
          color: 'var(--color-text-muted)', fontStyle: 'italic',
          textAlign: 'center', padding: '1px 2px',
        }}
      >+ add</span>
    );
  }

  if (n != null) {
    return (
      <span
        onClick={(e) => {
          e.stopPropagation();
          // Click-to-clear is destructive (it stamps the cell with the
          // BLANK sentinel and you have to find the "+ add" affordance
          // to undo it), and it's easy to brush this cell while
          // scanning the column. Guard with a confirm so a stray click
          // doesn't wipe the value.
          const label = String(row?.['Account'] || '').trim() || 'this row';
          if (window.confirm(`Remove the Call In value for ${label}?`)) {
            onClear();
          }
        }}
        title="Click to clear Call In"
        style={{ display: 'block', cursor: 'pointer' }}
      >
        <ComputedCell value={n} />
      </span>
    );
  }

  return <ComputedCell value="" />;
}

// Renders a frozen Pricing → Options snapshot saved onto the opp.
// Self-contained: doesn't read from Pricing's IndexedDB cache, so it
// keeps working even after the Pricing tab has been cleared.
function PricingOptionSnapshotView({ snapshot }) {
  if (!snapshot) return null;
  const rows = Array.isArray(snapshot.rows) ? snapshot.rows : [];
  const yearTotals = Array.isArray(snapshot.yearTotals) ? snapshot.yearTotals : [];
  const termValues = Array.isArray(snapshot.termValues) ? snapshot.termValues : [];
  const year1Monthly = Array.isArray(snapshot.year1Monthly) ? snapshot.year1Monthly : [];
  const termYears = Math.max(1, Number(snapshot.years) || 1);
  return (
    <div style={{
      border: '1px solid var(--color-border)', borderRadius: 6,
      background: '#fafbfc', padding: '0.65rem 0.75rem',
    }}>
      <div style={{
        display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
        gap: '0.5rem', marginBottom: '0.5rem',
      }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: '0.92rem' }}>{snapshot.name || '(unnamed)'}</div>
          <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)' }}>
            {termYears}-year term · {snapshot.escPct || 0}% escalator
            {snapshot.savedAt ? ` · saved ${new Date(snapshot.savedAt).toLocaleDateString()}` : ''}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Year 1</div>
          <div style={{ fontWeight: 700, fontSize: '1rem' }}>{fmtMoneyWhole(snapshot.year1Total || 0)}</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem', marginBottom: '0.6rem' }}>
        <div>
          <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 2 }}>Year breakdown</div>
          <table style={{ width: '100%', fontSize: '0.78rem', borderCollapse: 'collapse' }}>
            <tbody>
              {Array.from({ length: termYears }, (_, i) => (
                <tr key={`y-${i}`}>
                  <td style={{ padding: '2px 4px', color: 'var(--color-text-muted)' }}>Year {i + 1}</td>
                  <td style={{ padding: '2px 4px', textAlign: 'right' }}>{fmtMoneyWhole(yearTotals[i] || 0)}</td>
                </tr>
              ))}
              <tr style={{ borderTop: '1px solid var(--color-border)' }}>
                <td style={{ padding: '2px 4px', fontWeight: 600 }}>Total Contract Value</td>
                <td style={{ padding: '2px 4px', textAlign: 'right', fontWeight: 600 }}>{fmtMoneyWhole(termValues[termYears - 1] || 0)}</td>
              </tr>
              {snapshot.setupTotal ? (
                <tr>
                  <td style={{ padding: '2px 4px', color: 'var(--color-text-muted)' }}>Setup</td>
                  <td style={{ padding: '2px 4px', textAlign: 'right' }}>{fmtMoneyWhole(snapshot.setupTotal)}</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <div>
          <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 2 }}>Year 1 monthly</div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ fontSize: '0.72rem', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {year1Monthly.map((_, i) => (
                    <th key={`mh-${i}`} style={{ padding: '2px 4px', color: 'var(--color-text-muted)', fontWeight: 500 }}>M{i + 1}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  {year1Monthly.map((v, i) => (
                    <td key={`mv-${i}`} style={{ padding: '2px 4px', textAlign: 'right' }}>{fmtMoneyWhole(v)}</td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div>
        <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 2 }}>
          Fee schedule ({rows.filter(r => r.fee || r.feeSchedule).length} rows)
        </div>
        <div style={{ maxHeight: 220, overflowY: 'auto', border: '1px solid var(--color-border-light)', borderRadius: 4 }}>
          <table style={{ width: '100%', fontSize: '0.74rem', borderCollapse: 'collapse' }}>
            <thead style={{ position: 'sticky', top: 0, background: '#f1f5f9' }}>
              <tr>
                <th style={{ padding: '4px 6px', textAlign: 'left', fontWeight: 600 }}>Fee Schedule</th>
                <th style={{ padding: '4px 6px', textAlign: 'left', fontWeight: 600 }}>Type</th>
                <th style={{ padding: '4px 6px', textAlign: 'right', fontWeight: 600 }}>Fee</th>
                <th style={{ padding: '4px 6px', textAlign: 'left', fontWeight: 600 }}>Unit</th>
                <th style={{ padding: '4px 6px', textAlign: 'right', fontWeight: 600 }}>Est. Count</th>
                <th style={{ padding: '4px 6px', textAlign: 'right', fontWeight: 600 }}>Start Month</th>
              </tr>
            </thead>
            <tbody>
              {rows.filter(r => r.fee || r.feeSchedule || r.type).map((r, idx) => (
                <tr key={idx} style={{ borderTop: '1px solid var(--color-border-light)' }}>
                  <td style={{ padding: '3px 6px' }}>{r.feeSchedule || '—'}</td>
                  <td style={{ padding: '3px 6px' }}>{r.type || '—'}</td>
                  <td style={{ padding: '3px 6px', textAlign: 'right' }}>{r.fee || '—'}</td>
                  <td style={{ padding: '3px 6px' }}>{r.unit || '—'}</td>
                  <td style={{ padding: '3px 6px', textAlign: 'right' }}>{r.unitCount || '—'}</td>
                  <td style={{ padding: '3px 6px', textAlign: 'right' }}>{r.startMonth || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// Quoted Amount cell. Behaves like a plain editable cell unless the
// opp has a Pricing-Option snapshot attached — then the value is
// rendered as a hyperlink that calls `onViewSnapshot` (which the
// parent wires to the Opp details popup), with a small ✎ icon to
// switch to inline edit mode so the user can write over the value.
function QuotedAmountCell({ value, onChange, snapshot, onViewSnapshot }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? '');
  useEffect(() => { if (!editing) setDraft(value ?? ''); }, [value, editing]);

  const commit = () => {
    setEditing(false);
    if (draft !== (value ?? '')) onChange?.(draft);
  };
  const cancel = () => { setDraft(value ?? ''); setEditing(false); };

  if (editing) {
    return (
      <input
        type="text"
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); commit(); }
          else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
        }}
        style={{
          width: '100%', border: '1px solid var(--color-border)',
          borderRadius: 3, padding: '1px 4px', font: 'inherit',
          background: '#fff',
        }}
      />
    );
  }
  if (!snapshot) {
    return (
      <span
        onClick={(e) => { e.stopPropagation(); setEditing(true); }}
        style={{
          display: 'block', cursor: 'text', minHeight: '1em', padding: '1px 2px',
          color: value ? 'inherit' : 'var(--color-text-muted)',
        }}
        title="Click to edit"
      >{value || '—'}</span>
    );
  }
  // Snapshot attached: value is a hyperlink to the Opp's Pricing
  // Option detail (rendered inside the Opp details popup), with a
  // pencil affordance to switch to inline edit.
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '1px 2px' }}>
      <a
        href="#"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); onViewSnapshot?.(); }}
        title={`Year 1 from Pricing Option: ${snapshot.name || '(unnamed)'} — click to view the saved snapshot`}
        style={{
          color: '#2563eb', textDecoration: 'underline', cursor: 'pointer',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          flex: 1,
        }}
      >{value || fmtMoneyWhole(snapshot.year1Total || 0) || '—'}</a>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setEditing(true); }}
        title="Write over the Quoted Amount"
        style={{
          border: 'none', background: 'transparent', cursor: 'pointer',
          color: '#94a3b8', padding: '0 2px', fontSize: '0.85em', lineHeight: 1,
        }}
      >✎</button>
    </span>
  );
}

// Read-only "Pricing Option" cell: shows the option name linked to this
// opp from the Pricing → Options tab. The user can't type into it — the
// link is set from Pricing → Options ("Save to Opp…") and cleared with
// the × that appears here when a value is present.
function PricingOptionCell({ value, onClear }) {
  const isEmpty = !value;
  return (
    <span
      style={{
        display: 'flex', alignItems: 'center', gap: 4,
        padding: '1px 2px',
        color: isEmpty ? 'var(--color-text-muted)' : 'inherit',
      }}
      title={isEmpty
        ? 'Set from the Pricing → Options tab: open an Option, then click “Save to Opp…”.'
        : `Linked Pricing Option: ${value}`}
    >
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {isEmpty ? '—' : value}
      </span>
      {!isEmpty && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onClear?.(); }}
          title="Clear pricing-option link"
          style={{
            border: 'none', background: 'transparent', cursor: 'pointer',
            color: '#94a3b8', padding: '0 2px', fontSize: '0.85em', lineHeight: 1,
          }}
        >×</button>
      )}
    </span>
  );
}

// Opt-in hover popover for long-text cells (Next Steps). Mirrors the
// text in a portal-positioned dark box anchored to the cell so the
// content isn't clipped by the column width or by the table's
// horizontal scroll container. Only shows when the value would
// otherwise be cut off — a newline that gets squashed by the cell's
// single-line render, or text wider than the column.
function CellHoverPopover({ anchorRef, value, enabled }) {
  const [pos, setPos] = useState(null);
  const timerRef = useRef(null);

  useEffect(() => {
    const el = anchorRef.current;
    if (!el || !enabled) return undefined;
    function onEnter() {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        const node = anchorRef.current;
        if (!node) return;
        const text = String(value ?? '');
        if (!text) return;
        const hasNewline = text.includes('\n');
        const hasOverflow = node.scrollWidth > node.clientWidth + 1;
        if (!hasNewline && !hasOverflow) return;
        const rect = node.getBoundingClientRect();
        const vh = window.innerHeight;
        const flipAbove = rect.bottom + 220 > vh && rect.top > 220;
        setPos({
          top: flipAbove ? rect.top - 4 : rect.bottom + 4,
          left: Math.min(rect.left, window.innerWidth - 500),
          flipAbove,
        });
      }, 250);
    }
    function onLeave() {
      if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
      setPos(null);
    }
    el.addEventListener('mouseenter', onEnter);
    el.addEventListener('mouseleave', onLeave);
    return () => {
      el.removeEventListener('mouseenter', onEnter);
      el.removeEventListener('mouseleave', onLeave);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [anchorRef, value, enabled]);

  if (!pos || !enabled) return null;
  const items = textToBulletItems(value);
  return createPortal(
    <div
      style={{
        position: 'fixed', top: pos.top, left: pos.left,
        transform: pos.flipAbove ? 'translateY(-100%)' : 'none',
        background: '#1e293b', color: '#f8fafc',
        padding: '6px 10px', borderRadius: 4, fontSize: '0.78rem',
        maxWidth: 480, maxHeight: 320, overflow: 'auto',
        wordBreak: 'break-word', lineHeight: 1.4,
        boxShadow: '0 8px 22px rgba(15, 23, 42, 0.28)',
        zIndex: 10000, pointerEvents: 'none',
      }}
    >
      {items.length > 0 ? (
        <ul style={{ margin: 0, paddingLeft: '1.1rem' }}>
          {items.map((it, i) => <li key={i} style={{ margin: '2px 0' }}>{it}</li>)}
        </ul>
      ) : (
        <span style={{ whiteSpace: 'pre-wrap' }}>{String(value ?? '')}</span>
      )}
    </div>,
    document.body,
  );
}

// Next Steps cell — single click opens the bullet-list popup. Inline
// editing isn't useful for this column because the editor in the popup
// is purpose-built for it (per-step Waiting On, bullet reorder, etc.).
// Hover still surfaces the full text via the shared popover so a quick
// glance doesn't require opening the modal.
function NextStepsCell({ value, onOpen }) {
  const ref = useRef(null);
  const isEmpty = value === '' || value == null;
  const text = isEmpty ? '—' : String(value);
  return (
    <>
      <span
        ref={ref}
        onClick={(e) => { e.stopPropagation(); onOpen(); }}
        title="Click to edit in Next Steps"
        style={{
          display: 'block', cursor: 'pointer', minHeight: '1em',
          padding: '1px 2px', whiteSpace: 'pre', overflow: 'hidden',
          color: isEmpty ? 'var(--color-text-muted)' : 'inherit',
        }}
      >{text}</span>
      <CellHoverPopover anchorRef={ref} value={text} enabled={!isEmpty} />
    </>
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
  const textareaRef = useRef(null);
  useEffect(() => { if (!editing) setDraft(value ?? ''); }, [value, editing]);

  // Auto-grow the textarea to fit its contents so the user sees every
  // line of an Alt+Enter note while typing.
  useLayoutEffect(() => {
    if (!editing || !textareaRef.current) return;
    const ta = textareaRef.current;
    ta.style.height = 'auto';
    ta.style.height = ta.scrollHeight + 'px';
  }, [editing, draft]);

  // Matches are a mix of plain strings (existing suggestions) and an
  // optional `+ Add "X"` sentinel object at the end when `onAddNew` is
  // wired up and the current draft isn't an exact match to any
  // suggestion. Keeping both in one array means hover / keyboard nav
  // works uniformly. A suggestion item can also be `{ value, label,
  // secondary }` to render a richer two-line option (e.g. name +
  // email for the Contact column); `value` is what's stored and
  // matched against the query.
  const matchValue = (s) => {
    if (s && typeof s === 'object' && !s.__add) return String(s.value ?? '');
    return String(s ?? '');
  };
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
      const lower = matchValue(s).toLowerCase();
      if (lower === q) continue;
      if (lower.startsWith(q)) prefix.push(s);
      else if (lower.includes(q)) sub.push(s);
      if (prefix.length + sub.length >= 25) break;
    }
    const result = [...prefix, ...sub].slice(0, 8);
    if (onAddNew) {
      const exact = list.some(s => matchValue(s).toLowerCase() === q);
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
    const v = m && typeof m === 'object' ? String(m.value ?? '') : m;
    setDraft(v);
    commit(v);
  }

  useLayoutEffect(() => {
    if (!open || !wrapRef.current) return;
    const rect = wrapRef.current.getBoundingClientRect();
    setDropPos({ top: rect.bottom + 2, left: rect.left, width: rect.width });
  }, [open, draft]);

  if (!editing) {
    const isEmpty = value === '' || value == null;
    const text = isEmpty ? '—' : String(value);
    const enterEdit = () => { setEditing(true); setOpen(dropdownAvailable); };
    return (
      <span
        onClick={(e) => { e.stopPropagation(); enterEdit(); }}
        style={{
          // `white-space: pre` keeps Alt+Enter newlines on their own
          // line (so the row grows vertically to fit) while still
          // clipping anything wider than the column.
          display: 'block', cursor: 'text', minHeight: '1em',
          padding: '1px 2px', whiteSpace: 'pre', overflow: 'hidden',
          color: isEmpty ? 'var(--color-text-muted)' : 'inherit',
        }}
      >{text}</span>
    );
  }
  return (
    <div ref={wrapRef} style={{ position: 'relative' }} onClick={(e) => e.stopPropagation()}>
      <textarea
        ref={textareaRef}
        autoFocus
        rows={1}
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
            if (e.key === 'Enter' && !(e.altKey || e.shiftKey)) {
              e.preventDefault();
              pickMatch(matches[hoverIdx] || matches[0]);
              return;
            }
            if (e.key === 'Escape')    { e.preventDefault(); setDraft(value ?? ''); setEditing(false); setOpen(false); return; }
          } else {
            // Alt+Enter / Shift+Enter inserts a newline (Excel
            // convention) — let the textarea handle it natively.
            // Plain Enter commits and exits edit mode.
            if (e.key === 'Enter' && !(e.altKey || e.shiftKey)) {
              e.preventDefault();
              e.currentTarget.blur();
              return;
            }
            if (e.key === 'Tab')    { e.preventDefault(); e.currentTarget.blur(); return; }
            if (e.key === 'Escape') { setDraft(value ?? ''); setEditing(false); }
          }
        }}
        style={{
          width: '100%', boxSizing: 'border-box',
          border: '1px solid var(--color-accent)', borderRadius: 3,
          padding: '1px 4px',
          fontSize: 'inherit', fontFamily: 'inherit', color: 'var(--color-text)',
          background: '#fff', resize: 'none', overflow: 'hidden',
          lineHeight: 1.3,
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
            const isRich = m && typeof m === 'object' && !m.__add;
            const label = isAdd ? m.label : (isRich ? (m.label ?? m.value) : m);
            const secondary = isRich ? m.secondary : null;
            const keyVal = isAdd ? '__add' : (isRich ? `${m.value}-${i}` : String(m) + i);
            const hovered = i === hoverIdx;
            return (
              <div
                key={keyVal}
                onClick={() => pickMatch(m)}
                onMouseEnter={() => setHoverIdx(i)}
                style={{
                  padding: '0.3rem 0.55rem', cursor: 'pointer',
                  background: hovered ? '#DCFCE7' : 'transparent',
                  color: hovered ? '#166534' : (isAdd ? '#7C3AED' : '#1E293B'),
                  fontStyle: isAdd ? 'italic' : 'normal',
                  fontWeight: hovered ? 700 : 500,
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  borderTop: isAdd && i > 0 ? '1px solid var(--color-border-light)' : 'none',
                }}
              >
                <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</div>
                {secondary && (
                  <div style={{
                    fontSize: '0.7rem',
                    color: hovered ? '#15803D' : 'var(--color-text-muted)',
                    fontWeight: 400,
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>{secondary}</div>
                )}
              </div>
            );
          })}
        </div>,
        document.body,
      )}
    </div>
  );
}

// Contact-column cell — tag-style multi-pick scoped to the prospect
// whose `company` matches this row's Account. Shows current tags
// inline + a "+ Contacts" button (only when an Account is set) that
// opens a checkbox picker of every contact on that prospect with
// name on top and email muted underneath. Stores the chosen names
// as a comma-separated string so the same parseMulti round-trip
// works as for Scope.
// Build a set of normalized match keys for a company name, including
// the full name, the name with any parenthetical alias stripped, and
// each parenthetical alias on its own. Two companies are considered
// the same if their key sets intersect. This lets "Unibail-Rodamco-
// Westfield (URW)" match contact records stored under either the long
// form or just "URW".
function companyMatchKeys(name) {
  const s = String(name || '').trim();
  const keys = new Set();
  if (!s) return keys;
  const full = normalizeCompany(s);
  if (full) keys.add(full);
  const aliases = [...s.matchAll(/\(([^)]+)\)/g)].map(m => m[1]);
  if (aliases.length > 0) {
    const stripped = normalizeCompany(s.replace(/\([^)]*\)/g, ' '));
    if (stripped) keys.add(stripped);
    for (const a of aliases) {
      const n = normalizeCompany(a);
      if (n) keys.add(n);
    }
  }
  return keys;
}

function ContactCell({ value, onChange, account, prospects, updateProspect, hubspotContacts, onOpenContact }) {
  // Single boolean for popover state — the popover handles both
  // viewing currently tagged contacts and adding new ones (from the
  // company roster or as a custom one-off tag), so the picker/view
  // split is gone.
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [customDraft, setCustomDraft] = useState('');
  const [popPos, setPopPos] = useState({ top: 0, bottom: null, left: 0, maxHeight: 0, placement: 'below' });
  const wrapRef = useRef(null);
  const popRef = useRef(null);
  const [copied, setCopied] = useState(null); // key of the last button that flashed "Copied!"

  const matched = useMemo(() => {
    const accountKeys = companyMatchKeys(account);
    if (accountKeys.size === 0) return null;
    // Prefer an exact normalized match over an alias-only match so
    // "URW" on an opp doesn't accidentally pull from a prospect that
    // happens to share an alias.
    let exact = null;
    let alias = null;
    for (const p of (prospects || [])) {
      const pk = companyMatchKeys(p?.company);
      if (pk.size === 0) continue;
      const full = normalizeCompany(p?.company);
      const accountFull = normalizeCompany(account);
      if (full && accountFull && full === accountFull) { exact = p; break; }
      for (const k of pk) { if (accountKeys.has(k)) { alias = alias || p; break; } }
    }
    return exact || alias;
  }, [account, prospects]);

  // Build the contact roster for this opp's company. Pull from two
  // sources and dedupe by name (case-insensitive):
  //   1. The HubSpot contacts cache, filtered by company === Account
  //   2. Any contacts attached directly to the matched prospect record
  // The HubSpot cache is the primary source (most of the user's
  // contacts live there); prospect.contacts is a fallback for
  // accounts that were curated manually.
  const contactOptions = useMemo(() => {
    const accountKeys = companyMatchKeys(account);
    if (accountKeys.size === 0) return [];
    const seen = new Set();
    const out = [];
    const pushContact = (raw) => {
      if (!raw) return;
      const name = [raw.firstname, raw.lastname].filter(Boolean).join(' ').trim()
        || String(raw.email || '').trim();
      if (!name) return;
      const k = name.toLowerCase();
      if (seen.has(k)) return;
      seen.add(k);
      out.push({
        name,
        email: String(raw.email || '').trim(),
        jobtitle: String(raw.jobtitle || '').trim(),
      });
    };
    for (const c of (hubspotContacts || [])) {
      const ck = companyMatchKeys(c?.company);
      if (ck.size === 0) continue;
      let hit = false;
      for (const k of ck) { if (accountKeys.has(k)) { hit = true; break; } }
      if (!hit) continue;
      pushContact(c);
    }
    for (const c of (matched?.contacts || [])) pushContact(c);
    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
  }, [account, hubspotContacts, matched]);

  const selected = useMemo(() => parseMulti(value), [value]);
  const selectedSet = useMemo(() => new Set(selected.map(s => s.toLowerCase())), [selected]);

  const filteredOptions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return contactOptions;
    return contactOptions.filter(o =>
      o.name.toLowerCase().includes(q) || o.email.toLowerCase().includes(q)
    );
  }, [contactOptions, query]);

  // Anchor the popover next to the cell, flipping above when the row
  // sits near the bottom of the viewport so a long contact list isn't
  // cut off. Also caps the popover's overall max height to whatever
  // vertical space is available on the chosen side; the internal lists
  // stay capped at their own maxHeights so the user can still scroll
  // through them individually.
  useLayoutEffect(() => {
    if (!open || !wrapRef.current) return;
    const rect = wrapRef.current.getBoundingClientRect();
    const margin = 8;
    const gap = 2;
    const spaceBelow = window.innerHeight - rect.bottom - margin;
    const spaceAbove = rect.top - margin;
    // Prefer below — the popover's natural sit — unless there's
    // meaningfully more room above. The 200px floor on "below" keeps a
    // close-to-bottom row from flipping needlessly when there's still
    // some room (the list will scroll internally).
    const placeBelow = spaceBelow >= 200 || spaceBelow >= spaceAbove;
    if (placeBelow) {
      setPopPos({
        top: rect.bottom + gap,
        bottom: null,
        left: rect.left,
        maxHeight: Math.max(160, spaceBelow),
        placement: 'below',
      });
    } else {
      setPopPos({
        top: null,
        bottom: window.innerHeight - rect.top + gap,
        left: rect.left,
        maxHeight: Math.max(160, spaceAbove),
        placement: 'above',
      });
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (wrapRef.current?.contains(e.target)) return;
      if (popRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  function tagName(name) {
    const trimmed = String(name || '').trim();
    if (!trimmed) return;
    if (selectedSet.has(trimmed.toLowerCase())) return;
    onChange([...selected, trimmed].join(', '));
  }

  function untag(name) {
    const key = String(name || '').toLowerCase();
    onChange(selected.filter(s => s.toLowerCase() !== key).join(', '));
  }

  // Custom tag — used by the "not from this company" path. Just adds
  // the typed name to this opp's tag list without touching the
  // prospect roster, so a one-off contact (consultant, broker,
  // someone at a different account) can ride along on this opp.
  function tagCustom() {
    const name = customDraft.trim();
    if (!name) return;
    tagName(name);
    setCustomDraft('');
  }

  const accountSelected = !!String(account || '').trim();
  const isEmpty = selected.length === 0;

  // Map tagged names back to their roster entry so the cell can show
  // emails (preferred) instead of names. Falls back to the raw tag
  // text when a tag doesn't resolve to a known contact.
  const contactByName = useMemo(() => {
    const map = new Map();
    for (const c of contactOptions) map.set(c.name.toLowerCase(), c);
    return map;
  }, [contactOptions]);

  const taggedDetails = useMemo(() => selected.map(name => {
    const found = contactByName.get(name.toLowerCase());
    return { name, email: found?.email || '' };
  }), [selected, contactByName]);

  const displayString = useMemo(() => taggedDetails
    .map(t => t.email || t.name)
    .filter(Boolean)
    .join(', '), [taggedDetails]);

  function copyToClipboard(text, key) {
    if (!text) return;
    const writer = navigator?.clipboard?.writeText
      ? navigator.clipboard.writeText(text)
      : Promise.reject(new Error('clipboard unavailable'));
    Promise.resolve(writer)
      .then(() => {
        setCopied(key);
        setTimeout(() => setCopied((cur) => (cur === key ? null : cur)), 1100);
      })
      .catch(() => { /* clipboard blocked — user can still highlight manually */ });
  }

  const emailsOnly = taggedDetails.map(t => t.email).filter(Boolean).join(', ');
  const namesAndEmails = taggedDetails
    .map(t => t.email ? `${t.name} <${t.email}>` : t.name)
    .join('\n');

  return (
    <div
      ref={wrapRef}
      style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 6, minHeight: '1em', minWidth: 0 }}
      onClick={(e) => e.stopPropagation()}
    >
      <span
        onClick={() => {
          if (isEmpty && !accountSelected) return;
          setOpen(o => !o);
        }}
        style={{
          flex: 1, minWidth: 0,
          cursor: (isEmpty && !accountSelected) ? 'default' : 'pointer',
          padding: '1px 2px',
          color: isEmpty ? 'var(--color-text-muted)' : 'inherit',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          display: 'block',
        }}
        title={isEmpty
          ? (accountSelected ? 'Click to tag contacts' : 'Pick an Account first')
          : 'Click to view / copy contact details'}
      >
        {isEmpty ? '—' : displayString}
      </span>
      {/* The + Contacts pill only shows when the column is empty — once
          contacts are tagged, the user clicks the email list itself to
          open the same popover and the pill would just be noise. */}
      {accountSelected && isEmpty && (
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          style={{
            padding: '1px 6px', fontSize: '0.7rem', fontFamily: 'inherit',
            fontWeight: 600, color: '#166534', background: '#DCFCE7',
            border: '1px solid #86EFAC', borderRadius: 999, cursor: 'pointer',
            whiteSpace: 'nowrap', lineHeight: 1.4, flex: '0 0 auto',
          }}
          title="Tag contacts from this company"
        >+ Contacts</button>
      )}
      {open && createPortal(
        <div
          ref={popRef}
          onMouseDown={(e) => e.stopPropagation()}
          style={{
            position: 'fixed',
            ...(popPos.top != null ? { top: popPos.top } : {}),
            ...(popPos.bottom != null ? { bottom: popPos.bottom } : {}),
            left: popPos.left,
            zIndex: 9999, width: 380, maxWidth: '92vw',
            maxHeight: popPos.maxHeight, overflowY: 'auto',
            background: '#fff', border: '1px solid var(--color-border)',
            borderRadius: 4, boxShadow: '0 8px 20px rgba(15, 23, 42, 0.18)',
            fontSize: '0.85rem',
          }}
        >
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '0.5rem 0.6rem',
            borderBottom: '1px solid var(--color-border-light)',
          }}>
            <div>
              <div style={{
                fontSize: '0.72rem', color: 'var(--color-text-muted)',
                textTransform: 'uppercase', letterSpacing: '0.03em', fontWeight: 600,
              }}>
                Tagged Contacts ({selected.length})
              </div>
              <div style={{ fontSize: '0.78rem', color: 'var(--color-text)', marginTop: 1 }}>
                {matched?.company || account || '—'}
              </div>
            </div>
            {!isEmpty && (
              <button
                type="button"
                onClick={() => onChange('')}
                style={{
                  padding: '0.25rem 0.55rem', fontSize: '0.7rem', fontWeight: 600,
                  fontFamily: 'inherit', color: 'var(--color-text-muted)',
                  background: 'transparent', border: '1px solid var(--color-border)',
                  borderRadius: 3, cursor: 'pointer',
                }}
                title="Remove all tagged contacts"
              >Clear all</button>
            )}
          </div>

          {!isEmpty && (
            <>
              <div style={{ maxHeight: 240, overflowY: 'auto' }}>
                {taggedDetails.map((t, idx) => {
                  const key = `row-${idx}`;
                  return (
                    <div
                      key={`${t.name}-${idx}`}
                      style={{
                        display: 'flex', alignItems: 'flex-start', gap: '0.5rem',
                        padding: '0.45rem 0.7rem',
                        borderBottom: '1px solid var(--color-border-light)',
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        {onOpenContact ? (
                          <button
                            type="button"
                            onClick={() => { onOpenContact(t.name, t.email); setOpen(false); }}
                            title={`Open ${t.name}'s details`}
                            style={{
                              display: 'block', width: '100%', textAlign: 'left',
                              padding: 0, border: 'none', background: 'transparent',
                              fontFamily: 'inherit', fontSize: 'inherit',
                              fontWeight: 600, color: '#2563EB', cursor: 'pointer',
                              textDecoration: 'underline', textDecorationColor: '#93C5FD',
                              textUnderlineOffset: '2px',
                              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                            }}
                          >{t.name}</button>
                        ) : (
                          <div style={{
                            fontWeight: 600, color: '#1E293B',
                            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                          }}>{t.name}</div>
                        )}
                        <div style={{
                          fontSize: '0.75rem',
                          color: t.email ? 'var(--color-text-muted)' : '#94A3B8',
                          fontStyle: t.email ? 'normal' : 'italic',
                          userSelect: 'text',
                          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                        }}>{t.email || '(no email)'}</div>
                      </div>
                      {t.email && (
                        <button
                          type="button"
                          onClick={() => copyToClipboard(t.email, key)}
                          style={{
                            flex: '0 0 auto',
                            padding: '0.2rem 0.55rem', fontSize: '0.7rem', fontWeight: 600,
                            fontFamily: 'inherit',
                            color: copied === key ? '#166534' : 'var(--color-text-muted)',
                            background: copied === key ? '#DCFCE7' : 'transparent',
                            border: '1px solid var(--color-border)', borderRadius: 3,
                            cursor: 'pointer',
                          }}
                        >{copied === key ? 'Copied' : 'Copy'}</button>
                      )}
                      <button
                        type="button"
                        onClick={() => untag(t.name)}
                        title="Remove this tag"
                        style={{
                          flex: '0 0 auto',
                          width: 22, height: 22, padding: 0,
                          fontSize: '0.9rem', fontWeight: 600,
                          fontFamily: 'inherit', lineHeight: 1,
                          color: 'var(--color-text-muted)',
                          background: 'transparent',
                          border: '1px solid var(--color-border)', borderRadius: 3,
                          cursor: 'pointer',
                        }}
                      >×</button>
                    </div>
                  );
                })}
              </div>
              <div style={{
                display: 'flex', justifyContent: 'flex-end', gap: '0.4rem',
                padding: '0.4rem 0.6rem',
                borderBottom: '1px solid var(--color-border-light)',
                background: 'var(--color-bg)',
              }}>
                <button
                  type="button"
                  onClick={() => copyToClipboard(emailsOnly, 'all-emails')}
                  disabled={!emailsOnly}
                  style={{
                    padding: '0.25rem 0.6rem', fontSize: '0.72rem', fontWeight: 600,
                    fontFamily: 'inherit',
                    color: copied === 'all-emails' ? '#166534' : 'var(--color-text-muted)',
                    background: copied === 'all-emails' ? '#DCFCE7' : 'transparent',
                    border: '1px solid var(--color-border)', borderRadius: 3,
                    cursor: emailsOnly ? 'pointer' : 'not-allowed',
                    opacity: emailsOnly ? 1 : 0.5,
                  }}
                >{copied === 'all-emails' ? 'Copied' : 'Copy emails'}</button>
                <button
                  type="button"
                  onClick={() => copyToClipboard(namesAndEmails, 'all-pairs')}
                  style={{
                    padding: '0.25rem 0.6rem', fontSize: '0.72rem', fontWeight: 600,
                    fontFamily: 'inherit',
                    color: copied === 'all-pairs' ? '#166534' : 'var(--color-text-muted)',
                    background: copied === 'all-pairs' ? '#DCFCE7' : 'transparent',
                    border: '1px solid var(--color-border)', borderRadius: 3,
                    cursor: 'pointer',
                  }}
                >{copied === 'all-pairs' ? 'Copied' : 'Copy names + emails'}</button>
              </div>
            </>
          )}

          {/* Add from the company's existing roster. */}
          <div style={{ padding: '0.5rem 0.6rem' }}>
            <div style={{
              fontSize: '0.7rem', color: 'var(--color-text-muted)',
              textTransform: 'uppercase', letterSpacing: '0.03em', fontWeight: 600,
              marginBottom: '0.3rem',
            }}>
              + Add from {matched?.company || account || 'this company'}
            </div>
            <input
              type="text"
              value={query}
              placeholder="Filter contacts…"
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') { e.preventDefault(); setOpen(false); }
              }}
              style={{
                width: '100%', boxSizing: 'border-box',
                border: '1px solid var(--color-border)', borderRadius: 3,
                padding: '5px 8px', fontSize: 'inherit', fontFamily: 'inherit',
                color: 'var(--color-text)', background: '#fff',
              }}
            />
          </div>
          <div style={{ maxHeight: 200, overflowY: 'auto', borderTop: '1px solid var(--color-border-light)' }}>
            {filteredOptions.length === 0 ? (
              <div style={{ padding: '0.6rem 0.7rem', color: 'var(--color-text-muted)', fontSize: '0.78rem' }}>
                {contactOptions.length === 0
                  ? 'No contacts on file for this company yet.'
                  : 'No contacts match the filter.'}
              </div>
            ) : filteredOptions.map(opt => {
              const isTagged = selectedSet.has(opt.name.toLowerCase());
              return (
                <div
                  key={opt.name}
                  onClick={() => isTagged ? untag(opt.name) : tagName(opt.name)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '0.55rem',
                    padding: '0.4rem 0.7rem', cursor: 'pointer',
                    background: isTagged ? '#DCFCE7' : 'transparent',
                  }}
                >
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      color: isTagged ? '#166534' : '#1E293B',
                      fontWeight: isTagged ? 600 : 500,
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>{opt.name}</div>
                    {opt.email && (
                      <div style={{
                        fontSize: '0.72rem',
                        color: isTagged ? '#15803D' : 'var(--color-text-muted)',
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      }}>{opt.email}</div>
                    )}
                  </span>
                  <span style={{
                    flex: '0 0 auto', fontSize: '0.7rem', fontWeight: 600,
                    color: isTagged ? '#15803D' : 'var(--color-text-muted)',
                  }}>{isTagged ? '✓ Tagged' : '+ Add'}</span>
                </div>
              );
            })}
          </div>

          {/* Custom contact — someone NOT from this company. Just tags
              the name on this opp; doesn't touch the prospect roster. */}
          <div style={{
            padding: '0.5rem 0.6rem',
            borderTop: '1px solid var(--color-border-light)',
            background: 'var(--color-bg)',
          }}>
            <div style={{
              fontSize: '0.7rem', color: 'var(--color-text-muted)',
              textTransform: 'uppercase', letterSpacing: '0.03em', fontWeight: 600,
              marginBottom: '0.3rem',
            }}>
              + Add custom contact (not from this company)
            </div>
            <div style={{ display: 'flex', gap: '0.4rem' }}>
              <input
                type="text"
                value={customDraft}
                placeholder="Name…"
                onChange={(e) => setCustomDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') { e.preventDefault(); setOpen(false); }
                  if (e.key === 'Enter') { e.preventDefault(); tagCustom(); }
                }}
                style={{
                  flex: 1, minWidth: 0, boxSizing: 'border-box',
                  border: '1px solid var(--color-border)', borderRadius: 3,
                  padding: '5px 8px', fontSize: 'inherit', fontFamily: 'inherit',
                  color: 'var(--color-text)', background: '#fff',
                }}
              />
              <button
                type="button"
                onClick={tagCustom}
                disabled={!customDraft.trim()}
                style={{
                  padding: '0.25rem 0.7rem', background: 'var(--color-accent)',
                  border: '1px solid var(--color-accent)', borderRadius: 3,
                  fontSize: '0.72rem', fontWeight: 600, fontFamily: 'inherit',
                  color: '#fff',
                  cursor: customDraft.trim() ? 'pointer' : 'not-allowed',
                  opacity: customDraft.trim() ? 1 : 0.5,
                }}
              >Add</button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

// Default column → list bindings for Opps 2 — preserve the original
// hard-coded behavior for new users. The user can override or extend
// these per column from the "Link columns" modal; picks made there
// (including an explicit `none`) win over these defaults.
const DEFAULT_COLUMN_LINKS = {
  Scope:  { listKey: 'solutions',    mode: 'multi'  },
  Source: { listKey: 'source',       mode: 'single' },
  Stage:  { listKey: 'status',       mode: 'single' },
  Status: { listKey: 'whoIsWaiting', mode: 'single' },
};

// Thin wrapper around the shared resolver so existing call sites in
// this file don't need to thread DEFAULT_COLUMN_LINKS through every
// invocation.
function resolveColumnLink(columnName, userLinks) {
  return resolveSharedColumnLink(columnName, userLinks, DEFAULT_COLUMN_LINKS);
}


// Tiny modal that fires right before a new opp is committed. Asks
// the user to pick a Source from the same picklist the Source cell
// uses. The user can skip (creates the opp with Source left blank),
// pick one and commit, or cancel (no opp gets created). Account is
// passed through so the prompt can display "for <company>" when the
// flow came from the Add Company combobox.
function NewOppSourceModal({ account, options, onCreate, onCancel }) {
  const [source, setSource] = useState('');
  return createPortal(
    <div
      onClick={onCancel}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.45)',
        zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 420, maxWidth: '92vw',
          background: '#fff', borderRadius: 8, boxShadow: '0 20px 50px rgba(15, 23, 42, 0.3)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}
      >
        <div style={{
          padding: '0.85rem 1rem', borderBottom: '1px solid var(--color-border-light)',
        }}>
          <div style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--color-text)' }}>
            What's the Source for this opp?
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: 2 }}>
            {account
              ? <>Adding <strong>{account}</strong>. Pick a Source so the new row is tagged correctly.</>
              : 'Pick a Source so the new row is tagged correctly. You can skip and fill it in later.'}
          </div>
        </div>

        <div style={{ padding: '0.85rem 1rem' }}>
          <select
            autoFocus
            value={source}
            onChange={(e) => setSource(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && source) { e.preventDefault(); onCreate(source); }
              if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
            }}
            style={{
              width: '100%', boxSizing: 'border-box',
              padding: '0.45rem 0.55rem',
              border: '1px solid var(--color-border)', borderRadius: 4,
              fontSize: '0.85rem', fontFamily: 'inherit',
              background: '#fff', color: 'var(--color-text)',
            }}
          >
            <option value="">— Select a Source —</option>
            {options.map(o => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
        </div>

        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '0.6rem 1rem',
          borderTop: '1px solid var(--color-border-light)', background: 'var(--color-bg)',
        }}>
          <button
            type="button"
            onClick={onCancel}
            style={{
              padding: '0.35rem 0.7rem', background: 'transparent',
              border: '1px solid var(--color-border)', borderRadius: 4,
              fontSize: '0.78rem', fontWeight: 600, fontFamily: 'inherit',
              color: 'var(--color-text-muted)', cursor: 'pointer',
            }}
          >Cancel</button>
          <div style={{ display: 'flex', gap: '0.4rem' }}>
            <button
              type="button"
              onClick={() => onCreate('')}
              style={{
                padding: '0.35rem 0.7rem', background: 'transparent',
                border: '1px solid var(--color-border)', borderRadius: 4,
                fontSize: '0.78rem', fontWeight: 600, fontFamily: 'inherit',
                color: 'var(--color-text-muted)', cursor: 'pointer',
              }}
            >Skip</button>
            <button
              type="button"
              onClick={() => onCreate(source)}
              disabled={!source}
              style={{
                padding: '0.35rem 0.85rem', background: 'var(--color-accent)',
                border: '1px solid var(--color-accent)', borderRadius: 4,
                fontSize: '0.78rem', fontWeight: 600, fontFamily: 'inherit',
                color: '#fff',
                cursor: source ? 'pointer' : 'not-allowed',
                opacity: source ? 1 : 0.5,
              }}
            >Create opp</button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// Popup that shows the basic info for one opp + a Delete button. Opened
// from the row-level info button so the user can eyeball the full record
// without having to hunt through the (often horizontally scrolled) row.
function OppInfoModal({
  opp,
  headers,
  onClose,
  onDelete,
  onFieldChange,
  columnLinks,
  listRegistry,
  companySuggestions,
  prospects,
  updateProspect,
  hubspotContacts,
  pricingOptionServices,
  pricingOptionLinkName,
  onOpenContact,
}) {
  if (!opp) return null;
  // Show every header column the row has a value for, in the same order
  // the table presents them, so the popup matches the user's mental
  // model of the row. Computed columns are pulled from the live row
  // (the parent computes them into the opp before passing it in).
  const orderedFields = (headers || []).filter(h => h && h !== '_select' && h !== '_info' && h !== '_actions');
  const formatValue = (key, raw) => {
    if (raw == null || raw === '') return '—';
    if (DATE_COLUMNS.has(key)) return formatDateDisplay(raw);
    return String(raw);
  };
  const renderEditor = (h) => {
    const value = opp[h];
    // Computed columns stay read-only — they're derived from sibling
    // fields and don't have a stored value to edit.
    if (h === 'Call In' || h === 'Last Spoke') {
      return (
        <span style={{ color: 'var(--color-text-muted)' }}>
          {value == null || value === '' ? '—' : String(value)}
        </span>
      );
    }
    if (!onFieldChange) {
      // Fallback to the original read-only renderer when the modal is
      // mounted without an edit callback.
      return <span>{formatValue(h, value)}</span>;
    }
    const onChange = (v) => onFieldChange(h, v);
    if (DATE_COLUMNS.has(h)) {
      return <DateCell value={value} onChange={onChange} />;
    }
    if (TRISTATE_COLUMNS.has(h)) {
      return <TristateCheckCell value={value} onChange={onChange} title={`${h}: blank → ✓ → ✗ → blank`} />;
    }
    const link = columnLinks ? resolveColumnLink(h, columnLinks) : null;
    if (link && listRegistry) {
      const opts = listRegistry.get(link.listKey)?.options || [];
      if (link.mode === 'multi') {
        const extraGroups = link.listKey === 'solutions'
          ? Object.entries(pricingOptionServices || {})
              .map(([sheetName, services]) => ({
                label: sheetName,
                options: Array.isArray(services) ? services : [],
              }))
              .filter(g => g.options.length > 0)
              .sort((a, b) => a.label.localeCompare(b.label))
          : undefined;
        return (
          <MultiSelectCell
            value={value}
            onChange={onChange}
            options={opts}
            extraGroups={extraGroups}
            extraGroupsLabel="Add from Pricing Option"
            extraGroupsPlaceholder="— pick an option —"
            nowrap={h === 'Scope'}
          />
        );
      }
      return <SelectCell value={value} onChange={onChange} options={opts} />;
    }
    if (h === 'Contact') {
      return (
        <ContactCell
          value={value}
          onChange={onChange}
          account={opp['Account']}
          prospects={prospects}
          updateProspect={updateProspect}
          hubspotContacts={hubspotContacts}
          onOpenContact={onOpenContact}
        />
      );
    }
    return (
      <EditableCell
        value={value}
        onChange={onChange}
        suggestions={h === 'Account' ? companySuggestions : undefined}
      />
    );
  };
  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.45)',
        zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 1100, maxWidth: '94vw', maxHeight: '92vh',
          background: '#fff', borderRadius: 8, boxShadow: '0 20px 50px rgba(15, 23, 42, 0.3)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}
      >
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0.85rem 1rem', borderBottom: '1px solid var(--color-border-light)',
        }}>
          <div style={{ minWidth: 0 }}>
            <div style={{
              fontSize: '0.7rem', color: 'var(--color-text-muted)',
              textTransform: 'uppercase', letterSpacing: '0.03em', fontWeight: 600,
            }}>Opp details</div>
            <div style={{
              fontSize: '1rem', fontWeight: 700, color: 'var(--color-text)',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              {String(opp['Account'] || '').trim() || '(no account)'}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '0.3rem 0.65rem', background: 'transparent',
              border: '1px solid var(--color-border)', borderRadius: 4,
              fontSize: '0.78rem', fontWeight: 600, fontFamily: 'inherit',
              color: 'var(--color-text-muted)', cursor: 'pointer',
            }}
          >Close</button>
        </div>

        <div style={{ overflowY: 'auto', padding: '0.5rem 1rem 0.75rem' }}>
          {opp._pricingOption ? (
            <div style={{ margin: '0.25rem 0 0.75rem' }}>
              <div style={{
                fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.03em',
                color: 'var(--color-text-muted)', fontWeight: 600, marginBottom: '0.35rem',
              }}>Pricing Option (saved snapshot)</div>
              <PricingOptionSnapshotView snapshot={opp._pricingOption} />
            </div>
          ) : pricingOptionLinkName ? (
            // Linked to a Pricing Option by name, but no saved snapshot
            // on the record yet — likely a link created before the
            // snapshot feature shipped. Tell the user how to recapture.
            <div style={{
              margin: '0.25rem 0 0.75rem',
              padding: '0.6rem 0.8rem',
              border: '1px dashed var(--color-border)', borderRadius: 6,
              background: '#fff8e1', fontSize: '0.8rem',
              color: '#92400e', lineHeight: 1.4,
            }}>
              <div style={{ fontWeight: 600, marginBottom: 2 }}>
                Linked to <em>{pricingOptionLinkName}</em>, but no saved snapshot here yet.
              </div>
              <div>
                Open the Pricing tab, find that option, and click <strong>Save to Opp…</strong>
                again to capture the rows + Year 1 fees onto this opp. The new save
                will appear here.
              </div>
            </div>
          ) : null}
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <tbody>
              {orderedFields.map(h => (
                <tr key={h} style={{ borderTop: '1px solid var(--color-border-light)' }}>
                  <td style={{
                    padding: '0.45rem 0.5rem 0.45rem 0',
                    fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.03em',
                    color: 'var(--color-text-muted)', fontWeight: 600,
                    width: 170, verticalAlign: 'top',
                  }}>{h === 'BFO Link' ? 'BFO Opportunity Name' : h}</td>
                  <td style={{
                    padding: '0.45rem 0',
                    color: 'var(--color-text)',
                    whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                  }}>{renderEditor(h)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '0.6rem 1rem', borderTop: '1px solid var(--color-border-light)',
          background: 'var(--color-bg)',
        }}>
          <button
            type="button"
            onClick={() => {
              const label = String(opp['Account'] || '').trim() || 'this opp';
              if (window.confirm(`Delete ${label}? This can't be undone.`)) {
                onDelete(opp._id);
                onClose();
              }
            }}
            style={{
              padding: '0.4rem 0.85rem', background: '#FEE2E2',
              border: '1px solid #FCA5A5', borderRadius: 4,
              fontSize: '0.78rem', fontWeight: 600, fontFamily: 'inherit',
              color: '#B91C1C', cursor: 'pointer',
            }}
          >Delete opp</button>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '0.4rem 0.95rem', background: 'var(--color-accent)',
              border: '1px solid var(--color-accent)', borderRadius: 4,
              fontSize: '0.78rem', fontWeight: 600, fontFamily: 'inherit',
              color: '#fff', cursor: 'pointer',
            }}
          >Done</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// Toolbar that pops in above the table once 1+ rows are checked. Lets
// the user push a single value into every selected opp at once (Stage,
// Status, Source, Scope, etc.) or bulk-delete them. The field list is
// driven by the column header set so it tracks whatever columns the
// user currently has + any list bindings they've set up.
function MassEditBar({ selectedCount, headers, columnLinks, listRegistry, onApply, onDelete, onClear }) {
  const editableFields = useMemo(() => {
    const out = [];
    for (const h of headers || []) {
      if (!h || h === '_select' || h === '_info' || h === '_actions') continue;
      if (COMPUTED_COLUMNS.includes(h)) continue;
      out.push(h);
    }
    return out;
  }, [headers]);
  const [field, setField] = useState('Stage');
  const [textValue, setTextValue] = useState('');
  const [multiValue, setMultiValue] = useState('');
  // Whichever field is picked, reset both value buffers so a stale
  // value from the previous field doesn't get applied by accident.
  useEffect(() => { setTextValue(''); setMultiValue(''); }, [field]);

  const link = resolveColumnLink(field, columnLinks);
  const isDate = DATE_COLUMNS.has(field);
  const listOptions = link ? (listRegistry?.get(link.listKey)?.options || []) : null;
  const valueToApply = link && link.mode === 'multi' ? multiValue : textValue;

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap',
      margin: '0 1.25rem 0.5rem',
      padding: '0.5rem 0.75rem',
      background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 6,
      fontSize: '0.82rem',
    }}>
      <span style={{ fontWeight: 700, color: '#1E3A8A' }}>
        {selectedCount} selected
      </span>
      <span style={{ color: 'var(--color-text-muted)' }}>·</span>
      <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
        <span style={{ color: 'var(--color-text-muted)' }}>Set</span>
        <select
          value={field}
          onChange={(e) => setField(e.target.value)}
          style={{
            padding: '0.3rem 0.45rem',
            border: '1px solid var(--color-border)', borderRadius: 4,
            fontSize: '0.82rem', fontFamily: 'inherit',
            background: '#fff', color: 'var(--color-text)',
          }}
        >
          {editableFields.map(h => (
            <option key={h} value={h}>{h === 'BFO Link' ? 'BFO Opportunity Name' : h}</option>
          ))}
        </select>
      </label>
      <span style={{ color: 'var(--color-text-muted)' }}>to</span>
      {link && link.mode === 'multi' ? (
        <select
          multiple
          value={parseMulti(multiValue)}
          onChange={(e) => {
            const picked = Array.from(e.target.selectedOptions).map(o => o.value);
            setMultiValue(picked.join(', '));
          }}
          size={Math.min(6, Math.max(3, (listOptions || []).length))}
          style={{
            minWidth: 200, padding: '0.25rem 0.4rem',
            border: '1px solid var(--color-border)', borderRadius: 4,
            fontSize: '0.82rem', fontFamily: 'inherit',
            background: '#fff', color: 'var(--color-text)',
          }}
        >
          {(listOptions || []).map(o => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
      ) : link ? (
        <select
          value={textValue}
          onChange={(e) => setTextValue(e.target.value)}
          style={{
            minWidth: 180, padding: '0.3rem 0.45rem',
            border: '1px solid var(--color-border)', borderRadius: 4,
            fontSize: '0.82rem', fontFamily: 'inherit',
            background: '#fff', color: 'var(--color-text)',
          }}
        >
          <option value="">— pick a value —</option>
          {(listOptions || []).map(o => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
      ) : isDate ? (
        <input
          type="date"
          value={textValue}
          onChange={(e) => setTextValue(e.target.value)}
          style={{
            padding: '0.25rem 0.4rem',
            border: '1px solid var(--color-border)', borderRadius: 4,
            fontSize: '0.82rem', fontFamily: 'inherit',
            background: '#fff', color: 'var(--color-text)',
          }}
        />
      ) : (
        <input
          type="text"
          value={textValue}
          onChange={(e) => setTextValue(e.target.value)}
          placeholder="New value (blank to clear)"
          style={{
            minWidth: 200, padding: '0.3rem 0.45rem',
            border: '1px solid var(--color-border)', borderRadius: 4,
            fontSize: '0.82rem', fontFamily: 'inherit',
            background: '#fff', color: 'var(--color-text)',
          }}
        />
      )}
      <button
        type="button"
        onClick={() => onApply(field, valueToApply)}
        style={{
          padding: '0.35rem 0.85rem', background: 'var(--color-accent)',
          border: '1px solid var(--color-accent)', borderRadius: 4,
          fontSize: '0.78rem', fontWeight: 600, fontFamily: 'inherit',
          color: '#fff', cursor: 'pointer',
        }}
      >Apply to {selectedCount}</button>
      <div style={{ flex: 1 }} />
      <button
        type="button"
        onClick={() => {
          if (window.confirm(`Delete ${selectedCount} selected opp${selectedCount === 1 ? '' : 's'}? This can't be undone.`)) {
            onDelete();
          }
        }}
        style={{
          padding: '0.35rem 0.7rem', background: '#FEE2E2',
          border: '1px solid #FCA5A5', borderRadius: 4,
          fontSize: '0.78rem', fontWeight: 600, fontFamily: 'inherit',
          color: '#B91C1C', cursor: 'pointer',
        }}
      >Delete selected</button>
      <button
        type="button"
        onClick={onClear}
        style={{
          padding: '0.35rem 0.7rem', background: 'transparent',
          border: '1px solid var(--color-border)', borderRadius: 4,
          fontSize: '0.78rem', fontWeight: 600, fontFamily: 'inherit',
          color: 'var(--color-text-muted)', cursor: 'pointer',
        }}
      >Clear selection</button>
    </div>
  );
}

// Tab- or comma-separated value parser that handles quoted fields,
// escaped quotes, and CRLF / LF endings. Same shape the Opps tab uses
// — duplicated here to keep the bulk-import modal self-contained.
function parseTabularText(text, delimiter) {
  const rows = [];
  let current = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === delimiter) { current.push(field); field = ''; }
      else if (ch === '\n' || (ch === '\r' && text[i + 1] === '\n')) {
        current.push(field); field = '';
        if (ch === '\r') i++;
        rows.push(current); current = [];
      } else field += ch;
    }
  }
  if (field || current.length > 0) { current.push(field); rows.push(current); }
  return rows;
}

// Auto-detect whether a pasted blob is tab-separated (Google Sheets
// copy) or comma-separated (downloaded CSV). The first newline's worth
// of text is enough to decide reliably.
function detectDelimiter(text) {
  const firstLine = text.split(/\r?\n/, 1)[0] || '';
  const tabs = (firstLine.match(/\t/g) || []).length;
  const commas = (firstLine.match(/,/g) || []).length;
  return tabs > commas ? '\t' : ',';
}

// Bulk Import modal — paste a Google-Sheet-shaped block, review the
// column mapping the modal auto-detected (and adjust by hand), see
// warnings about rows that won't import, and commit. The caller owns
// the actual setData / persistence; we just hand back the additions.
function BulkImportModal({ existingHeaders, existingRecords, dedupKeyFor, onClose, onImport }) {
  const [text, setText] = useState('');
  const [parsed, setParsed] = useState(null);
  const [mapping, setMapping] = useState({});
  const [importing, setImporting] = useState(false);
  // When on, every formerly-skipped row gets imported anyway with a
  // `Review` note explaining why it was flagged (and, for dupes of an
  // existing row, the existing row gets a back-reference Review note
  // too). Lets the user audit the collisions in-place on Opps2
  // instead of fixing the source before re-pasting.
  const [flagAndImportAll, setFlagAndImportAll] = useState(false);
  const targetOptions = useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const h of (existingHeaders || [])) {
      if (h && !seen.has(h)) { seen.add(h); out.push(h); }
    }
    return out;
  }, [existingHeaders]);

  // Map of existing opp `_id` → 1..N display rank (matches the Opp #
  // column the parent table renders). Lets the dedup reasons and the
  // Excel export name a colliding opp by its visible number rather
  // than its raw internal id.
  const rankById = useMemo(() => {
    const map = new Map();
    const ids = (existingRecords || [])
      .map(r => r?._id)
      .filter(id => id != null)
      .sort((a, b) => (Number(a) || 0) - (Number(b) || 0));
    ids.forEach((id, idx) => map.set(id, idx + 1));
    return map;
  }, [existingRecords]);

  // Esc / backdrop closes (but not while a commit is mid-flight).
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !importing) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, importing]);

  function handleParse() {
    const raw = String(text || '').trim();
    if (!raw) { setParsed(null); return; }
    const delimiter = detectDelimiter(raw);
    const rows = parseTabularText(raw, delimiter);
    if (!rows.length) { setParsed(null); return; }
    const headers = rows[0].map(h => String(h || '').trim());
    const dataRows = rows.slice(1).filter(r => r.some(c => String(c || '').trim() !== ''));
    setParsed({ headers, rows: dataRows, delimiter });
    // Auto-map: exact match (case-insensitive) to an existing Opps 2
    // column, else "skip". User can override on any row.
    const lowerTargets = new Map(targetOptions.map(t => [t.toLowerCase(), t]));
    const auto = {};
    for (const h of headers) {
      if (!h) continue;
      const hit = lowerTargets.get(h.toLowerCase());
      auto[h] = hit || '';
    }
    setMapping(auto);
  }

  // Build the rows to insert + the list of skip reasons for each
  // pasted row. Mapping decides which source columns flow through;
  // duplicates are detected against existingRecords using the same
  // dedup key the parent uses for the Opps-tab import.
  const analysis = useMemo(() => {
    if (!parsed) return null;
    const additions = [];
    const skipped = [];
    // Map of dedup-key → existing record so a "duplicate" skip can
    // name the existing row, not just the opaque key. Without this,
    // a phantom Opps 2 record (e.g. a row whose Account+Scope match
    // but whose fields look blank in the table) blocks the paste with
    // no breadcrumb back to whatever's matching.
    const existingByKey = new Map();
    for (const r of (existingRecords || [])) {
      const k = dedupKeyFor(r);
      if (k && !existingByKey.has(k)) existingByKey.set(k, r);
    }
    const seenInPaste = new Map();
    for (let i = 0; i < parsed.rows.length; i++) {
      const cells = parsed.rows[i];
      const record = {};
      let hasMappedData = false;
      for (let j = 0; j < parsed.headers.length; j++) {
        const src = parsed.headers[j];
        const target = mapping[src];
        if (!target) continue;
        const val = String(cells[j] ?? '').trim();
        record[target] = val;
        if (val) hasMappedData = true;
      }
      const lineNo = i + 2; // +1 for header row, +1 for 1-indexed display
      if (!hasMappedData) {
        skipped.push({ lineNo, pasteRecord: record, reason: 'Empty row' });
        continue;
      }
      const key = dedupKeyFor(record);
      if (!key) {
        skipped.push({ lineNo, pasteRecord: record, reason: 'Missing dedup key (need BFO Link or Account + Scope + Year)' });
        continue;
      }
      if (existingByKey.has(key)) {
        const existing = existingByKey.get(key);
        // When BFO Link is the thing that matched, a different Account
        // on the paste row almost always means the source columns
        // shifted (e.g. an Account cell that belongs to a different
        // BFO opportunity). Flag the row so the user can remap names
        // or fix the source before re-pasting.
        const pasteAcct = String(record['Account'] || '').trim().toLowerCase();
        const existingAcct = String(existing['Account'] || '').trim().toLowerCase();
        const accountMismatch = key.startsWith('bfo:') && !!pasteAcct && !!existingAcct && pasteAcct !== existingAcct;
        const oppNum = rankById.get(existing._id) ?? existing._id;
        skipped.push({
          lineNo,
          accountMismatch,
          pasteAccount: record['Account'] || '',
          existingAccount: existing['Account'] || '',
          pasteRecord: record,
          existingRecord: existing,
          key,
          reason: `Duplicate opp (opp# ${oppNum})`,
        });
        continue;
      }
      if (seenInPaste.has(key)) {
        skipped.push({
          lineNo,
          pasteRecord: record,
          key,
          reason: `Duplicate opp (paste line ${seenInPaste.get(key)})`,
        });
        continue;
      }
      seenInPaste.set(key, lineNo);
      additions.push(record);
    }
    return { additions, skipped };
  }, [parsed, mapping, existingRecords, dedupKeyFor]);

  // Convert a skipped entry into an addition with `_reviewReason` (and
  // `_existingMatchId` when we know which existing row it collided
  // with). Used in flag-and-import mode so the parent can stamp the
  // Review column and back-reference the existing row.
  function flagSkippedAsAddition(s) {
    let reviewReason;
    if (s.existingRecord) {
      const accountSuffix = s.accountMismatch && s.existingAccount
        ? ` (existing account: "${s.existingAccount}")`
        : '';
      reviewReason = `Possible duplicate of opp# ${rankById.get(s.existingRecord._id) ?? s.existingRecord._id}${accountSuffix}`;
    } else if (s.reason.startsWith('Duplicate opp (paste line')) {
      reviewReason = s.reason.replace(/^Duplicate opp/, 'Possible duplicate');
    } else {
      reviewReason = s.reason;
    }
    const out = { ...(s.pasteRecord || {}), _reviewReason: reviewReason };
    if (s.existingRecord?._id != null) out._existingMatchId = s.existingRecord._id;
    return out;
  }

  const importableCount = analysis
    ? analysis.additions.length + (flagAndImportAll ? analysis.skipped.length : 0)
    : 0;

  async function handleImport() {
    if (!analysis || importableCount === 0) return;
    setImporting(true);
    try {
      const toImport = flagAndImportAll
        ? [...analysis.additions, ...analysis.skipped.map(flagSkippedAsAddition)]
        : analysis.additions;
      await onImport(toImport, parsed.headers, mapping);
    } finally {
      setImporting(false);
    }
  }

  // Build an .xlsx of every skipped row so the user can investigate
  // duplicates outside the modal. Columns: line / reason / dedup key
  // / account mismatch flag, then a Paste vs Existing pair for each
  // mapped target column so it's obvious which fields differ.
  async function handleExportDuplicates() {
    if (!analysis || analysis.skipped.length === 0) return;
    const { Workbook } = await import('exceljs');
    const wb = new Workbook();
    const ws = wb.addWorksheet('Skipped rows');
    const mappedTargets = Array.from(new Set(
      Object.values(mapping || {}).filter(Boolean)
    ));
    const baseCols = [
      { header: 'Source line', key: '_lineNo', width: 12 },
      { header: 'Reason', key: '_reason', width: 28 },
      { header: 'Account mismatch (existing)', key: '_mismatch', width: 36 },
    ];
    const pairCols = mappedTargets.flatMap(t => [
      { header: `Paste · ${t}`, key: `paste__${t}`, width: 22 },
      { header: `Existing · ${t}`, key: `existing__${t}`, width: 22 },
    ]);
    ws.columns = [...baseCols, ...pairCols];
    ws.getRow(1).font = { bold: true };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
    for (const s of analysis.skipped) {
      const row = {
        _lineNo: s.lineNo,
        _reason: s.reason,
        _mismatch: s.accountMismatch ? (s.existingAccount || '(blank)') : '',
      };
      for (const t of mappedTargets) {
        row[`paste__${t}`] = s.pasteRecord ? (s.pasteRecord[t] ?? '') : '';
        row[`existing__${t}`] = s.existingRecord ? (s.existingRecord[t] ?? '') : '';
      }
      const added = ws.addRow(row);
      if (s.accountMismatch) {
        added.eachCell({ includeEmpty: true }, cell => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } };
        });
      }
    }
    ws.autoFilter = {
      from: { row: 1, column: 1 },
      to:   { row: 1 + analysis.skipped.length, column: ws.columns.length },
    };
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Opps2 bulk import - skipped rows - ${new Date().toISOString().slice(0, 10)}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  const mappedCount = useMemo(() => {
    if (!parsed) return 0;
    return parsed.headers.reduce((n, h) => n + (mapping[h] ? 1 : 0), 0);
  }, [parsed, mapping]);

  return (
    <div
      onClick={importing ? undefined : onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10001,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#fff', borderRadius: 8, padding: '1rem 1.25rem',
          width: 'min(900px, 96vw)', maxHeight: '90vh', overflow: 'auto',
          boxShadow: '0 18px 50px rgba(15, 23, 42, 0.32)',
          display: 'flex', flexDirection: 'column', gap: '0.75rem',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem' }}>
          <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: '#0f172a' }}>Bulk import from a Google Sheet</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={importing}
            aria-label="Close"
            style={{
              background: 'transparent', border: 'none',
              cursor: importing ? 'not-allowed' : 'pointer',
              fontSize: '1.2rem', color: '#64748B', padding: '0 4px', lineHeight: 1,
            }}
          >×</button>
        </div>
        <p style={{ margin: 0, fontSize: '0.78rem', color: '#475569', lineHeight: 1.45 }}>
          Copy a header row + data rows from your Google Sheet and paste below. The modal auto-detects tab or comma separation. Columns with the same name auto-map; tweak the dropdowns to point a source column at a different Opps 2 column, or set it to <em>Skip</em>. Duplicates against existing Opps 2 rows are skipped (same dedup as Import from Opps tab).
        </p>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Paste here…"
          rows={6}
          spellCheck={false}
          style={{
            width: '100%', resize: 'vertical', fontFamily: 'inherit', fontSize: '0.78rem',
            padding: '0.5rem 0.6rem', border: '1px solid var(--color-border)', borderRadius: 6,
            boxSizing: 'border-box',
          }}
        />
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <button
            type="button"
            onClick={handleParse}
            disabled={!text.trim() || importing}
            style={{
              padding: '0.4rem 0.85rem', fontSize: '0.78rem', fontWeight: 600, fontFamily: 'inherit',
              background: '#fff', color: 'var(--color-accent)',
              border: '1px solid var(--color-accent)', borderRadius: 6,
              cursor: (!text.trim() || importing) ? 'not-allowed' : 'pointer',
            }}
          >Parse</button>
          {parsed && (
            <span style={{ fontSize: '0.72rem', color: '#64748B' }}>
              {parsed.rows.length} data row{parsed.rows.length === 1 ? '' : 's'} · {parsed.headers.length} source column{parsed.headers.length === 1 ? '' : 's'} · {mappedCount} mapped · delimiter: {parsed.delimiter === '\t' ? 'tab' : 'comma'}
            </span>
          )}
        </div>

        {parsed && (
          <>
            <div>
              <div style={{ fontSize: '0.78rem', fontWeight: 600, color: '#0f172a', marginBottom: '0.35rem' }}>Column mapping</div>
              <div style={{ maxHeight: 200, overflow: 'auto', border: '1px solid var(--color-border)', borderRadius: 6 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.74rem' }}>
                  <thead>
                    <tr style={{ background: '#F8FAFC' }}>
                      <th style={{ textAlign: 'left', padding: '0.35rem 0.55rem', borderBottom: '1px solid var(--color-border-light)' }}>Source column</th>
                      <th style={{ textAlign: 'left', padding: '0.35rem 0.55rem', borderBottom: '1px solid var(--color-border-light)' }}>→ Opps 2 column</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsed.headers.map((h, idx) => (
                      <tr key={`${h}|${idx}`}>
                        <td style={{ padding: '0.3rem 0.55rem', borderBottom: '1px solid var(--color-border-light)', color: '#0f172a' }}>{h || <span style={{ color: '#94A3B8' }}>(unnamed col {idx + 1})</span>}</td>
                        <td style={{ padding: '0.3rem 0.55rem', borderBottom: '1px solid var(--color-border-light)' }}>
                          <select
                            value={mapping[h] || ''}
                            onChange={(e) => setMapping(prev => ({ ...prev, [h]: e.target.value }))}
                            style={{ width: '100%', fontFamily: 'inherit', fontSize: '0.74rem', padding: '2px 4px' }}
                          >
                            <option value="">— Skip this column —</option>
                            {targetOptions.map(t => (
                              <option key={t} value={t}>{t}</option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {analysis && (() => {
              const mismatchCount = analysis.skipped.filter(s => s.accountMismatch).length;
              const flaggedLabel = flagAndImportAll ? 'flagged for review' : 'skipped';
              const flaggedBg = flagAndImportAll ? '#FFFBEB' : '#FEF3C7';
              const flaggedBorder = flagAndImportAll ? '#FCD34D' : '#FDE68A';
              return (
                <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
                  <div style={{ flex: '1 1 220px', padding: '0.5rem 0.75rem', background: '#ECFDF5', border: '1px solid #A7F3D0', borderRadius: 6 }}>
                    <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#166534' }}>{analysis.additions.length} clean row{analysis.additions.length === 1 ? '' : 's'} will import</div>
                  </div>
                  <div style={{ flex: '1 1 220px', padding: '0.5rem 0.75rem', background: flaggedBg, border: `1px solid ${flaggedBorder}`, borderRadius: 6 }}>
                    <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#92400E' }}>{analysis.skipped.length} row{analysis.skipped.length === 1 ? '' : 's'} {flaggedLabel}</div>
                  </div>
                  {mismatchCount > 0 && (
                    <div style={{ flex: '1 1 220px', padding: '0.5rem 0.75rem', background: '#FEE2E2', border: '1px solid #FCA5A5', borderRadius: 6 }}>
                      <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#991B1B' }}>⚠ {mismatchCount} account name mismatch{mismatchCount === 1 ? '' : 'es'}</div>
                      <div style={{ fontSize: '0.7rem', color: '#7F1D1D', marginTop: 2 }}>BFO Link matched an existing row but the Account differs — check column alignment or remap the names.</div>
                    </div>
                  )}
                </div>
              );
            })()}

            {analysis && analysis.skipped.length > 0 && (
              <label style={{
                display: 'flex', alignItems: 'flex-start', gap: '0.5rem',
                padding: '0.5rem 0.75rem', background: '#FFFBEB',
                border: '1px solid #FCD34D', borderRadius: 6,
                fontSize: '0.75rem', color: '#7C2D12', cursor: 'pointer',
              }}>
                <input
                  type="checkbox"
                  checked={flagAndImportAll}
                  onChange={(e) => setFlagAndImportAll(e.target.checked)}
                  style={{ marginTop: 2 }}
                />
                <span>
                  <strong>Import the {analysis.skipped.length} skipped row{analysis.skipped.length === 1 ? '' : 's'} anyway and flag them for review.</strong>
                  {' '}A <code>Review</code> column will be added (if it doesn't exist) and populated with the reason on each flagged row. Existing rows that look like duplicates of an imported row also get a back-reference note so you can audit them on Opps2. Clear the cell once you've checked it.
                </span>
              </label>
            )}

            {analysis && analysis.skipped.length > 0 && (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem', gap: '0.5rem' }}>
                  <div style={{ fontSize: '0.78rem', fontWeight: 600, color: '#0f172a' }}>
                    Skipped rows — source line{analysis.skipped.length === 1 ? '' : 's'} {analysis.skipped.map(s => s.lineNo).join(', ')}
                  </div>
                  <button
                    type="button"
                    onClick={handleExportDuplicates}
                    title="Download an .xlsx of every skipped row with paste vs existing values"
                    style={{
                      padding: '0.3rem 0.7rem', fontSize: '0.72rem', fontWeight: 600, fontFamily: 'inherit',
                      background: '#fff', color: 'var(--color-accent)',
                      border: '1px solid var(--color-accent)', borderRadius: 6, cursor: 'pointer',
                    }}
                  >Export to Excel</button>
                </div>
                <div style={{ maxHeight: 220, overflow: 'auto', border: '1px solid var(--color-border)', borderRadius: 6 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.72rem' }}>
                    <thead>
                      <tr style={{ background: '#F8FAFC' }}>
                        <th style={{ textAlign: 'left', padding: '0.3rem 0.55rem', width: 80 }}>Source line</th>
                        <th style={{ textAlign: 'left', padding: '0.3rem 0.55rem', width: 280 }}>Account (paste vs existing)</th>
                        <th style={{ textAlign: 'left', padding: '0.3rem 0.55rem' }}>Reason</th>
                      </tr>
                    </thead>
                    <tbody>
                      {analysis.skipped.map((s, i) => {
                        const rowBg = s.accountMismatch ? '#FEE2E2' : undefined;
                        const showAccountCell = s.pasteAccount != null || s.existingAccount != null;
                        return (
                          <tr key={i} style={{ background: rowBg }}>
                            <td style={{ padding: '0.25rem 0.55rem', borderBottom: '1px solid var(--color-border-light)', color: '#64748B' }}>{s.lineNo}</td>
                            <td style={{ padding: '0.25rem 0.55rem', borderBottom: '1px solid var(--color-border-light)', color: '#0f172a', whiteSpace: 'normal', wordBreak: 'break-word' }}>
                              {showAccountCell ? (
                                <>
                                  <div><strong>Paste:</strong> {s.pasteAccount || <em style={{ color: '#94A3B8' }}>(blank)</em>}</div>
                                  <div><strong>Existing:</strong> {s.existingAccount || <em style={{ color: '#94A3B8' }}>(blank)</em>}</div>
                                </>
                              ) : <span style={{ color: '#94A3B8' }}>—</span>}
                            </td>
                            <td style={{ padding: '0.25rem 0.55rem', borderBottom: '1px solid var(--color-border-light)', color: '#0f172a', whiteSpace: 'normal', wordBreak: 'break-word' }}>{s.reason}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {analysis && analysis.additions.length > 0 && (
              <div>
                <div style={{ fontSize: '0.78rem', fontWeight: 600, color: '#0f172a', marginBottom: '0.35rem' }}>Preview (first 5)</div>
                <div style={{ maxHeight: 200, overflow: 'auto', border: '1px solid var(--color-border)', borderRadius: 6 }}>
                  <table style={{ borderCollapse: 'collapse', fontSize: '0.7rem', width: '100%' }}>
                    <thead>
                      <tr style={{ background: '#F8FAFC' }}>
                        {targetOptions.filter(t => Object.values(mapping).includes(t)).map(t => (
                          <th key={t} style={{ textAlign: 'left', padding: '0.3rem 0.55rem', whiteSpace: 'nowrap', borderBottom: '1px solid var(--color-border-light)' }}>{t}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {analysis.additions.slice(0, 5).map((row, i) => (
                        <tr key={i}>
                          {targetOptions.filter(t => Object.values(mapping).includes(t)).map(t => (
                            <td key={t} style={{ padding: '0.25rem 0.55rem', borderBottom: '1px solid var(--color-border-light)', whiteSpace: 'nowrap', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }}>{String(row[t] ?? '')}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.5rem' }}>
          <button
            type="button"
            onClick={onClose}
            disabled={importing}
            style={{
              padding: '0.4rem 0.85rem', fontSize: '0.8rem', fontFamily: 'inherit',
              background: '#fff', color: '#475569',
              border: '1px solid var(--color-border)', borderRadius: 6,
              cursor: importing ? 'not-allowed' : 'pointer',
            }}
          >Cancel</button>
          <button
            type="button"
            onClick={handleImport}
            disabled={importing || importableCount === 0}
            style={{
              padding: '0.4rem 0.95rem', fontSize: '0.8rem', fontWeight: 600, fontFamily: 'inherit',
              background: 'var(--color-accent)', color: '#fff',
              border: '1px solid var(--color-accent)', borderRadius: 6,
              cursor: (importing || importableCount === 0) ? 'not-allowed' : 'pointer',
              opacity: (importing || importableCount === 0) ? 0.6 : 1,
            }}
          >{importing ? 'Importing…' : `Import ${importableCount} row${importableCount === 1 ? '' : 's'}`}</button>
        </div>
      </div>
    </div>
  );
}

// Modal opened on double-click of a Next Steps cell. Renders the
// per-step rows as a two-column table (Next Step / Waiting On) so the
// user can edit each entry in place. The notes are flattened back to a
// newline-joined string under 'Next Steps' (keeps search, sort, export,
// and the in-table cell render working), and the parallel waiting-on
// array is stored alongside under '_nextStepsWaiting'.
// Textarea that grows to fit its content so long Next Step notes
// aren't clipped to a single line. Resizes on every value change and
// once on mount so existing rows render at their full height the
// instant the popup opens.
function AutoGrowTextarea({ value, onChange, onBlur, placeholder, style }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return (
    <textarea
      ref={ref}
      style={style}
      value={value}
      onChange={onChange}
      onBlur={onBlur}
      placeholder={placeholder}
      rows={2}
    />
  );
}

function NextStepsEditor({ opp, onClose, updateOppField }) {
  const noteLines = useMemo(() => textToBulletItems(opp?.['Next Steps']), [opp]);
  const storedWaiting = Array.isArray(opp?._nextStepsWaiting) ? opp._nextStepsWaiting : [];
  const initialRows = useMemo(() => {
    const rows = noteLines.map((note, i) => ({ note, waitingOn: String(storedWaiting[i] || '') }));
    return rows.length > 0 ? rows : [{ note: '', waitingOn: '' }];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opp]);
  const [rows, setRows] = useState(initialRows);

  function commit(nextRows) {
    const kept = nextRows.filter(r => (r.note || '').trim() || (r.waitingOn || '').trim());
    const notesText = kept.map(r => (r.note || '').trim()).join('\n');
    const waiting = kept.map(r => (r.waitingOn || '').trim());
    updateOppField(opp._id, 'Next Steps', notesText);
    updateOppField(opp._id, '_nextStepsWaiting', waiting);
  }

  function updateRow(idx, key, value) {
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, [key]: value } : r));
  }

  function addRow() {
    setRows(prev => {
      const next = [...prev, { note: '', waitingOn: '' }];
      commit(next);
      return next;
    });
  }

  function deleteRow(idx) {
    setRows(prev => {
      const next = prev.filter((_, i) => i !== idx);
      const safe = next.length > 0 ? next : [{ note: '', waitingOn: '' }];
      commit(safe);
      return safe;
    });
  }

  const account = String(opp?.['Account'] || '').trim() || '(no account)';
  const inputStyle = {
    width: '100%', padding: '0.4rem 0.5rem', border: '1px solid #CBD5E1',
    borderRadius: 4, fontSize: '0.85rem', fontFamily: 'inherit',
    lineHeight: 1.4, resize: 'vertical', minHeight: 56, background: '#fff',
    overflow: 'hidden',
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10001,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#fff', borderRadius: 8, padding: '1rem 1.25rem',
          width: 'min(1100px, 96vw)', maxHeight: '88vh', overflow: 'auto',
          boxShadow: '0 18px 50px rgba(15, 23, 42, 0.32)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem', gap: '1rem' }}>
          <div style={{ fontSize: '0.95rem', fontWeight: 600, color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            Next Steps — {account}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              fontSize: '1.1rem', color: '#64748B', padding: '0 4px', lineHeight: 1,
            }}
          >×</button>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
          <thead>
            <tr style={{ background: '#F1F5F9', textAlign: 'left', color: '#475569' }}>
              <th style={{ padding: '0.4rem 0.5rem', fontWeight: 600, width: '55%', borderBottom: '1px solid #E2E8F0' }}>Next Step</th>
              <th style={{ padding: '0.4rem 0.5rem', fontWeight: 600, width: '40%', borderBottom: '1px solid #E2E8F0' }}>Waiting On</th>
              <th style={{ width: 32, borderBottom: '1px solid #E2E8F0' }} aria-label="" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => (
              <tr key={idx} style={{ verticalAlign: 'top' }}>
                <td style={{ padding: '0.3rem 0.4rem 0.3rem 0', borderBottom: '1px solid #F1F5F9' }}>
                  <AutoGrowTextarea
                    style={inputStyle}
                    value={row.note}
                    onChange={(e) => updateRow(idx, 'note', e.target.value)}
                    onBlur={() => commit(rows)}
                    placeholder="What needs to happen?"
                  />
                </td>
                <td style={{ padding: '0.3rem 0.4rem', borderBottom: '1px solid #F1F5F9' }}>
                  <AutoGrowTextarea
                    style={inputStyle}
                    value={row.waitingOn}
                    onChange={(e) => updateRow(idx, 'waitingOn', e.target.value)}
                    onBlur={() => commit(rows)}
                    placeholder="Who / what?"
                  />
                </td>
                <td style={{ padding: '0.3rem 0 0.3rem 0.2rem', borderBottom: '1px solid #F1F5F9', textAlign: 'right' }}>
                  <button
                    type="button"
                    onClick={() => deleteRow(idx)}
                    aria-label="Delete step"
                    title="Delete step"
                    style={{
                      background: 'transparent', border: 'none', cursor: 'pointer',
                      color: '#94A3B8', fontSize: '1rem', padding: '0 4px', lineHeight: 1,
                    }}
                  >×</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ marginTop: '0.6rem' }}>
          <button
            type="button"
            onClick={addRow}
            style={{
              padding: '0.35rem 0.7rem', border: '1px solid #BFDBFE', borderRadius: 4,
              background: '#EFF6FF', color: '#1E40AF', fontSize: '0.75rem', fontWeight: 600,
              cursor: 'pointer', fontFamily: 'inherit',
            }}
          >+ Add step</button>
        </div>
      </div>
    </div>
  );
}

export function OppsView2({ settings, updateSettings, prospects = [], updateProspect } = {}) {
  const { user } = useAuth();
  // Seeded with DEFAULT_HEADERS so the table renders columns immediately;
  // the hydration effect below replaces this with the user's saved
  // headers + records once Firestore / IndexedDB returns.
  const [data, setData] = useState({ headers: DEFAULT_HEADERS, records: [] });
  const [loading, setLoading] = useState(true);
  const [error] = useState(null);

  // HubSpot contacts cache feeds the Contact column's per-row picker.
  // Most contact rosters live here (not on the prospect record), so
  // pull from this cache and re-pull whenever the HubSpot view emits
  // a refresh event.
  const [hubspotContacts, setHubspotContacts] = useState([]);
  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      getHubspotContacts()
        .then(list => { if (!cancelled) setHubspotContacts(Array.isArray(list) ? list : []); })
        .catch(() => { if (!cancelled) setHubspotContacts([]); });
    };
    refresh();
    window.addEventListener('hubspot-cache-updated', refresh);
    return () => {
      cancelled = true;
      window.removeEventListener('hubspot-cache-updated', refresh);
    };
  }, []);

  // Per-Pricing-Option services bundle, used by the Scope cell to
  // offer an "Add from Pricing Option" bulk-add. PricingView keeps a
  // pre-derived copy in IndexedDB, but we also fall back to deriving
  // from the raw cached workbook + Line Item → Services mapping —
  // otherwise the picker would be empty whenever the user lands on
  // Opps 2 without having opened the Pricing tab in this session.
  // Map of `oppId → Pricing Option name` owned by the Pricing tab.
  // We render the "Pricing Option" column from this map so the link
  // lives in one place — saving from Pricing or clearing from here
  // both go through `setOppOptionLink`.
  const [optionLinks, setOptionLinks] = useState({});
  useEffect(() => {
    let cancelled = false;
    loadOptionLinks().then(val => { if (!cancelled) setOptionLinks(val || {}); });
    const onChange = (e) => {
      const detail = e?.detail;
      if (detail && typeof detail === 'object') setOptionLinks(detail);
    };
    window.addEventListener(OPTION_LINKS_EVENT, onChange);
    return () => {
      cancelled = true;
      window.removeEventListener(OPTION_LINKS_EVENT, onChange);
    };
  }, []);
  const [pricingOptionServicesCache, setPricingOptionServicesCache] = useState({});
  const [pricingWorkbook, setPricingWorkbook] = useState(null);
  const [lineItemServices, setLineItemServices] = useState({});
  useEffect(() => {
    let cancelled = false;
    const loadWorkbook = () => dbGet('pricing-cache', 'current')
      .then(val => { if (!cancelled && val && val.workbook) setPricingWorkbook(val.workbook); })
      .catch(() => {});
    const loadMapping = () => dbGet('pricing-cache', 'lineItemServices')
      .then(val => { if (!cancelled && val && typeof val === 'object') setLineItemServices(val); })
      .catch(() => {});
    const loadDerived = () => dbGet('pricing-cache', 'pricingOptionServices')
      .then(val => { if (!cancelled && val && typeof val === 'object') setPricingOptionServicesCache(val); })
      .catch(() => {});
    loadWorkbook();
    loadMapping();
    loadDerived();
    const onMapping = (e) => {
      const detail = e?.detail;
      if (detail && typeof detail === 'object') setLineItemServices(detail); else loadMapping();
    };
    const onDerived = (e) => {
      const detail = e?.detail;
      if (detail && typeof detail === 'object') setPricingOptionServicesCache(detail); else loadDerived();
      // Workbook changes ride along with derived-bundle changes — refresh.
      loadWorkbook();
    };
    window.addEventListener('pricing:lineItemServicesChanged', onMapping);
    window.addEventListener('pricing:optionServicesChanged', onDerived);
    return () => {
      cancelled = true;
      window.removeEventListener('pricing:lineItemServicesChanged', onMapping);
      window.removeEventListener('pricing:optionServicesChanged', onDerived);
    };
  }, []);

  const pricingOptionServices = useMemo(() => {
    // Local derivation always wins when a workbook is in the cache —
    // it can't be stale relative to the inputs in this tab. The
    // pre-derived copy is only used when the workbook is missing
    // (e.g. PricingView populated it but the cache has since been
    // partially cleared, or a cross-tab edit beat us to it).
    if (pricingWorkbook && Array.isArray(pricingWorkbook.options) && pricingWorkbook.options.length > 0) {
      const out = {};
      for (const o of pricingWorkbook.options) {
        const seen = new Set();
        const services = [];
        for (const sec of (o.sections || [])) {
          for (const item of (sec.items || [])) {
            const key = String(item.description || '').trim().toLowerCase();
            const mapped = key ? lineItemServices?.[key] : null;
            if (!Array.isArray(mapped)) continue;
            for (const s of mapped) {
              const k = String(s || '').toLowerCase();
              if (!k || seen.has(k)) continue;
              seen.add(k);
              services.push(s);
            }
          }
        }
        out[o.sheetName] = services;
      }
      return out;
    }
    return pricingOptionServicesCache;
  }, [pricingWorkbook, lineItemServices, pricingOptionServicesCache]);
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
  const [showHiddenByFilter, setShowHiddenByFilter] = useState(false);
  // Rows that don't have an active Call In number (no Follow Up date,
  // or the value was manually cleared) are treated as "history" — they
  // aren't on a callback schedule and don't need to render alongside
  // active opps. Hidden by default so the page loads fewer rows;
  // surfaced on demand via the "Show history" button.
  const [hideHistory, setHideHistory] = useState(true);
  // Days-in-Stage kanban — Not Started rows are often noise (intake
  // backlog), so we let the user hide that column without losing the
  // data. Defaulted to visible so the column is discoverable.
  const [hideNotStarted, setHideNotStarted] = useState(false);
  const servicesDefaultAppliedRef = useRef(false);
  useEffect(() => {
    if (activeTab === 'services' && !servicesDefaultAppliedRef.current) {
      servicesDefaultAppliedRef.current = true;
      setActivityFilter(prev => (prev === 'all' ? 'active' : prev));
    }
  }, [activeTab]);
  const [hiddenServices, setHiddenServices] = useState(() => new Set());
  const [showHidden, setShowHidden] = useState(false);
  const [linkModalOpen, setLinkModalOpen] = useState(false);
  // null when idle; { account } when the user clicked + New Opp (or
  // committed the Add Company combobox) and the Source-picker modal
  // is open. Account flows through so the modal can show "Adding
  // <company>" when the company is already known.
  const [pendingNewOpp, setPendingNewOpp] = useState(null);
  // _id of the opp whose info popup is open, or null when no popup
  // is showing. Resolved against the live records list on render so
  // the popup always reflects the latest cell edits.
  const [infoOppId, setInfoOppId] = useState(null);
  // Double-clicking the Next Steps cell opens a read-only popup showing
  // the full value (useful when the column is narrow and the entry
  // spans multiple Alt+Enter lines).
  const [nextStepsPopupId, setNextStepsPopupId] = useState(null);
  useEffect(() => {
    if (nextStepsPopupId == null) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setNextStepsPopupId(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [nextStepsPopupId]);
  // Mass-edit selection — set of row _id's the user has checked. The
  // mass-edit toolbar shows whenever this is non-empty.
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  // Mass-edit mode. The checkbox column is only rendered (and the
  // bulk toolbar is only available) while this is on, so the default
  // view is uncluttered.
  const [massEditOn, setMassEditOn] = useState(false);
  // _ids of rows that DataTable is currently showing (after column
  // filters / search). Lets the select-column header offer a
  // "select all rows in the current filter" checkbox so the user
  // can mass-edit a filtered subset without per-row clicking.
  const [filteredRowIds, setFilteredRowIds] = useState(() => new Set());
  // When on, the table view is narrowed to just the rows the user has
  // ticked. The button only renders when there's at least one
  // selection, and we auto-flip back off as soon as the selection is
  // cleared (so the table doesn't go empty under the user).
  const [showOnlySelected, setShowOnlySelected] = useState(false);
  const handleFilteredRowsChange = useCallback((rows) => {
    setFilteredRowIds(prev => {
      const next = new Set();
      for (const r of (rows || [])) if (r?._id != null) next.add(r._id);
      if (prev.size === next.size) {
        let same = true;
        for (const id of prev) if (!next.has(id)) { same = false; break; }
        if (same) return prev;
      }
      return next;
    });
  }, []);
  // The HubSpot contact currently open in the rich ContactEditModal,
  // launched when the user clicks a tagged-contact name on the
  // Contact cell's popover. Null when no modal is open.
  const [editingContact, setEditingContact] = useState(null);
  useEffect(() => {
    if (showOnlySelected && selectedIds.size === 0) setShowOnlySelected(false);
  }, [showOnlySelected, selectedIds]);
  // Set while the "Import from Opps tab" one-time copy is running so
  // the button locks out double-clicks and shows a "Importing…"
  // label.
  const [importingFromOpps, setImportingFromOpps] = useState(false);
  const [bulkImportOpen, setBulkImportOpen] = useState(false);

  // Dedup key for the Opps → Opps 2 one-time import. BFO Link is the
  // natural unique id; for rows that lack one we fall back to a
  // composite of Account + Open Year + Scope + Start Date so a
  // legacy hand-typed Opps 2 entry doesn't get blocked by a fuzzy
  // match against a Google-Sheets row with the same Account in a
  // different year.
  const oppDedupKeyForImport = useCallback((r) => {
    if (!r) return '';
    const bfo = String(r['BFO Link'] || '').trim().toLowerCase();
    if (bfo && bfo !== '-' && bfo !== '#n/a') return `bfo:${bfo}`;
    const acct = String(r['Account'] || '').trim().toLowerCase();
    const year = String(r['Open Year'] || '').trim();
    const scope = String(r['Scope'] || '').trim().toLowerCase();
    const start = String(r['Start Date'] || '').trim();
    if (!acct && !year && !scope && !start) return '';
    return `acct:${acct}|${year}|${scope}|${start}`;
  }, []);

  // One-time copy from the Opps tab's IndexedDB cache into Opps 2.
  // Adds only — every existing Opps 2 record is left exactly as-is.
  // Dedup is by BFO Link (with the composite fallback above), so a
  // re-run only adds rows that are new since the last import. The
  // user is free to re-click this any time they refresh the Opps tab
  // and want the new rows mirrored over.
  const importFromOppsTab = useCallback(async () => {
    if (importingFromOpps) return;
    setImportingFromOpps(true);
    try {
      let opps = null;
      try { opps = await dbGet('opps-cache', 'data'); } catch { /* ignore */ }
      const incoming = Array.isArray(opps?.records) ? opps.records : [];
      if (!incoming.length) {
        window.alert(
          'No Opps tab data found in this browser. Open the Opps tab once so it ' +
          'fetches the Google Sheet, then come back and click Import again.'
        );
        return;
      }
      const baseHeaders = data?.headers?.length ? data.headers : DEFAULT_HEADERS;
      const baseRecords = data?.records || [];
      const existingKeys = new Set();
      for (const r of baseRecords) {
        const k = oppDedupKeyForImport(r);
        if (k) existingKeys.add(k);
      }
      let nextId = baseRecords.reduce((m, r) => Math.max(m, Number(r?._id) || 0), 0);
      const additions = [];
      let skippedDuplicate = 0;
      // Bring everything across — every row the Opps tab cached is fair
      // game. The Opps cache parser already drops rows with no Account
      // and no other data, so we don't need a second guard here. Older
      // versions of this import filtered on Open Year and on having
      // Account-or-BFO Link, which silently dropped legitimate rows
      // (e.g. opps still missing an Open Year value) and produced a
      // smaller Opps 2 dataset than the source Opps tab.
      for (const r of incoming) {
        const key = oppDedupKeyForImport(r);
        if (!key || existingKeys.has(key)) { skippedDuplicate += 1; continue; }
        existingKeys.add(key);
        nextId += 1;
        additions.push({ ...r, _id: nextId, id: nextId, _source: 'opps-import' });
      }
      if (!additions.length) {
        window.alert(
          `Nothing new to import — every Opps tab row (${incoming.length}) is ` +
          `already on Opps 2 (duplicates skipped: ${skippedDuplicate}).`
        );
        return;
      }
      // Union headers so any columns the Opps tab tracks but Opps 2's
      // saved layout doesn't yet know about become selectable from the
      // Columns toggle. Preserve Opps 2's column order.
      const headerSet = new Set(baseHeaders);
      const mergedHeaders = [...baseHeaders];
      for (const h of (opps?.headers || [])) {
        if (h && !headerSet.has(h)) { headerSet.add(h); mergedHeaders.push(h); }
      }
      // Build the next state explicitly so we can persist it
      // synchronously below — relying solely on the debounced
      // save-effect lets a quick refresh / tab switch lose the import
      // (component unmount cancels the pending Firestore write, and on
      // the next load the stale Firestore copy wins over IndexedDB).
      const nextRecords = [...additions, ...(data?.records || [])];
      const nextState = { ...(data || {}), headers: mergedHeaders, records: nextRecords };
      setData(nextState);
      // Cancel any in-flight debounced Firestore save so the explicit
      // write below isn't immediately followed by a stale debounced one.
      if (firestoreSaveTimerRef.current) {
        clearTimeout(firestoreSaveTimerRef.current);
        firestoreSaveTimerRef.current = null;
      }
      await saveOpps2Cache(nextState);
      let firestoreWarning = '';
      if (user?.uid) {
        try {
          await saveOpps2ToFirestore(user.uid, nextState);
        } catch (err) {
          console.error('Import from Opps tab: Firestore save failed:', err);
          firestoreWarning = `\n\nWarning: cross-device sync failed (${err?.message || err}). Rows are safe on this device — hydration now picks the newer of IndexedDB vs Firestore, so a refresh here will keep them.`;
        }
      }
      window.alert(
        `Imported ${additions.length} row${additions.length === 1 ? '' : 's'} ` +
        `from the Opps tab. Skipped ${skippedDuplicate} already on Opps 2.${firestoreWarning}`
      );
    } catch (err) {
      console.error('Import from Opps tab failed:', err);
      window.alert(`Import failed: ${err?.message || err}`);
    } finally {
      setImportingFromOpps(false);
    }
  }, [importingFromOpps, data, oppDedupKeyForImport, user?.uid]);

  // Commit a batch of rows produced by the Bulk Import modal. The
  // modal has already done dedup + column mapping; we just splice the
  // additions into state and persist synchronously (same shape as the
  // Import-from-Opps path so refresh / tab-switch can't drop the
  // writes). New columns from the source paste merge into the Opps 2
  // header set so they're selectable from the Columns toggle.
  const commitBulkImport = useCallback(async (additions, sourceHeaders, mapping) => {
    if (!Array.isArray(additions) || additions.length === 0) return;
    const baseHeaders = data?.headers?.length ? data.headers : DEFAULT_HEADERS;
    const baseRecords = data?.records || [];
    const headerSet = new Set(baseHeaders);
    const mergedHeaders = [...baseHeaders];
    // The mapping values are the target Opps 2 columns; any new ones
    // (e.g. a sheet column the user mapped to a custom Opps 2 column)
    // get appended so they show up in the column toggle.
    for (const target of Object.values(mapping || {})) {
      if (target && !headerSet.has(target)) { headerSet.add(target); mergedHeaders.push(target); }
    }
    // Flag-and-import mode: rows arrive carrying `_reviewReason` (and,
    // for duplicate-of-existing rows, `_existingMatchId`). Stamp the
    // Review column on the new rows and post a back-reference Review
    // note on the existing rows so the user can audit collisions
    // in-place.
    const anyFlagged = additions.some(r => r?._reviewReason);
    if (anyFlagged && !headerSet.has('Review')) {
      headerSet.add('Review');
      mergedHeaders.push('Review');
    }
    let nextId = baseRecords.reduce((m, r) => Math.max(m, Number(r?._id) || 0), 0);
    // Map of existing _id → list of new opp ranks that point at it,
    // so a single existing row that collides with multiple imported
    // rows lists every match instead of overwriting.
    const existingFlagsByMatchId = new Map();
    // Display rank = position in the ascending sort of all _ids
    // (matches the Opp # column). After import: existing ranks stay
    // the same; new ones get baseRecords.length + 1 onward (since
    // they have the highest _ids).
    const baseExistingCount = baseRecords.filter(r => r?._id != null).length;
    const stamped = additions.map((r, idx) => {
      const id = ++nextId;
      const newRank = baseExistingCount + idx + 1;
      const { _reviewReason, _existingMatchId, ...rest } = r;
      const out = { ...rest, _id: id, id, _source: 'bulk-import' };
      if (_reviewReason) out['Review'] = _reviewReason;
      if (_existingMatchId != null) {
        const list = existingFlagsByMatchId.get(_existingMatchId) || [];
        list.push(newRank);
        existingFlagsByMatchId.set(_existingMatchId, list);
      }
      return out;
    });
    const flaggedExistingRecords = existingFlagsByMatchId.size > 0
      ? baseRecords.map(r => {
          const matches = existingFlagsByMatchId.get(r?._id);
          if (!matches?.length) return r;
          const label = matches.length === 1
            ? `Possible duplicate of imported opp# ${matches[0]}`
            : `Possible duplicate of imported opps# ${matches.join(', ')}`;
          const existing = String(r['Review'] || '').trim();
          const next = existing ? `${existing} · ${label}` : label;
          return { ...r, Review: next };
        })
      : baseRecords;
    const nextRecords = [...stamped, ...flaggedExistingRecords];
    const nextState = { ...(data || {}), headers: mergedHeaders, records: nextRecords };
    setData(nextState);
    if (firestoreSaveTimerRef.current) {
      clearTimeout(firestoreSaveTimerRef.current);
      firestoreSaveTimerRef.current = null;
    }
    await saveOpps2Cache(nextState);
    let firestoreWarning = '';
    if (user?.uid) {
      try {
        await saveOpps2ToFirestore(user.uid, nextState);
      } catch (err) {
        console.error('Bulk import: Firestore save failed:', err);
        firestoreWarning = `\n\nWarning: cross-device sync failed (${err?.message || err}). Rows are safe on this device.`;
      }
    }
    setBulkImportOpen(false);
    // Suppress unused-arg lint — sourceHeaders is informational only.
    void sourceHeaders;
    const flaggedNewCount = additions.filter(r => r?._reviewReason).length;
    const flaggedExistingCount = existingFlagsByMatchId.size;
    const flagSuffix = flaggedNewCount > 0
      ? `\n\nFlagged for review: ${flaggedNewCount} imported row${flaggedNewCount === 1 ? '' : 's'}${flaggedExistingCount > 0 ? ` + ${flaggedExistingCount} existing row${flaggedExistingCount === 1 ? '' : 's'}` : ''}. Look in the Review column.`
      : '';
    window.alert(`Imported ${additions.length} row${additions.length === 1 ? '' : 's'} from the pasted sheet.${flagSuffix}${firestoreWarning}`);
  }, [data, user?.uid]);

  // Look the tagged contact's full HubSpot record up by email (most
  // reliable) and fall back to a case-insensitive name match. When
  // nothing matches, fabricate a minimal record so ContactEditModal
  // can still display the name + email the user already had visible.
  const openContactDetails = useCallback((name, email) => {
    const normEmail = String(email || '').trim().toLowerCase();
    const normName = String(name || '').trim().toLowerCase();
    let found = null;
    if (normEmail) {
      found = (hubspotContacts || []).find(c => String(c?.email || '').trim().toLowerCase() === normEmail);
    }
    if (!found && normName) {
      found = (hubspotContacts || []).find(c => {
        const cName = [c?.firstname, c?.lastname].filter(Boolean).join(' ').trim().toLowerCase();
        return cName === normName;
      });
    }
    if (!found) {
      const parts = String(name || '').trim().split(/\s+/);
      found = {
        firstname: parts[0] || '',
        lastname: parts.slice(1).join(' ') || '',
        email: email || '',
      };
    }
    setEditingContact(found);
  }, [hubspotContacts]);

  // ContactEditModal saves through these handlers so per-contact
  // notes / nicknames / etc. land in the same Firestore settings
  // maps every other view writes to (Key Contacts uses the same
  // set). `silent` saves come from the modal's tag-autosave path —
  // don't close the modal in that case.
  const closeContactModal = useCallback((updated, opts) => {
    if (!opts?.silent) setEditingContact(null);
    void updated;
  }, []);
  const saveContactNote = useCallback((cid, note) => {
    const cur = settings?.contactNotes || {};
    const next = { ...cur };
    if (note && note.trim()) next[cid] = note; else delete next[cid];
    updateSettings({ contactNotes: next });
  }, [settings?.contactNotes, updateSettings]);
  const saveContactOldEmails = useCallback((cid, val) => {
    const cur = settings?.contactOldEmails || {};
    const next = { ...cur };
    if (val && val.trim()) next[cid] = val; else delete next[cid];
    updateSettings({ contactOldEmails: next });
  }, [settings?.contactOldEmails, updateSettings]);
  const saveContactNickname = useCallback((cid, val) => {
    const cur = settings?.contactNicknames || {};
    const next = { ...cur };
    if (val && val.trim()) next[cid] = val; else delete next[cid];
    updateSettings({ contactNicknames: next });
  }, [settings?.contactNicknames, updateSettings]);
  const saveContactTeamName = useCallback((cid, val) => {
    const cur = settings?.contactTeamNames || {};
    const next = { ...cur };
    if (val && val.trim()) next[cid] = val.trim(); else delete next[cid];
    updateSettings({ contactTeamNames: next });
  }, [settings?.contactTeamNames, updateSettings]);
  const saveContactReportsTo = useCallback((cid, managerIds) => {
    const cur = settings?.contactReportsTo || {};
    const next = { ...cur };
    const arr = Array.isArray(managerIds)
      ? managerIds.filter(Boolean).map(String)
      : (managerIds ? [String(managerIds)] : []);
    if (arr.length > 0) next[cid] = arr; else delete next[cid];
    updateSettings({ contactReportsTo: next });
  }, [settings?.contactReportsTo, updateSettings]);
  const saveContactFamily = useCallback((cid, info) => {
    const cur = settings?.contactFamilies || {};
    const next = { ...cur };
    const partner = String(info?.partner || '').trim();
    const kids = String(info?.kids || '').trim();
    if (!partner && !kids) delete next[cid];
    else next[cid] = { partner, kids };
    updateSettings({ contactFamilies: next });
  }, [settings?.contactFamilies, updateSettings]);

  // Hydration — load the user's saved opps. Both stores are kicked off
  // in parallel, but we paint whichever resolves first (IndexedDB
  // almost always wins) so the table is visible before the Firestore
  // round-trip lands. Once both are in we reconcile by `_updatedAt` and
  // merge any IDB-only Pricing-Option snapshots, same as before.
  useEffect(() => {
    if (!user?.uid) {
      // Logged-out / pre-auth: keep the seed but don't enable saves
      // (we'd hit the dbPut scoping guard).
      setLoading(false);
      return;
    }
    let cancelled = false;
    let painted = false;
    hydratedRef.current = false;
    setLoading(true);

    function applyResult(next) {
      const headerSet = new Set((next.headers || []).map(h => String(h || '').trim()).filter(Boolean));
      const extra = ENSURED_COLUMNS.filter(c => !headerSet.has(c));
      let withCols = extra.length ? { ...next, headers: [...(next.headers || []), ...extra] } : next;
      // Initial-load only: order rows by Call In ascending so the most
      // urgent rows land at the top. Once hydratedRef flips true (after
      // reconcile finishes), every later setData skips this branch so
      // edits don't reorder rows mid-keystroke.
      if (!hydratedRef.current) {
        withCols = { ...withCols, records: sortRecordsByCallInAsc(withCols.records || []) };
      }
      setData(withCols);
      painted = true;
    }

    const fsPromise = loadOpps2FromFirestore(user.uid);
    const idbPromise = loadOpps2Cache();

    let fromFs = null;
    let fromIdb = null;
    let fsDone = false;
    let idbDone = false;

    function reconcile() {
      if (cancelled || !fsDone || !idbDone) return;
      // Read both stores so we can carry over Pricing-Option snapshots
      // written by the Pricing tab into IDB but not yet replicated to
      // Firestore. Without this safety net, a stale Firestore copy
      // would clobber the snapshot on `saveOpps2Cache`.
      const fsHas = fromFs && (Array.isArray(fromFs.records) || Array.isArray(fromFs.headers));
      const idbHas = fromIdb && (Array.isArray(fromIdb.records) || Array.isArray(fromIdb.headers));
      const fsTs = Number(fromFs?._updatedAt) || 0;
      const idbTs = Number(fromIdb?._updatedAt) || 0;
      const preferIdb = idbHas && (!fsHas || idbTs > fsTs);
      let next = null;
      if (preferIdb) {
        next = fromIdb;
        // Push the IDB copy back to Firestore so the cloud catches up
        // to whatever local writes never made the round trip.
        trySaveOpps2ToFirestore(user.uid, next);
      } else if (fsHas) {
        next = fromFs;
        // Any record on IDB that already carries a `_pricingOption`
        // snapshot wins over the Firestore version of that record,
        // since the snapshot was likely written by the Pricing tab
        // seconds before this hydration.
        const idbById = new Map();
        for (const r of (fromIdb?.records || [])) {
          if (r?._id != null) idbById.set(String(r._id), r);
        }
        let touched = false;
        const reconciled = (next.records || []).map(r => {
          const idbRow = idbById.get(String(r?._id));
          if (idbRow?._pricingOption && !r?._pricingOption) {
            touched = true;
            return {
              ...r,
              _pricingOption: idbRow._pricingOption,
              'Quoted Amount': idbRow['Quoted Amount'] ?? r['Quoted Amount'],
            };
          }
          return r;
        });
        if (touched) next = { ...next, records: reconciled };
        saveOpps2Cache(next);
      }
      if (next) applyResult(next);
      setLoading(false);
      hydratedRef.current = true;
    }

    idbPromise.then(res => {
      if (cancelled) return;
      fromIdb = res;
      idbDone = true;
      // Render-while-fetching: paint the local cache the moment it
      // lands so the user sees the table before Firestore resolves.
      const idbHas = res && (Array.isArray(res.records) || Array.isArray(res.headers));
      if (!painted && idbHas) {
        applyResult(res);
        setLoading(false);
      }
      reconcile();
    }).catch(() => { idbDone = true; reconcile(); });

    fsPromise.then(res => {
      if (cancelled) return;
      fromFs = res;
      fsDone = true;
      // Cold-cache case: IDB had nothing, FS arrived first. Paint it
      // before the IDB read returns so we're not waiting on either.
      const fsHas = res && (Array.isArray(res.records) || Array.isArray(res.headers));
      if (!painted && fsHas) {
        applyResult(res);
        setLoading(false);
      }
      reconcile();
    }).catch(() => { fsDone = true; reconcile(); });

    return () => { cancelled = true; };
  }, [user?.uid]);

  // The Pricing → Options tab writes the snapshot directly into our
  // IndexedDB cache (so it survives a Pricing tab Clear) — when that
  // happens, patch the affected row in place. Reading the whole cache
  // back here would risk clobbering an in-flight cell edit that's only
  // in component state but not yet flushed to IDB.
  useEffect(() => {
    if (!user?.uid) return;
    function onSnapshotChanged(e) {
      if (!hydratedRef.current) return;
      const detail = e?.detail;
      if (!detail || detail.oppId == null) return;
      setData(prev => {
        const records = prev?.records || [];
        const idx = records.findIndex(r => String(r._id) === String(detail.oppId));
        if (idx === -1) return prev;
        const updates = detail.record || {};
        const merged = { ...records[idx] };
        if ('_pricingOption' in updates) merged._pricingOption = updates._pricingOption || null;
        if ('Quoted Amount' in updates) merged['Quoted Amount'] = updates['Quoted Amount'];
        const next = records.slice();
        next[idx] = merged;
        return { ...prev, records: next };
      });
    }
    window.addEventListener(OPPS_PRICING_SNAPSHOT_EVENT, onSnapshotChanged);
    return () => window.removeEventListener(OPPS_PRICING_SNAPSHOT_EVENT, onSnapshotChanged);
  }, [user?.uid]);

  // Track the latest data + uid in refs so the unmount-flush effect
  // (which only runs on mount/unmount) can read the most recent values
  // without re-subscribing on every keystroke.
  const latestDataRef = useRef(data);
  const latestUidRef = useRef(user?.uid);
  useEffect(() => { latestDataRef.current = data; }, [data]);
  useEffect(() => { latestUidRef.current = user?.uid; }, [user?.uid]);

  // Persistence — IndexedDB writes immediately (cheap, survives
  // reload), Firestore writes are debounced 1.5s so a flurry of cell
  // edits collapses into a single round-trip.
  useEffect(() => {
    if (!hydratedRef.current) return;
    saveOpps2Cache(data);
    if (!user?.uid) return;
    if (firestoreSaveTimerRef.current) clearTimeout(firestoreSaveTimerRef.current);
    firestoreSaveTimerRef.current = setTimeout(() => {
      trySaveOpps2ToFirestore(user.uid, data);
    }, 1500);
    return () => {
      if (firestoreSaveTimerRef.current) clearTimeout(firestoreSaveTimerRef.current);
    };
  }, [data, user?.uid]);

  // Flush any pending Firestore save on unmount — without this, a
  // user who clicks Import (or makes a quick edit) and then switches
  // tabs inside the 1.5s debounce window loses the write. On next
  // hydration the stale Firestore copy wins over the up-to-date IDB
  // cache, so the change appears to vanish.
  useEffect(() => {
    return () => {
      if (firestoreSaveTimerRef.current && latestUidRef.current) {
        clearTimeout(firestoreSaveTimerRef.current);
        firestoreSaveTimerRef.current = null;
        trySaveOpps2ToFirestore(latestUidRef.current, latestDataRef.current);
      }
    };
  }, []);

  // Flush any pending Firestore save when the tab is closed / reloaded
  // so the last keystroke before a reload still survives the round
  // trip.
  useEffect(() => {
    function flush() {
      if (firestoreSaveTimerRef.current && user?.uid) {
        clearTimeout(firestoreSaveTimerRef.current);
        firestoreSaveTimerRef.current = null;
        trySaveOpps2ToFirestore(user.uid, data);
      }
    }
    window.addEventListener('beforeunload', flush);
    return () => window.removeEventListener('beforeunload', flush);
  }, [data, user?.uid]);

  const addNewOpp = useCallback((accountName, source) => {
    setData(prev => {
      const records = prev?.records || [];
      const headers = prev?.headers?.length ? prev.headers : DEFAULT_HEADERS;
      const nextId = records.reduce((m, r) => Math.max(m, r._id || 0), 0) + 1;
      return { ...prev, headers, records: [makeBlankOpp(nextId, headers, accountName, source), ...records] };
    });
  }, []);

  // ---- Undo stack -------------------------------------------------
  // In-memory history of the last UNDO_LIMIT cell mutations. Each
  // updateOppField / deleteOppField call snapshots the prior value
  // (including the sibling columns that get dropped as a side effect)
  // and pushes it here; the Undo button + Ctrl/Cmd+Z pop the top
  // entry and re-apply it via a private mutator that doesn't push
  // back onto the stack. Resets on reload because it's React state
  // only — Firestore + IndexedDB persist the *current* row state, not
  // its history.
  const UNDO_LIMIT = 50;
  const dataRef = useRef(data);
  useEffect(() => { dataRef.current = data; }, [data]);
  const [undoStack, setUndoStack] = useState([]);
  const pushUndoEntry = useCallback((entry) => {
    if (!entry || !entry.fields?.length) return;
    setUndoStack(prev => {
      const next = [...prev, entry];
      if (next.length > UNDO_LIMIT) next.shift();
      return next;
    });
  }, []);
  const undoLastChange = useCallback(() => {
    setUndoStack(prev => {
      if (!prev.length) return prev;
      const entry = prev[prev.length - 1];
      setData(d => {
        const records = d?.records || [];
        return {
          ...d,
          records: records.map(r => {
            if (r._id !== entry.id) return r;
            const next = { ...r };
            for (const f of entry.fields) {
              if (f.hadField) next[f.field] = f.prevValue;
              else delete next[f.field];
            }
            return next;
          }),
        };
      });
      return prev.slice(0, -1);
    });
  }, []);
  // Global Cmd/Ctrl+Z. Skipped when the user has an input/textarea
  // focused so the browser's native text-undo still works mid-edit;
  // the toolbar button stays available either way.
  useEffect(() => {
    function onKeyDown(e) {
      const meta = e.ctrlKey || e.metaKey;
      if (!meta || e.shiftKey || e.altKey) return;
      if ((e.key || '').toLowerCase() !== 'z') return;
      const ae = document.activeElement;
      const tag = (ae?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || ae?.isContentEditable) return;
      e.preventDefault();
      undoLastChange();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [undoLastChange]);

  const updateOppField = useCallback((id, field, value) => {
    // Snapshot the prior cell state before the mutation so the Undo
    // stack can restore it. We also snapshot the sibling columns that
    // are dropped as a side effect (Follow Up → Call In, Last Client
    // Heard From Us → Last Spoke) so a single undo restores all of
    // them in one step instead of leaving the user to chase the
    // computed column back to life via "+ add".
    const row = (dataRef.current?.records || []).find(r => r._id === id);
    const stageChanged = !!row && field === 'Stage' && String(row[field] ?? '') !== String(value ?? '');
    if (row) {
      const snap = (f) => ({ field: f, hadField: f in row, prevValue: f in row ? row[f] : undefined });
      const fields = [snap(field)];
      if (field === 'Follow Up' && 'Call In' in row) fields.push(snap('Call In'));
      if (field === 'Last Client Heard From Us' && 'Last Spoke' in row) fields.push(snap('Last Spoke'));
      // Days-in-Stage reads `_stageEnteredAt`; snapshot it alongside the
      // Stage edit so an undo restores both in one step.
      if (stageChanged) fields.push(snap('_stageEnteredAt'));
      pushUndoEntry({ id, fields });
    }
    setData(prev => {
      const records = prev?.records || [];
      return {
        ...prev,
        records: records.map(r => {
          if (r._id !== id) return r;
          const next = { ...r, [field]: value };
          // When the source date for a computed column changes, drop
          // any sheet-imported stored value on the computed column so
          // the render falls back to a live recompute. Without this, an
          // imported row that arrived with a blank Call In would stay
          // blank forever even after the user picks a new Follow Up.
          if (field === 'Follow Up' && 'Call In' in next) delete next['Call In'];
          if (field === 'Last Client Heard From Us' && 'Last Spoke' in next) delete next['Last Spoke'];
          // Stamp the stage-entry date whenever Stage flips to a new
          // value so Days-in-Stage measures "time since the last move"
          // rather than the row's age.
          if (stageChanged) next._stageEnteredAt = todayISO();
          return next;
        }),
      };
    });
  }, [pushUndoEntry]);

  // Drop a field entirely from a row. Used to clear a user-set Call In
  // override so the live compute from Follow Up takes over again — the
  // sentinel-checking path in resolveComputedDays only ignores the
  // stored value when the key is missing, not just empty.
  const deleteOppField = useCallback((id, field) => {
    const row = (dataRef.current?.records || []).find(r => r._id === id);
    if (row && field in row) {
      pushUndoEntry({ id, fields: [{ field, hadField: true, prevValue: row[field] }] });
    }
    setData(prev => {
      const records = prev?.records || [];
      return {
        ...prev,
        records: records.map(r => {
          if (r._id !== id) return r;
          if (!(field in r)) return r;
          const next = { ...r };
          delete next[field];
          return next;
        }),
      };
    });
  }, [pushUndoEntry]);

  const deleteOpp = useCallback((id) => {
    setData(prev => {
      const records = prev?.records || [];
      return { ...prev, records: records.filter(r => r._id !== id) };
    });
    setSelectedIds(prev => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const updateManyOppFields = useCallback((ids, field, value) => {
    const idSet = ids instanceof Set ? ids : new Set(ids);
    if (!idSet.size || !field) return;
    setData(prev => {
      const records = prev?.records || [];
      const stamp = field === 'Stage' ? todayISO() : null;
      return {
        ...prev,
        records: records.map(r => {
          if (!idSet.has(r._id)) return r;
          const next = { ...r, [field]: value };
          // Same stage-entry stamp the single-row path applies, so bulk
          // moves through Days-in-Stage start the clock at the bulk
          // edit instead of the rows' original Start Date.
          if (stamp && String(r[field] ?? '') !== String(value ?? '')) {
            next._stageEnteredAt = stamp;
          }
          return next;
        }),
      };
    });
  }, []);

  const deleteManyOpps = useCallback((ids) => {
    const idSet = ids instanceof Set ? ids : new Set(ids);
    if (!idSet.size) return;
    setData(prev => {
      const records = prev?.records || [];
      return { ...prev, records: records.filter(r => !idSet.has(r._id)) };
    });
    setSelectedIds(new Set());
  }, []);

  const updateColumnLinks = useCallback((nextLinks) => {
    setData(prev => ({ ...(prev || {}), columnLinks: nextLinks || {} }));
  }, []);

  const toggleHideService = useCallback((scope) => {
    setHiddenServices(prev => {
      const next = new Set(prev);
      if (next.has(scope)) next.delete(scope); else next.add(scope);
      return next;
    });
  }, []);

  const headers = data?.headers || [];
  const columnLinks = data?.columnLinks || {};
  // Effective dropdown vocabulary: built-in lists overlaid with the
  // user's edits from the Dropdowns tab. Recomputed when the user
  // tweaks a list so cells and the Link Columns modal stay in sync.
  const dropdownLists = useMemo(
    () => getEffectiveDropdownLists(settings),
    [settings?.dropdownLists]
  );
  const listRegistry = useMemo(() => buildListRegistry(dropdownLists), [dropdownLists]);
  const availableLists = useMemo(() => buildAvailableLists(dropdownLists), [dropdownLists]);
  const records = useMemo(() => data?.records || [], [data]);

  // Drop any selection ids that no longer match a live record (e.g.
  // after a hydration that replaced records, or a delete that came in
  // through another path). Keeps the mass-edit count honest.
  useEffect(() => {
    setSelectedIds(prev => {
      if (prev.size === 0) return prev;
      const alive = new Set(records.map(r => r._id));
      let changed = false;
      const next = new Set();
      for (const id of prev) {
        if (alive.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [records]);

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

  // Map of opp `_id` → 1..N display rank. Ranks by ascending `_id` so
  // the relative creation order of surviving opps is preserved, but
  // gaps from deleted rows are compacted out — the column reads as a
  // simple count of opps on the page rather than as the raw internal
  // id. Stays a stable per-opp value across sort/filter (it's a
  // property of the row's `_id`, not the rendered position), but does
  // shift when opps are added or deleted.
  const oppNumberById = useMemo(() => {
    const map = new Map();
    const ids = (data?.records || [])
      .map(r => r?._id)
      .filter(id => id != null)
      .sort((a, b) => (Number(a) || 0) - (Number(b) || 0));
    ids.forEach((id, idx) => map.set(id, idx + 1));
    return map;
  }, [data?.records]);

  const columns = useMemo(() => {
    const seen = new Set();
    const mapped = headers
      .filter(h => {
        if (!h || seen.has(h)) return false;
        seen.add(h);
        return true;
      })
      .map(h => ({
        key: h,
        label: h === 'BFO Link' ? 'BFO Opportunity Name' : h,
        defaultWidth: h === 'Notes' ? 250 : h === 'Next Steps' ? 240 : h === 'Account' ? 200 : h === 'BFO Link' ? 220 : h === 'Scope' ? 220 : TRISTATE_COLUMNS.has(h) ? 90 : h.length > 20 ? 160 : 120,
        sticky: h === 'Account',
        // Every cell is click-to-edit so a freshly created opp can be
        // filled in directly. getFilterValue exposes the raw text to
        // the per-column filter so search keeps working on the value
        // the user sees, not the rendered <input>.
        // Computed columns derive from sibling fields (and may honor a
        // sheet-imported literal); surface the live displayed value so
        // search / filter match what the cell actually shows.
        getFilterValue: (row) => {
          if (h === 'Call In') {
            const n = resolveCallIn(row);
            return n == null ? '' : String(n);
          }
          if (h === 'Last Spoke') {
            const n = resolveLastSpoke(row);
            return n == null ? '' : String(n);
          }
          if (h === 'Waiting On') {
            const stacked = (Array.isArray(row._nextStepsWaiting) ? row._nextStepsWaiting : [])
              .map(s => String(s || '').trim())
              .filter(Boolean)
              .join('\n');
            return stacked || String(row[h] ?? '');
          }
          return row[h] ?? '';
        },
        // Sort by the same displayed value — without this, DataTable
        // falls back to the stored (empty / stale) cell and the order
        // doesn't match what you see (e.g. negative "overdue" days
        // wouldn't lead an ascending sort).
        getSortValue: (h === 'Call In' || h === 'Last Spoke')
          ? (row) => (h === 'Call In' ? resolveCallIn(row) : resolveLastSpoke(row))
          : undefined,
        // Call In is derived from Follow Up. If the table re-sorted on
        // every edit, typing a new Follow Up date would yank the row out
        // from under the cursor as its Call In recomputed. Freeze the
        // order at click time so manual triage stays stable — the user
        // re-clicks the header when they want a fresh ranking.
        freezeSortOrder: h === 'Call In' ? true : undefined,
        render: (row) => {
          if (h === 'Call In') {
            // Click-to-clear / click-to-restore. The cell still
            // computes live from Follow Up by default; the user can
            // override to blank per opp (stores a sentinel) and undo
            // that override with the "+ add" affordance.
            return (
              <CallInCell
                row={row}
                onClear={() => updateOppField(row._id, 'Call In', '-')}
                onRestore={() => deleteOppField(row._id, 'Call In')}
              />
            );
          }
          if (TRISTATE_COLUMNS.has(h)) {
            return (
              <TristateCheckCell
                value={row[h]}
                onChange={(v) => updateOppField(row._id, h, v)}
                title={`${h}: blank → ✓ → ✗ → blank`}
              />
            );
          }
          if (h === 'Pricing Option') {
            // Read-only column populated from the Pricing → Options tab.
            // The cell shows the linked option name (or em-dash). A
            // small × button clears the link in place.
            const linked = optionLinks[String(row._id)] || '';
            return (
              <PricingOptionCell
                value={linked}
                onClear={() => setOppOptionLink(row._id, '')}
              />
            );
          }
          if (h === 'Quoted Amount') {
            // When the opp has a Pricing-Option snapshot attached, the
            // cell renders as a hyperlink that opens the Opp details
            // popup (where the snapshot detail lives) and exposes a
            // small ✎ for inline override edits.
            return (
              <QuotedAmountCell
                value={row[h]}
                snapshot={row._pricingOption || null}
                onChange={(v) => updateOppField(row._id, h, v)}
                onViewSnapshot={() => setInfoOppId(row._id)}
              />
            );
          }
          if (h === 'Last Spoke') {
            // Business days since the Last Client Heard From Us date —
            // mirrors the Call In logic above, honoring a sheet-imported
            // blank when present.
            const n = resolveLastSpoke(row);
            return <ComputedCell value={n == null ? '' : n} />;
          }
          if (DATE_COLUMNS.has(h)) {
            return <DateCell value={row[h]} onChange={(v) => updateOppField(row._id, h, v)} />;
          }
          const link = resolveColumnLink(h, columnLinks);
          if (link) {
            const opts = listRegistry.get(link.listKey)?.options || [];
            if (link.mode === 'multi') {
              // Surface the Pricing-tab per-Option services bundle only
              // when this cell's vocabulary is the Solutions catalog
              // (the source of those mappings) — so the quick picker
              // doesn't appear on unrelated multi-select cells the user
              // might bind to other lists.
              const extraGroups = link.listKey === 'solutions'
                ? Object.entries(pricingOptionServices || {})
                    .map(([sheetName, services]) => ({
                      label: sheetName,
                      options: Array.isArray(services) ? services : [],
                    }))
                    .filter(g => g.options.length > 0)
                    .sort((a, b) => a.label.localeCompare(b.label))
                : undefined;
              return (
                <MultiSelectCell
                  value={row[h]}
                  onChange={(v) => updateOppField(row._id, h, v)}
                  options={opts}
                  extraGroups={extraGroups}
                  extraGroupsLabel="Add from Pricing Option"
                  extraGroupsPlaceholder="— pick an option —"
                  nowrap={h === 'Scope'}
                />
              );
            }
            return (
              <SelectCell
                value={row[h]}
                onChange={(v) => updateOppField(row._id, h, v)}
                options={opts}
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
                hubspotContacts={hubspotContacts}
                onOpenContact={openContactDetails}
              />
            );
          }
          if (h === 'Waiting On') {
            // Mirror the popup's per-step Waiting On values into the
            // table column. The Next Steps editor stores a parallel
            // array (_nextStepsWaiting) aligned with each note line, so
            // joining the non-empty entries with newlines stacks them
            // visually in the cell (white-space: pre keeps each on its
            // own row; auto-grow row heights handle vertical fit).
            // When the popup hasn't been used yet, fall back to the
            // legacy editable field so a manually-typed value still
            // shows and stays editable.
            const stacked = (Array.isArray(row._nextStepsWaiting) ? row._nextStepsWaiting : [])
              .map(s => String(s || '').trim())
              .filter(Boolean)
              .join('\n');
            if (stacked) {
              return (
                <span
                  onDoubleClick={(e) => { e.stopPropagation(); e.preventDefault(); setNextStepsPopupId(row._id); }}
                  title="Double-click to edit in Next Steps"
                  style={{
                    display: 'block', cursor: 'pointer', minHeight: '1em',
                    padding: '1px 2px', whiteSpace: 'pre', overflow: 'hidden',
                  }}
                >{stacked}</span>
              );
            }
          }
          if (h === 'Next Steps') {
            return (
              <NextStepsCell
                value={row[h]}
                onOpen={() => setNextStepsPopupId(row._id)}
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
    // Trailing actions column — × button per row for delete. Lives
    // outside the headers loop so it can't be hidden via the columns
    // toggle (you always need a way to delete a row).
    const actions = {
      key: '_actions',
      label: '',
      defaultWidth: 44,
      getFilterValue: () => '',
      render: (row) => (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            const label = String(row['Account'] || '').trim() || 'this opp';
            if (window.confirm(`Delete ${label}? This can't be undone.`)) {
              deleteOpp(row._id);
            }
          }}
          title="Delete this opp"
          style={{
            padding: '0', width: 22, height: 22, lineHeight: 1,
            fontSize: '0.95rem', fontWeight: 600, fontFamily: 'inherit',
            color: '#94A3B8', background: 'transparent',
            border: '1px solid var(--color-border)', borderRadius: 4,
            cursor: 'pointer',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = '#B91C1C'; e.currentTarget.style.borderColor = '#B91C1C'; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = '#94A3B8'; e.currentTarget.style.borderColor = 'var(--color-border)'; }}
        >×</button>
      ),
    };
    // Selection checkbox — prepended so the user can flip rows on/off
    // for mass-edit. The header checkbox toggles every row in the
    // current filter (so a user can filter to "Stage = Quoting" and
    // mass-select with one click).
    const selectCol = {
      key: '_select',
      label: '',
      defaultWidth: 36,
      getFilterValue: () => '',
      renderHeader: () => {
        const filteredArr = Array.from(filteredRowIds);
        let selectedInFilter = 0;
        for (const id of filteredArr) if (selectedIds.has(id)) selectedInFilter += 1;
        const allSelected = filteredArr.length > 0 && selectedInFilter === filteredArr.length;
        const someSelected = selectedInFilter > 0 && !allSelected;
        return (
          <input
            type="checkbox"
            ref={(el) => { if (el) el.indeterminate = someSelected; }}
            checked={allSelected}
            disabled={filteredArr.length === 0}
            onChange={(e) => {
              const checked = e.target.checked;
              setSelectedIds(prev => {
                const next = new Set(prev);
                if (checked) {
                  for (const id of filteredArr) next.add(id);
                } else {
                  for (const id of filteredArr) next.delete(id);
                }
                return next;
              });
            }}
            style={{ margin: 0, cursor: filteredArr.length === 0 ? 'not-allowed' : 'pointer' }}
            title={filteredArr.length === 0
              ? 'No filtered rows to select'
              : allSelected
                ? `Clear selection for all ${filteredArr.length} filtered row${filteredArr.length === 1 ? '' : 's'}`
                : `Select all ${filteredArr.length} filtered row${filteredArr.length === 1 ? '' : 's'}`}
          />
        );
      },
      render: (row) => (
        <input
          type="checkbox"
          checked={selectedIds.has(row._id)}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => {
            const checked = e.target.checked;
            setSelectedIds(prev => {
              const next = new Set(prev);
              if (checked) next.add(row._id);
              else next.delete(row._id);
              return next;
            });
          }}
          style={{ margin: 0, cursor: 'pointer' }}
          title="Select for mass edit"
        />
      ),
    };
    // Info button — opens a modal showing the row's basic info and a
    // delete button. Inserted right before Next Steps so the user
    // doesn't have to scroll the row to get a summary.
    const infoCol = {
      key: '_info',
      label: '',
      defaultWidth: 40,
      getFilterValue: () => '',
      render: (row) => (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setInfoOppId(row._id); }}
          title="Show opp info"
          style={{
            padding: '0', width: 22, height: 22, lineHeight: 1,
            fontSize: '0.85rem', fontWeight: 700, fontFamily: 'inherit',
            color: 'var(--color-accent)', background: '#fff',
            border: '1px solid var(--color-accent)', borderRadius: '50%',
            cursor: 'pointer',
          }}
        >i</button>
      ),
    };
    // Splice the info column in just before Next Steps when it's
    // present in the visible header set. Falls back to appending so
    // a user who hid Next Steps still gets the button.
    const nextStepsIdx = mapped.findIndex(c => c.key === 'Next Steps');
    const withInfo = nextStepsIdx >= 0
      ? [...mapped.slice(0, nextStepsIdx), infoCol, ...mapped.slice(nextStepsIdx)]
      : [...mapped, infoCol];
    // Sequential 1..N display rank — ranks surviving opps by their
    // underlying `_id` (which is still assigned monotonically), so the
    // column always runs from 1 up over the current dataset rather than
    // exposing gaps from deleted rows. Lives leftmost (right after the
    // mass-edit checkbox when that's on). Non-sticky so the existing
    // sticky Account column still acts as the horizontal-scroll anchor.
    const oppNumCol = {
      key: '_oppNum',
      label: 'Opp #',
      defaultWidth: 70,
      getFilterValue: (row) => String(oppNumberById.get(row._id) ?? ''),
      getSortValue: (row) => oppNumberById.get(row._id) ?? 0,
      // The number lives in a derived map keyed by `_id`, not under the
      // column's key, so DataTable's default export (which reads
      // `row[col.key]`) would emit blanks. Map it through explicitly.
      exportValue: (row) => oppNumberById.get(row._id) ?? '',
      render: (row) => (
        <span style={{ fontVariantNumeric: 'tabular-nums', color: '#475569' }}>
          {oppNumberById.get(row._id) ?? ''}
        </span>
      ),
    };
    return massEditOn
      ? [selectCol, oppNumCol, ...withInfo, actions]
      : [oppNumCol, ...withInfo, actions];
  }, [headers, columnLinks, listRegistry, updateOppField, deleteOppField, deleteOpp, companySuggestions, prospects, updateProspect, hubspotContacts, selectedIds, pricingOptionServices, optionLinks, massEditOn, oppNumberById, filteredRowIds]);

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

  // Rows the current Date / Status / Show / Hide-history filters allow.
  // Always computed so `hiddenByFilterCount` stays accurate even when
  // the Show-hidden toggle is on.
  const filteredByActiveFilters = useMemo(() => {
    const fromTs = dateFrom ? Date.parse(dateFrom) : null;
    const toTs = dateTo ? Date.parse(dateTo) + 86399999 : null;
    return records.filter(r => {
      // History gate runs first so it short-circuits before the more
      // expensive date / stage checks for the bulk of dormant rows.
      if (hideHistory && resolveCallIn(r) == null) return false;
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
  }, [records, dateFrom, dateTo, statusFilter, activityFilter, hideHistory, CLOSED_STAGES]);

  // Standalone count of rows the Hide-history gate is suppressing, so
  // the toggle button can show "Show history (N)" without depending on
  // the rest of the filter chain.
  const historyCount = useMemo(
    () => records.reduce((n, r) => n + (resolveCallIn(r) == null ? 1 : 0), 0),
    [records],
  );

  // When the user clicks "Show hidden", bypass the active filters and
  // surface every row — the filter inputs are left untouched so a
  // second click returns to the filtered view. Aggregates (stage
  // chips, service breakdown) follow the same source so the page
  // reflects whatever the table is showing.
  const hiddenByFilterCount = records.length - filteredByActiveFilters.length;
  const prefiltered = showHiddenByFilter ? records : filteredByActiveFilters;

  // Global search across every column on each record — see OppsView for
  // the same shape. Trims + lowercases the term so the value the user
  // typed lines up with the stored cell text.
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    const searched = !term ? prefiltered : prefiltered.filter(r =>
      Object.values(r).some(v => v != null && v !== '' && String(v).toLowerCase().includes(term))
    );
    if (showOnlySelected && selectedIds.size > 0) {
      return searched.filter(r => selectedIds.has(r._id));
    }
    return searched;
  }, [prefiltered, search, showOnlySelected, selectedIds]);

  const stageCounts = useMemo(() => {
    const counts = {};
    for (const r of prefiltered) {
      const stage = r['Stage'] || 'Unknown';
      counts[stage] = (counts[stage] || 0) + 1;
    }
    return counts;
  }, [prefiltered]);

  const serviceBreakdown = useMemo(() => {
    // The breakdown only shows on the "By Service" tab. Skipping the
    // O(N×services) work while the Opportunities tab is active shaves
    // a noticeable chunk off the first render with large datasets.
    if (activeTab !== 'services') return { rows: [], total: prefiltered.length };
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
  }, [prefiltered, activeTab]);

  const filtersActive = !!(dateFrom || dateTo || statusFilter !== 'all' || activityFilter !== 'all');
  const clearFilters = () => {
    setDateFrom(''); setDateTo(''); setStatusFilter('all'); setActivityFilter('all');
  };

  // Rows for the Days-in-Stage tab. Reads `_stageEnteredAt` (stamped by
  // updateOppField when Stage flips) and falls back to Start Date so
  // pre-existing opps that have never had a stage change still
  // contribute something instead of showing blank. Sorted descending by
  // days so the longest-stalling opps lead the list.
  const stageDaysRows = useMemo(() => {
    if (activeTab !== 'stageDays') return [];
    const rows = [];
    for (const r of records) {
      const stage = String(r['Stage'] || '').trim();
      if (!TRACKED_STAGES_SET.has(stage)) continue;
      // Mirror the Opportunities tab's history gate — opps with no
      // Call In aren't on a callback schedule, so they shouldn't crowd
      // the kanban either.
      if (resolveCallIn(r) == null) continue;
      const enteredISO = toISODate(r._stageEnteredAt) || toISODate(r['Start Date']);
      const days = enteredISO ? -daysFromToday(enteredISO) : null;
      const scope = String(r['Scope'] ?? '').trim();
      rows.push({
        id: r._id,
        Account: r['Account'] || '',
        Stage: stage,
        days,
        enteredAt: enteredISO || '',
        startDate: toISODate(r['Start Date']) || '',
        scope: scope && scope !== '-' && scope !== '#N/A' ? scope : '',
        _hasExplicitEntry: !!toISODate(r._stageEnteredAt),
      });
    }
    rows.sort((a, b) => {
      // Null days (no Start Date either) settle at the bottom so the
      // top of the list always shows real numbers.
      if (a.days == null && b.days == null) return 0;
      if (a.days == null) return 1;
      if (b.days == null) return -1;
      return b.days - a.days;
    });
    return rows;
  }, [activeTab, records]);

  // Group Days-in-Stage rows by stage so the Kanban view can render one
  // column per stage with its cards stacked beneath. stageDaysRows is
  // pre-sorted descending by days, so each bucket's order falls out for
  // free — longest-stalling firms lead each column.
  const stageDaysByStage = useMemo(() => {
    const map = new Map(TRACKED_STAGES.map(s => [s, []]));
    for (const r of stageDaysRows) {
      if (map.has(r.Stage)) map.get(r.Stage).push(r);
    }
    return map;
  }, [stageDaysRows]);

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
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <AddCompanyCombobox
            suggestions={companySuggestions}
            onCommit={(name) => setPendingNewOpp({ account: name })}
          />
          <button
            type="button"
            onClick={() => setLinkModalOpen(true)}
            style={{
              padding: '0.45rem 0.85rem', background: 'transparent',
              border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)',
              fontSize: 'var(--font-size-sm)', fontWeight: 600, fontFamily: 'inherit',
              color: 'var(--color-text)', cursor: 'pointer',
            }}
            title="Bind columns to Dropdowns-tab lists"
          >Link columns</button>
          <button
            type="button"
            onClick={importFromOppsTab}
            disabled={importingFromOpps}
            style={{
              padding: '0.45rem 0.85rem', background: 'transparent',
              border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)',
              fontSize: 'var(--font-size-sm)', fontWeight: 600, fontFamily: 'inherit',
              color: 'var(--color-text)', cursor: importingFromOpps ? 'progress' : 'pointer',
            }}
            title="One-time copy of every row from the Opps tab cache that isn't already on Opps 2"
          >{importingFromOpps ? 'Importing…' : 'Import from Opps tab'}</button>
          <button
            type="button"
            onClick={() => setBulkImportOpen(true)}
            style={{
              padding: '0.45rem 0.85rem', background: 'transparent',
              border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)',
              fontSize: 'var(--font-size-sm)', fontWeight: 600, fontFamily: 'inherit',
              color: 'var(--color-text)', cursor: 'pointer',
            }}
            title="Paste data from a Google Sheet with the same columns and review the mapping before importing"
          >Bulk import</button>
          <button
            type="button"
            onClick={undoLastChange}
            disabled={!undoStack.length}
            style={{
              padding: '0.45rem 0.85rem', background: 'transparent',
              border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)',
              fontSize: 'var(--font-size-sm)', fontWeight: 600, fontFamily: 'inherit',
              color: undoStack.length ? 'var(--color-text)' : 'var(--color-text-muted)',
              cursor: undoStack.length ? 'pointer' : 'not-allowed',
              opacity: undoStack.length ? 1 : 0.6,
            }}
            title={undoStack.length
              ? `Undo last change (${undoStack.length} in history) — Ctrl/Cmd+Z`
              : 'No recent changes to undo'}
          >↶ Undo</button>
          <button className={styles.syncBtn} onClick={() => setPendingNewOpp({})}>+ New Opp</button>
        </div>
      </div>

      {error && <div className={styles.error}>{error}</div>}

      {linkModalOpen && (
        <LinkColumnsModal
          headers={headers}
          columnLinks={columnLinks}
          defaultLinks={DEFAULT_COLUMN_LINKS}
          listRegistry={listRegistry}
          availableLists={availableLists}
          onChange={updateColumnLinks}
          onClose={() => setLinkModalOpen(false)}
        />
      )}

      {bulkImportOpen && (
        <BulkImportModal
          existingHeaders={data?.headers?.length ? data.headers : DEFAULT_HEADERS}
          existingRecords={data?.records || []}
          dedupKeyFor={oppDedupKeyForImport}
          onClose={() => setBulkImportOpen(false)}
          onImport={commitBulkImport}
        />
      )}

      {pendingNewOpp && (
        <NewOppSourceModal
          account={pendingNewOpp.account}
          options={listRegistry.get('source')?.options || []}
          onCreate={(source) => {
            addNewOpp(pendingNewOpp.account, source);
            setPendingNewOpp(null);
          }}
          onCancel={() => setPendingNewOpp(null)}
        />
      )}

      {infoOppId != null && (() => {
        const opp = records.find(r => r._id === infoOppId);
        if (!opp) return null;
        // Splat in the computed values so the popup shows the same
        // numbers the table cells do without re-deriving them inside
        // the modal.
        const augmented = {
          ...opp,
          'Call In': (() => { const n = resolveCallIn(opp); return n == null ? '' : n; })(),
          'Last Spoke': (() => { const n = resolveLastSpoke(opp); return n == null ? '' : n; })(),
        };
        return (
          <OppInfoModal
            opp={augmented}
            headers={headers}
            onClose={() => setInfoOppId(null)}
            onDelete={deleteOpp}
            onFieldChange={(field, value) => updateOppField(opp._id, field, value)}
            columnLinks={columnLinks}
            listRegistry={listRegistry}
            companySuggestions={companySuggestions}
            prospects={prospects}
            updateProspect={updateProspect}
            hubspotContacts={hubspotContacts}
            pricingOptionServices={pricingOptionServices}
            pricingOptionLinkName={optionLinks[String(opp._id)] || ''}
            onOpenContact={openContactDetails}
          />
        );
      })()}

      {nextStepsPopupId != null && (() => {
        const opp = records.find(r => r._id === nextStepsPopupId);
        if (!opp) return null;
        return (
          <NextStepsEditor
            key={opp._id}
            opp={opp}
            onClose={() => setNextStepsPopupId(null)}
            updateOppField={updateOppField}
          />
        );
      })()}

      {editingContact && (
        <ContactEditModal
          contact={editingContact}
          onSave={closeContactModal}
          onClose={() => setEditingContact(null)}
          contactNotes={settings?.contactNotes || {}}
          onSaveNote={saveContactNote}
          contactOldEmails={settings?.contactOldEmails || {}}
          onSaveOldEmails={saveContactOldEmails}
          contactNicknames={settings?.contactNicknames || {}}
          onSaveNickname={saveContactNickname}
          contactTeamNames={settings?.contactTeamNames || {}}
          onSaveTeamName={saveContactTeamName}
          contactReportsTo={settings?.contactReportsTo || {}}
          onSaveReportsTo={saveContactReportsTo}
          ccMap={settings?.ccMap || {}}
          onSaveCcMap={(m) => updateSettings({ ccMap: m })}
          toAlsoMap={settings?.toAlsoMap || {}}
          onSaveToAlsoMap={(m) => updateSettings({ toAlsoMap: m })}
          contactFamilies={settings?.contactFamilies || {}}
          onSaveFamily={saveContactFamily}
          companyContacts={(hubspotContacts || []).filter(c => {
            const cCompany = String(c?.company || '').trim().toLowerCase();
            const tgt = String(editingContact?.company || '').trim().toLowerCase();
            return cCompany && tgt && cCompany === tgt;
          })}
          emailDomains={[]}
          companyNames={(prospects || []).map(p => p.company).filter(Boolean)}
        />
      )}

      <div className={styles.tabs}>
        <button
          className={activeTab === 'opps' ? styles.tabActive : styles.tab}
          onClick={() => setActiveTab('opps')}
        >Opportunities</button>
        <button
          className={activeTab === 'services' ? styles.tabActive : styles.tab}
          onClick={() => setActiveTab('services')}
        >By Service</button>
        <button
          className={activeTab === 'stageDays' ? styles.tabActive : styles.tab}
          onClick={() => setActiveTab('stageDays')}
        >Days in Stage</button>
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
        <button
          className={styles.clearFiltersBtn}
          onClick={() => setHideHistory(v => !v)}
          disabled={hideHistory && historyCount === 0}
          title={hideHistory
            ? 'Rows with no Call In number are hidden as history. Click to include them.'
            : 'Hide rows with no Call In number — they aren’t on a callback schedule.'}
        >
          {hideHistory
            ? `Show history${historyCount ? ` (${historyCount})` : ''}`
            : 'Hide history'}
        </button>
        <button
          className={styles.clearFiltersBtn}
          onClick={() => setShowHiddenByFilter(v => !v)}
          disabled={!showHiddenByFilter && hiddenByFilterCount === 0}
          title={showHiddenByFilter
            ? 'Re-apply the Date / Status / Show filters above.'
            : hiddenByFilterCount > 0
              ? 'Temporarily reveal every row hidden by the current filters without changing the filter inputs.'
              : 'No rows are currently hidden by the Date / Status / Show filters.'}
        >
          {showHiddenByFilter
            ? 'Re-apply filters'
            : `Show hidden${hiddenByFilterCount ? ` (${hiddenByFilterCount})` : ''}`}
        </button>
      </div>

      {activeTab === 'opps' && (
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
              placeholder="Search across all columns (Account, Stage, Scope, Notes, BFO Address, …)"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            <span className={styles.resultCount}>{filtered.length} of {prefiltered.length}{filtersActive && prefiltered.length !== records.length ? ` (filtered from ${records.length})` : ''}</span>
            <button
              type="button"
              onClick={() => {
                setMassEditOn(on => {
                  // Leaving mass-edit mode clears any in-flight
                  // selection so the bulk toolbar disappears and the
                  // next time the user re-enters they start fresh.
                  if (on) setSelectedIds(new Set());
                  return !on;
                });
              }}
              title={massEditOn
                ? 'Hide the selection checkboxes and exit mass-edit mode.'
                : 'Show selection checkboxes so you can pick multiple rows to edit at once.'}
              style={{
                marginLeft: '0.5rem',
                padding: '0.3rem 0.7rem',
                fontSize: '0.78rem',
                fontWeight: 600,
                fontFamily: 'inherit',
                color: massEditOn ? '#fff' : '#1E3A8A',
                background: massEditOn ? '#2563EB' : '#fff',
                border: `1px solid ${massEditOn ? '#2563EB' : '#93C5FD'}`,
                borderRadius: 6,
                cursor: 'pointer',
              }}
            >{massEditOn ? 'Exit Mass Edit' : 'Mass Edit'}</button>
            {selectedIds.size > 0 && (
              <button
                type="button"
                onClick={() => setShowOnlySelected(v => !v)}
                title={showOnlySelected
                  ? 'Show every row again. Your selection is kept.'
                  : 'Hide every row that isn\'t currently selected.'}
                style={{
                  marginLeft: '0.5rem',
                  padding: '0.3rem 0.7rem',
                  fontSize: '0.78rem',
                  fontWeight: 600,
                  fontFamily: 'inherit',
                  color: showOnlySelected ? '#fff' : '#166534',
                  background: showOnlySelected ? '#16A34A' : '#fff',
                  border: `1px solid ${showOnlySelected ? '#16A34A' : '#86EFAC'}`,
                  borderRadius: 6,
                  cursor: 'pointer',
                }}
              >{showOnlySelected ? `Showing ${selectedIds.size} selected — Show all` : `Show ${selectedIds.size} selected only`}</button>
            )}
          </div>

          {massEditOn && selectedIds.size > 0 && (
            <MassEditBar
              selectedCount={selectedIds.size}
              headers={headers}
              columnLinks={columnLinks}
              listRegistry={listRegistry}
              onApply={(field, value) => updateManyOppFields(selectedIds, field, value)}
              onDelete={() => deleteManyOpps(selectedIds)}
              onClear={() => setSelectedIds(new Set())}
            />
          )}

          {loading && !data ? (
            <div className={styles.loading}>Loading...</div>
          ) : (
            <DataTable
              tableId="opps2"
              columns={columns}
              rows={filtered}
              alwaysVisible={['Account', '_select', '_info']}
              // No default sort — editing Follow Up / Last Client Heard From
              // Us would otherwise re-rank rows by Call In on every keystroke
              // and yank the row out from under the cursor. The Call In
              // header click still toggles a manual sort when the user
              // actually wants to triage by urgency.
              enableColumnFilters
              onFilteredRowsChange={handleFilteredRowsChange}
              emptyMessage="No opps yet — click + New Opp to create one."
              settings={settings}
              updateSettings={updateSettings}
              // Notes / Next Steps can grow taller via Alt+Enter newlines,
              // so the fixed-rowHeight virtualization spacers misalign and
              // the user ends up scrolled into a "ghost" zone with no
              // rendered rows. variableRowHeight renders every row and lets
              // content-visibility handle off-screen perf.
              variableRowHeight
              rowStyle={(row) => {
                // Tint closed opps so the table reads at a glance —
                // light green for wins, light red for losses. Rows the
                // user has marked "No Further Action Today" go light
                // grey and win against the stage tint so today's
                // do-nothing rows visibly recede. The style also lands
                // on every <td> (including the sticky Account column)
                // so the row is solidly coloured edge to edge.
                const nfat = String(row?.['No Further Action Today'] || '').trim().toLowerCase();
                if (nfat === 'yes') return { background: '#E5E7EB' };
                const stage = String(row?.Stage || '').trim();
                if (stage === 'Sold') return { background: '#DCFCE7' };
                if (stage === 'Not Sold') return { background: '#FEE2E2' };
                return undefined;
              }}
            />
          )}
        </>
      )}

      {activeTab === 'services' && (
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

      {activeTab === 'stageDays' && (
        <>
          <div className={styles.searchRow}>
            <label className={styles.showHiddenLabel}>
              <input
                type="checkbox"
                checked={hideNotStarted}
                onChange={e => setHideNotStarted(e.target.checked)}
              />
              Hide Not Started ({(stageDaysByStage.get('Not Started') || []).length})
            </label>
          </div>
          <div style={{
            display: 'flex', gap: 12, overflowX: 'auto',
            padding: '12px 0', alignItems: 'flex-start',
          }}>
            {TRACKED_STAGES.filter(s => !(hideNotStarted && s === 'Not Started')).map(stage => {
              const items = stageDaysByStage.get(stage) || [];
              return (
                <div key={stage} style={{
                  flex: '0 0 220px', width: 220,
                  background: '#F1F5F9', borderRadius: 6, padding: 8,
                  display: 'flex', flexDirection: 'column', gap: 8,
                }}>
                  <div style={{
                    display: 'flex', alignItems: 'baseline',
                    justifyContent: 'space-between',
                    padding: '2px 4px 6px',
                    borderBottom: '1px solid #CBD5E1',
                  }}>
                    <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>{stage}</span>
                    <span style={{ fontSize: '0.72rem', color: '#64748B' }}>{items.length}</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {items.length === 0 ? (
                      <div style={{
                        color: '#94A3B8', fontSize: '0.72rem',
                        textAlign: 'center', padding: '8px 0',
                      }}>—</div>
                    ) : items.map(row => {
                      const dayBadgeTitle = row.enteredAt
                        ? `Stage entered ${formatDateDisplay(row.enteredAt)}${row._hasExplicitEntry ? '' : ' (fallback to Start Date)'}`
                        : 'No entry date recorded.';
                      // Account-name hover surfaces the row's Scope so
                      // the kanban reads like a triage board — no need
                      // to bounce back to the Opportunities tab to see
                      // what the opp is actually selling.
                      const accountTitle = row.scope
                        ? `Scope: ${row.scope}`
                        : 'No scope set on this opp.';
                      return (
                        <div
                          key={row.id}
                          style={{
                            background: '#FFFFFF', borderRadius: 4,
                            border: '1px solid #E2E8F0',
                            padding: '6px 8px',
                            display: 'flex', alignItems: 'center',
                            justifyContent: 'space-between', gap: 8,
                          }}
                        >
                          <span
                            title={accountTitle}
                            style={{
                              fontSize: '0.8rem', fontWeight: 500,
                              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                              minWidth: 0, cursor: 'help',
                            }}
                          >
                            {row.Account || <span style={{ color: '#94A3B8' }}>(no account)</span>}
                          </span>
                          <span
                            title={dayBadgeTitle}
                            style={{
                              fontSize: '0.72rem', fontWeight: 600,
                              color: row.days != null && row.days > 30 ? '#DC2626' : '#475569',
                              fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
                            }}
                          >
                            {row.days == null ? '—' : `${row.days}d`}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
