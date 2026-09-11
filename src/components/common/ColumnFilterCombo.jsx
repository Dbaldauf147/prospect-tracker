import { useState, useRef, useMemo, useEffect, useLayoutEffect } from 'react';
import { suggestionMatches } from '../../utils/columnFilter';

// A filter box that suggests what its column already holds.
//
// Type to narrow the table; the list under the box offers the values in that
// column, prefix matches first. Focusing an empty box shows the whole column,
// which is most of the point — it is how you find out that "Out of Office" is
// a status at all without having seen one.
//
// Not a <select>: the vocabulary of a column is whatever is in it, half a name
// has to narrow the rows, and a column of free text (Notes) has to work the
// same way as a column of four fixed words. Not a native <datalist> either —
// that shows nothing until you have typed and gives no sign it is there, so
// the list a column had to offer was invisible to the person who needed it.
//
// The matching rules are shared with the S2C line-item table
// (utils/columnFilter.js), so two tables can't disagree about what typing
// "warb" into a column means.
//
// Keyboard: ↓/↑ walk the list, Enter picks the highlighted option (or just
// closes the list when none is), Escape clears the filter. Nothing is
// highlighted until ↓ walks into the list, so Enter on a half-typed word
// leaves what was typed rather than jumping to a suggestion.

// The tallest the list gets, and roughly what one option costs — enough to ask
// for only the room the options actually need, so a two-option list doesn't
// flip above the box over a shortfall it doesn't have.
const LIST_MAX_H = 240;
const OPTION_H = 26;
const listHeight = (count) => Math.min(LIST_MAX_H, count * OPTION_H + 10);

// Where the list goes.
//
// It can't go where it belongs — inside the header cell. The table scrolls
// inside its own box and the page scrolls behind it, so a list positioned in
// the cell is clipped by both. So it is fixed to the viewport and put back
// under its own box whenever anything scrolls or resizes.
function useListAnchor(open, inputRef, wanted) {
  const [pos, setPos] = useState(null);
  useLayoutEffect(() => {
    if (!open) return undefined;
    const place = () => {
      const el = inputRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const below = window.innerHeight - r.bottom;
      const base = { left: r.left, width: Math.max(r.width, 180) };
      // Below unless it genuinely doesn't fit there and fits better above.
      setPos(below < wanted && r.top > below
        ? { ...base, bottom: window.innerHeight - r.top + 2 }
        : { ...base, top: r.bottom + 2 });
    };
    place();
    // Capture, so scrolling the table's own box counts and not just the window.
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open, inputRef, wanted]);
  return pos;
}

const LIST_STYLE = {
  position: 'fixed', zIndex: 50, maxHeight: `${LIST_MAX_H}px`, overflowY: 'auto',
  background: 'var(--color-surface)', border: '1px solid var(--color-border)',
  borderRadius: '6px', boxShadow: '0 6px 18px rgba(15, 23, 42, 0.18)', padding: '3px',
  // Declared inside a <th>, which centres its text: the list must say otherwise.
  textAlign: 'left',
};
const OPTION_STYLE = {
  padding: '3px 6px', borderRadius: '4px', fontSize: '0.72rem', cursor: 'pointer',
  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
  color: 'var(--color-text)',
};
const OPTION_ON_STYLE = { ...OPTION_STYLE, background: 'var(--color-accent)', color: '#fff' };

export function ColumnFilterCombo({ value, onChange, suggestions, label, placeholder = 'Filter…' }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  const list = useMemo(() => suggestions || [], [suggestions]);
  // Capped: a column of free text (Notes, Sent To) can offer one option per
  // row, and a list longer than the screen is not a list anybody reads.
  const options = useMemo(() => suggestionMatches(list, value).slice(0, 50), [list, value]);
  const pos = useListAnchor(open, inputRef, listHeight(options.length));

  // Keep the highlighted option in view while ↑/↓ walk past the edge.
  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const pick = (v) => { onChange(v); setOpen(false); inputRef.current?.blur(); };

  function onKeyDown(e) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!list.length) return;
      e.preventDefault();
      if (!open) { setOpen(true); return; }
      if (!options.length) return;
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((i) => {
        const n = i + step;
        if (n < -1) return options.length - 1;
        if (n >= options.length) return -1;
        return n;
      });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (open && active >= 0 && options[active] != null) pick(options[active]);
      else { setOpen(false); e.currentTarget.blur(); }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onChange('');
      setOpen(false);
      e.currentTarget.blur();
    }
  }

  const set = String(value ?? '') !== '';
  return (
    <div style={{ position: 'relative', display: 'block', textAlign: 'left' }}>
      <input
        ref={inputRef}
        type="text"
        role={list.length ? 'combobox' : undefined}
        aria-expanded={list.length ? open : undefined}
        aria-autocomplete={list.length ? 'list' : undefined}
        aria-label={`Filter by ${label}`}
        title={list.length
          ? `Filter by ${label} — type to narrow, or pick from what this column already holds`
          : `Filter by ${label}`}
        autoComplete="off"
        value={value ?? ''}
        placeholder={placeholder}
        onFocus={() => { setActive(-1); if (list.length) setOpen(true); }}
        onChange={(e) => { setActive(-1); if (list.length) setOpen(true); onChange(e.target.value); }}
        onKeyDown={onKeyDown}
        onBlur={() => { setOpen(false); setActive(-1); }}
        style={{
          width: '100%', padding: `2px ${set ? 16 : 6}px 2px 6px`, fontSize: '0.68rem',
          fontFamily: 'inherit', borderRadius: '4px',
          border: `1px solid ${set ? 'var(--color-accent)' : 'var(--color-border)'}`,
          background: set ? 'var(--color-surface)' : 'transparent',
          color: 'var(--color-text)', fontWeight: set ? 600 : 400,
        }}
      />
      {set && (
        <button
          type="button"
          aria-label={`Clear the ${label} filter`}
          title="Clear this column filter"
          // mousedown, not click: the input's blur would tear this down before
          // a click ever landed on it.
          onMouseDown={(e) => { e.preventDefault(); onChange(''); }}
          style={{
            position: 'absolute', top: '50%', right: 2, transform: 'translateY(-50%)',
            border: 'none', background: 'none', cursor: 'pointer', padding: '0 2px',
            lineHeight: 1, fontSize: '0.75rem', color: 'var(--color-text-muted)',
          }}
        >&times;</button>
      )}
      {open && pos && options.length > 0 && (
        <div style={{ ...LIST_STYLE, ...pos }} role="listbox" ref={listRef}>
          {options.map((opt, i) => (
            <div
              key={opt}
              role="option"
              aria-selected={i === active}
              data-active={i === active ? 'true' : undefined}
              style={i === active ? OPTION_ON_STYLE : OPTION_STYLE}
              title={opt}
              onMouseDown={(e) => { e.preventDefault(); pick(opt); }}
              onMouseEnter={() => setActive(i)}
            >{opt}</div>
          ))}
        </div>
      )}
    </div>
  );
}
