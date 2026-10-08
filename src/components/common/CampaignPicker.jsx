// A type-ahead picker for saved email campaigns.
//
// Replaces a <select> that could only be scrolled: with a few dozen saved
// campaigns the one you wanted was a long way down, and a native select
// only jumps on the first letter. Here the box lists the campaigns most
// recent first (the caller passes them in that order, see
// utils/campaignPicker.js) as soon as it is focused, and typing narrows
// them as you go, any word of the title or of another subject line counting.
//
// The best match is highlighted while you type, so Enter takes it: "q3 erc"
// then Enter is the whole interaction. ↓/↑ walk the list, Escape closes it
// and puts back what was picked before.
import { useEffect, useMemo, useRef, useState } from 'react';
import { matchPickerOptions } from '../../utils/campaignPicker';
import { useListAnchor } from './useListAnchor';

const LIST_MAX_H = 260;
const OPTION_H = 34;
const listHeight = (count) => Math.min(LIST_MAX_H, Math.max(1, count) * OPTION_H + 10);

const LIST_STYLE = {
  position: 'fixed', maxHeight: `${LIST_MAX_H}px`, overflowY: 'auto',
  background: '#fff', border: '1px solid #CBD5E1', borderRadius: 6,
  boxShadow: '0 6px 18px rgba(15, 23, 42, 0.18)', padding: 3, textAlign: 'left',
};
const OPTION_STYLE = {
  padding: '4px 7px', borderRadius: 4, fontSize: '0.74rem', cursor: 'pointer',
  color: '#1E293B', overflow: 'hidden',
};

/**
 * options  - [{ key, label, text?, detail? }] in the order to show them;
 *            `text` is matched but not shown, `detail` is the grey second line
 * value    - the picked option's key, or ''
 * onChange - called with a key when one is picked, and '' when the box is
 *            typed into (what was picked no longer matches what it says)
 */
export function CampaignPicker({
  options, value, onChange, placeholder = 'Type to search campaigns...',
  disabled = false, title, ariaLabel = 'Campaign', emptyText = 'No campaign matches', style, zIndex = 10050,
}) {
  const picked = useMemo(() => (options || []).find(o => o.key === value) || null, [options, value]);
  const [query, setQuery] = useState(picked ? picked.label : '');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  // What was picked when the box was focused, for Escape to put back.
  const pickedOnFocus = useRef('');

  // Cleared or picked from outside (after an add, say): show what it now is.
  // Not when it was cleared by typing into the box, which is what the open
  // list means; that would wipe out what is being typed.
  const [seenValue, setSeenValue] = useState(value);
  if (value !== seenValue) {
    setSeenValue(value);
    if (picked) setQuery(picked.label);
    else if (!open) setQuery('');
  }

  // The picked campaign's own title in the box means nothing has been typed
  // since, so the whole list is offered rather than just that one.
  const typed = picked && query === picked.label ? '' : query;
  const matches = useMemo(() => matchPickerOptions(options || [], typed), [options, typed]);
  const pos = useListAnchor(open, inputRef, listHeight(matches.length));

  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const pick = (o) => {
    onChange(o.key);
    setQuery(o.label);
    setOpen(false);
    setActive(-1);
  };

  function onKeyDown(e) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) { setOpen(true); return; }
      if (!matches.length) return;
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive(i => (i + step + matches.length) % matches.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (open && matches[active]) pick(matches[active]);
    } else if (e.key === 'Escape') {
      if (!open) return;
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      const back = (options || []).find(o => o.key === pickedOnFocus.current) || null;
      if (back && back.key !== value) onChange(back.key);
      setQuery(back ? back.label : '');
    }
  }

  return (
    <div style={{ position: 'relative', display: 'inline-block', minWidth: 0, ...style }}>
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        aria-label={ariaLabel}
        autoComplete="off"
        spellCheck={false}
        disabled={disabled}
        title={title}
        value={query}
        placeholder={placeholder}
        onFocus={(e) => { pickedOnFocus.current = value || ''; setOpen(true); setActive(-1); e.target.select(); }}
        onChange={(e) => {
          const next = e.target.value;
          setQuery(next);
          setOpen(true);
          if (value) onChange('');
          // Highlight the best match so Enter takes it; nothing typed, nothing highlighted.
          setActive(next.trim() ? 0 : -1);
        }}
        onKeyDown={onKeyDown}
        onBlur={() => {
          setOpen(false);
          setActive(-1);
          if (!value) setQuery(q => (q.trim() ? q : ''));
        }}
        style={{
          width: '100%', boxSizing: 'border-box', padding: '0.25rem 0.45rem',
          border: `1px solid ${value ? '#93C5FD' : '#CBD5E1'}`, borderRadius: 6,
          fontSize: '0.76rem', fontFamily: 'inherit', background: disabled ? '#F8FAFC' : '#fff',
          color: '#1E293B', fontWeight: value ? 600 : 400,
        }}
      />
      {open && pos && (
        <div style={{ ...LIST_STYLE, ...pos, zIndex }} role="listbox" ref={listRef}>
          {matches.length === 0 ? (
            <div style={{ ...OPTION_STYLE, cursor: 'default', color: '#94A3B8' }}>{emptyText}</div>
          ) : matches.map((o, i) => {
            const on = i === active;
            return (
              <div
                key={o.key}
                role="option"
                aria-selected={on}
                data-active={on ? 'true' : undefined}
                title={o.label}
                onMouseDown={(e) => { e.preventDefault(); pick(o); }}
                onMouseEnter={() => setActive(i)}
                style={{ ...OPTION_STYLE, background: on ? '#2563EB' : o.key === value ? '#EFF6FF' : 'transparent', color: on ? '#fff' : OPTION_STYLE.color }}
              >
                <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{o.label}</div>
                {o.detail && (
                  <div style={{ fontSize: '0.66rem', color: on ? '#DBEAFE' : '#64748B', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{o.detail}</div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
