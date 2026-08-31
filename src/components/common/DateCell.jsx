import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { toISODate, formatDateDisplay, parseTypedDate } from '../../utils/isoDate';
import { buildMonthGrid } from '../../utils/monthGrid';

// Shared click-to-pick date cell. Renders the value as M/D/YYYY and opens a
// calendar popup on click, storing the chosen day as ISO (YYYY-MM-DD) so it
// round-trips cleanly through the same picker next time.
//
// Lifted out of OppsView2 so the Deals tab's contract-term dates behave the
// same way.
//
// The calendar is drawn in-app rather than handed off to the browser's native
// `<input type="date">` popup. The native one commits (and closes) the moment
// its value changes, so paging to another month could land the cell on a date
// the user never picked — they'd have to reopen the popup and try again. Here
// month/year navigation is pure browsing: nothing is written until a day is
// clicked or a typed date is entered, and Esc or a click outside leaves the
// stored value untouched.
//
// The popup also takes a typed date, because clicking back through the arrows
// is the wrong tool for a date years away — and because most of these values
// arrive by being read off a contract, where typing what it says beats
// hunting for the day. The box is the focused control when the popup opens,
// so a keyboard user never has to reach for the grid at all.

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const POPUP_WIDTH = 250;
// Header row + typed box + grid + footer, measured on the six-week grid the
// popup now always draws (see utils/monthGrid) — so the panel no longer
// changes height as you page between a four-row month and a six-row one.
// Only used to decide whether the popup fits below the cell or has to flip
// above it, so it tracks the real panel height: a figure left behind when
// the panel grows puts it half off-screen.
const POPUP_HEIGHT = 326;

// ISO (YYYY-MM-DD) → {y, m, d} in local time. Parsing the parts by hand
// avoids Date.parse reading a bare ISO date as UTC and shifting the day.
function isoParts(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  if (!match) return null;
  return { y: +match[1], m: +match[2] - 1, d: +match[3] };
}

function toIso(y, m, d) {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function todayParts() {
  const now = new Date();
  return { y: now.getFullYear(), m: now.getMonth(), d: now.getDate() };
}

// Small square button used for the month/year arrows.
function navStyle() {
  return {
    width: 24, height: 24, flexShrink: 0,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    border: '1px solid var(--color-border)', borderRadius: 4,
    background: 'var(--color-surface)', cursor: 'pointer',
    fontSize: '0.75rem', lineHeight: 1, color: 'var(--color-text-secondary)',
    padding: 0,
  };
}

function CalendarPopup({ anchorRect, selectedIso, onPick, onClear, onClose }) {
  const ref = useRef(null);
  const inputRef = useRef(null);
  const today = todayParts();
  // What's in the typed box. Seeded from the stored value in the same
  // M/D/YYYY shape the cell shows, so the common edit — change the year,
  // press Enter — is two keystrokes.
  const [draft, setDraft] = useState(() => (selectedIso ? formatDateDisplay(selectedIso) : ''));
  // '' means the box is empty (Enter would clear the cell), null means what's
  // in it isn't a date yet. Only an ISO string is something to commit.
  const typed = parseTypedDate(draft);
  const typedIso = typed || '';
  const typedInvalid = typed === null;

  // The grid highlights the typed date the moment it parses, so a typed value
  // is checked against a calendar before it is committed — 3/5 vs 5/3 is the
  // mistake this catches.
  const selected = isoParts(typedIso) || isoParts(selectedIso);
  // The month the grid shows follows the typed box until the arrows are used,
  // and follows them from there — typing again snaps it back, because the
  // onChange below drops the browsed month. Derived rather than synced, so
  // there is one answer to "which month is this" instead of two that can
  // disagree. Either way, changing it never touches the cell.
  const [browsed, setBrowsed] = useState(null);
  const view = browsed || {
    y: selected ? selected.y : today.y,
    m: selected ? selected.m : today.m,
  };

  // Keep the popup on screen: flip above the cell when there isn't room
  // below, and pull it left when it would run off the right edge. Derived
  // straight from the anchor box at render time — the popup closes on
  // scroll / resize, so this never needs to be recomputed while it's open.
  const pos = useMemo(() => {
    const margin = 6;
    let left = anchorRect.left;
    if (left + POPUP_WIDTH > window.innerWidth - margin) {
      left = Math.max(margin, window.innerWidth - POPUP_WIDTH - margin);
    }
    let top = anchorRect.bottom + 2;
    if (top + POPUP_HEIGHT > window.innerHeight - margin) {
      const above = anchorRect.top - POPUP_HEIGHT - 2;
      top = above >= margin ? above : Math.max(margin, window.innerHeight - POPUP_HEIGHT - margin);
    }
    return { left, top };
  }, [anchorRect]);

  useEffect(() => {
    // Focus the typed box: it is the control most edits start in, and it
    // keeps the keyboard off the cell behind the popup. Esc is handled on the
    // document below, so it still reaches the popup from inside the input.
    (inputRef.current || ref.current)?.focus();
    inputRef.current?.select();
    function onDocMouseDown(e) {
      if (!ref.current?.contains(e.target)) onClose();
    }
    function onKeyDown(e) {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
    }
    // Capture-phase so the close beats any row/cell click handler underneath.
    document.addEventListener('mousedown', onDocMouseDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    // The cell scrolls with the table; rather than chase it, close.
    window.addEventListener('resize', onClose);
    window.addEventListener('scroll', onClose, true);
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown, true);
      document.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('resize', onClose);
      window.removeEventListener('scroll', onClose, true);
    };
  }, [onClose]);

  const shiftMonth = (delta) => {
    const next = new Date(view.y, view.m + delta, 1);
    setBrowsed({ y: next.getFullYear(), m: next.getMonth() });
  };

  // Six weeks of days, the ends filled from the neighbouring months so the
  // 1st of next month is a click away rather than a page-forward — which is
  // most of what a follow-up date is set to late in a month. Those days are
  // drawn muted but pick like any other.
  const cells = buildMonthGrid(view.y, view.m);

  return createPortal(
    <div
      ref={ref}
      tabIndex={-1}
      role="dialog"
      aria-label="Choose a date"
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      style={{
        position: 'fixed', left: pos.left, top: pos.top, zIndex: 11001,
        width: POPUP_WIDTH, boxSizing: 'border-box',
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)', borderRadius: 6,
        boxShadow: '0 6px 20px rgba(0,0,0,0.16)',
        padding: 8, outline: 'none',
        font: 'inherit', fontSize: '0.78rem', color: 'var(--color-text)',
        userSelect: 'none',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 6 }}>
        <button type="button" style={navStyle()} title="Previous year" aria-label="Previous year" onClick={() => shiftMonth(-12)}>«</button>
        <button type="button" style={navStyle()} title="Previous month" aria-label="Previous month" onClick={() => shiftMonth(-1)}>‹</button>
        <span style={{ flex: 1, textAlign: 'center', fontWeight: 600, whiteSpace: 'nowrap' }}>
          {MONTHS[view.m]} {view.y}
        </span>
        <button type="button" style={navStyle()} title="Next month" aria-label="Next month" onClick={() => shiftMonth(1)}>›</button>
        <button type="button" style={navStyle()} title="Next year" aria-label="Next year" onClick={() => shiftMonth(12)}>»</button>
      </div>

      <input
        ref={inputRef}
        type="text"
        value={draft}
        autoComplete="off"
        placeholder="M/D/YYYY — or pick below"
        aria-label="Type a date"
        aria-invalid={typedInvalid || undefined}
        title="Type a date and press Enter. A two-digit year and a missing year both fill in; Esc closes without changing the cell."
        onChange={(e) => {
          setDraft(e.target.value);
          // Typing takes the grid back to the typed date, wherever the
          // arrows had wandered off to.
          setBrowsed(null);
        }}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          // Enter is the commit. An empty box clears the cell, the way the
          // Clear button does; text that isn't a date does nothing at all,
          // leaving the box red rather than writing a guess.
          if (typedInvalid) return;
          if (typedIso) onPick(typedIso); else onClear();
        }}
        style={{
          width: '100%', boxSizing: 'border-box', marginBottom: 6,
          padding: '3px 6px', borderRadius: 4,
          border: `1px solid ${typedInvalid ? 'var(--color-danger, #DC2626)' : 'var(--color-border)'}`,
          background: 'var(--color-surface)', color: 'var(--color-text)',
          font: 'inherit', fontSize: '0.78rem', outline: 'none',
          // The panel sets user-select: none so dragging across the day grid
          // doesn't paint it blue; the box has to opt back in or its text
          // can't be selected to be replaced.
          userSelect: 'text',
        }}
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>
        {WEEKDAYS.map(w => (
          <span key={w} style={{ textAlign: 'center', fontSize: '0.68rem', color: 'var(--color-text-muted)', padding: '2px 0' }}>{w}</span>
        ))}
        {cells.map((cell) => {
          const isSelected = !!selected && selected.y === cell.y && selected.m === cell.m && selected.d === cell.d;
          const isToday = today.y === cell.y && today.m === cell.m && today.d === cell.d;
          return (
            <button
              key={`${cell.y}-${cell.m}-${cell.d}`}
              type="button"
              onClick={() => onPick(toIso(cell.y, cell.m, cell.d))}
              title={cell.outside ? `${MONTHS[cell.m]} ${cell.d}, ${cell.y}` : undefined}
              style={{
                padding: '4px 0', border: isToday && !isSelected ? '1px solid var(--color-accent)' : '1px solid transparent',
                borderRadius: 4, cursor: 'pointer', font: 'inherit', fontSize: '0.78rem',
                fontWeight: isSelected ? 700 : 400,
                background: isSelected ? 'var(--color-accent)' : 'transparent',
                color: isSelected ? '#fff' : cell.outside ? 'var(--color-text-muted)' : 'var(--color-text)',
              }}
            >{cell.d}</button>
          );
        })}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6, marginTop: 8 }}>
        <button
          type="button"
          onClick={() => { const t = todayParts(); onPick(toIso(t.y, t.m, t.d)); }}
          style={{
            padding: '3px 8px', border: '1px solid var(--color-border)', borderRadius: 4,
            background: 'var(--color-surface)', cursor: 'pointer', font: 'inherit', fontSize: '0.72rem',
            color: 'var(--color-text-secondary)',
          }}
        >Today</button>
        <button
          type="button"
          onClick={onClear}
          style={{
            padding: '3px 8px', border: '1px solid var(--color-border)', borderRadius: 4,
            background: 'var(--color-surface)', cursor: 'pointer', font: 'inherit', fontSize: '0.72rem',
            color: 'var(--color-text-secondary)',
          }}
        >Clear</button>
      </div>
    </div>,
    document.body,
  );
}

export function DateCell({ value, onChange, title = 'Click to pick a date', emptyText = '-' }) {
  const spanRef = useRef(null);
  const [anchorRect, setAnchorRect] = useState(null);
  const iso = toISODate(value);
  const isEmpty = !value;

  const close = useCallback(() => setAnchorRect(null), []);

  return (
    <span
      ref={spanRef}
      onClick={(e) => {
        e.stopPropagation();
        const el = spanRef.current;
        if (!el) return;
        // Snapshot the cell's viewport box so the portal can position
        // against it without reaching back into the table's layout.
        const r = el.getBoundingClientRect();
        setAnchorRect({ left: r.left, right: r.right, top: r.top, bottom: r.bottom });
      }}
      style={{
        position: 'relative',
        display: 'block', cursor: 'pointer', minHeight: '1em',
        padding: '1px 2px',
        color: isEmpty ? 'var(--color-text-muted)' : 'inherit',
      }}
      title={title}
    >
      {isEmpty ? emptyText : formatDateDisplay(value)}
      {anchorRect && (
        <CalendarPopup
          anchorRect={anchorRect}
          selectedIso={iso}
          onPick={(picked) => { close(); onChange(picked); }}
          onClear={() => { close(); onChange(''); }}
          onClose={close}
        />
      )}
    </span>
  );
}
