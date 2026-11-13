// The Target Type cell on the Targets tab: a dropdown of the standard types
// that grows by typing. Click it for the list; type to narrow the list, and a
// name that isn't on it is added the moment it is committed (Enter, the
// "+ Add" row, or leaving the box), so the next company offers it too;
// Escape puts back what the cell held before the typing. The ×
// beside an option takes it off the list without touching targets that use
// it. See utils/targetTypeOptions for the store.
import { useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useListAnchor } from '../common/useListAnchor';
import { addTargetTypeOption, removeTargetTypeOption } from '../../utils/targetTypeOptions';

const inputStyle = {
  width: '100%', boxSizing: 'border-box', padding: '0.2rem 1.4rem 0.2rem 0.4rem', fontSize: '0.8rem',
  border: '1px solid #E2E8F0', borderRadius: 4, fontFamily: 'inherit', background: '#fff', cursor: 'pointer',
};
const optionStyle = (active) => ({
  display: 'flex', alignItems: 'center', gap: 6, padding: '0.3rem 0.5rem', fontSize: '0.8rem',
  cursor: 'pointer', background: active ? '#EFF6FF' : 'transparent', color: '#1E293B',
});

export function TargetTypeSelect({ value, onChange, options }) {
  const [open, setOpen] = useState(false);
  // What the box is narrowing by. Null until the user types, so opening the
  // list on a filled cell shows every option rather than just its own.
  const [query, setQuery] = useState(null);
  // The highlighted row, or -1 for none: Enter then takes what was typed.
  const [active, setActive] = useState(-1);
  // The cell's value before this round of typing, for Escape to put back.
  const beforeTypingRef = useRef('');
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const pos = useListAnchor(open, inputRef, 260);

  const trimmed = (query ?? '').trim();
  const shown = useMemo(() => {
    if (!trimmed) return options;
    const q = trimmed.toLowerCase();
    return options.filter(o => o.toLowerCase().includes(q));
  }, [options, trimmed]);
  const isNew = !!trimmed && !options.some(o => o.toLowerCase() === trimmed.toLowerCase());
  // The rows the arrow keys walk: the options, then "+ Add" when offered.
  const rowCount = shown.length + (isNew ? 1 : 0);

  const close = () => { setOpen(false); setQuery(null); setActive(-1); };
  const pick = (label) => {
    onChange(label);
    close();
  };
  // What was typed, as a type: an existing option's own spelling when it
  // matches one, otherwise added to the list as typed.
  const commitTyped = () => {
    if (!trimmed) return;
    const existing = options.find(o => o.toLowerCase() === trimmed.toLowerCase());
    if (existing) { if (existing !== value) onChange(existing); }
    else addTargetTypeOption(trimmed);
  };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive(a => Math.min(a + 1, rowCount - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, -1)); }
    else if (e.key === 'Escape') { if (query != null) onChange(beforeTypingRef.current); close(); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (active >= 0 && active < shown.length) pick(shown[active]);
      else if (active === shown.length && isNew) { addTargetTypeOption(trimmed); pick(trimmed); }
      else { commitTyped(); close(); }
    }
  };

  return (
    <div style={{ position: 'relative' }}>
      <input
        ref={inputRef}
        type="text"
        value={value}
        placeholder="Pick or type a type"
        aria-label="Target type"
        aria-expanded={open}
        aria-haspopup="listbox"
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onChange={(e) => { if (query == null) beforeTypingRef.current = value; onChange(e.target.value); setQuery(e.target.value); setActive(-1); setOpen(true); }}
        onKeyDown={onKeyDown}
        onBlur={() => { commitTyped(); close(); }}
        style={inputStyle}
      />
      <span aria-hidden="true" style={{ position: 'absolute', right: 7, top: '50%', transform: 'translateY(-50%)', color: '#94A3B8', fontSize: '0.6rem', pointerEvents: 'none' }}>▼</span>
      {open && pos && createPortal(
        <div
          ref={listRef}
          role="listbox"
          style={{
            position: 'fixed', zIndex: 10000, left: pos.left, width: Math.max(pos.width, 240),
            ...(pos.top != null ? { top: pos.top } : { bottom: pos.bottom }),
            maxHeight: 260, overflowY: 'auto', background: '#fff', border: '1px solid #CBD5E1',
            borderRadius: 6, boxShadow: '0 8px 24px rgba(15, 23, 42, 0.15)', padding: '0.2rem 0',
          }}
        >
          {shown.map((o, i) => (
            <div
              key={o}
              role="option"
              aria-selected={o === value}
              style={optionStyle(i === active)}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => { e.preventDefault(); pick(o); }}
            >
              <span style={{ width: 12, color: '#2563EB', fontWeight: 700 }}>{o === value ? '✓' : ''}</span>
              <span style={{ flex: 1 }}>{o}</span>
              <button
                type="button"
                title={`Remove "${o}" from the list (targets already using it keep it)`}
                aria-label={`Remove ${o} from the list`}
                onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); removeTargetTypeOption(o); }}
                style={{ background: 'none', border: 'none', color: '#94A3B8', cursor: 'pointer', fontSize: '0.75rem', padding: '0 2px' }}
              >✕</button>
            </div>
          ))}
          {isNew && (
            <div
              role="option"
              aria-selected={false}
              style={{ ...optionStyle(active === shown.length), color: '#2563EB', fontWeight: 600 }}
              onMouseEnter={() => setActive(shown.length)}
              onMouseDown={(e) => { e.preventDefault(); addTargetTypeOption(trimmed); pick(trimmed); }}
            >
              <span style={{ width: 12 }}>+</span>
              <span>Add &quot;{trimmed}&quot; to the list</span>
            </div>
          )}
          {!shown.length && !isNew && (
            <div style={{ padding: '0.4rem 0.6rem', fontSize: '0.78rem', color: '#64748B' }}>
              No types yet. Type one to add it.
            </div>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}
