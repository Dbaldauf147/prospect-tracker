import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { toISODate, formatDateDisplay } from '../../utils/isoDate';

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
// clicked, and Esc or a click outside leaves the stored value untouched.

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const POPUP_WIDTH = 250;
const POPUP_HEIGHT = 292;

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

function daysInMonth(y, m) {
  return new Date(y, m + 1, 0).getDate();
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
  const selected = isoParts(selectedIso);
  const today = todayParts();
  // The month the grid is showing. Seeded from the stored value (or today
  // when the cell is blank) and then driven purely by the arrows — changing
  // it never touches the cell.
  const [view, setView] = useState(() => ({
    y: selected ? selected.y : today.y,
    m: selected ? selected.m : today.m,
  }));

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
    // Focus the panel so Esc reaches it and the keyboard isn't left on the
    // cell behind the popup.
    ref.current?.focus();
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

  const shiftMonth = (delta) => setView((v) => {
    const next = new Date(v.y, v.m + delta, 1);
    return { y: next.getFullYear(), m: next.getMonth() };
  });

  const leading = new Date(view.y, view.m, 1).getDay();
  const total = daysInMonth(view.y, view.m);
  const cells = [
    ...Array.from({ length: leading }, () => null),
    ...Array.from({ length: total }, (_, i) => i + 1),
  ];

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

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>
        {WEEKDAYS.map(w => (
          <span key={w} style={{ textAlign: 'center', fontSize: '0.68rem', color: 'var(--color-text-muted)', padding: '2px 0' }}>{w}</span>
        ))}
        {cells.map((day, i) => {
          if (day == null) return <span key={`blank-${i}`} />;
          const isSelected = !!selected && selected.y === view.y && selected.m === view.m && selected.d === day;
          const isToday = today.y === view.y && today.m === view.m && today.d === day;
          return (
            <button
              key={day}
              type="button"
              onClick={() => onPick(toIso(view.y, view.m, day))}
              style={{
                padding: '4px 0', border: isToday && !isSelected ? '1px solid var(--color-accent)' : '1px solid transparent',
                borderRadius: 4, cursor: 'pointer', font: 'inherit', fontSize: '0.78rem',
                fontWeight: isSelected ? 700 : 400,
                background: isSelected ? 'var(--color-accent)' : 'transparent',
                color: isSelected ? '#fff' : 'var(--color-text)',
              }}
            >{day}</button>
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
