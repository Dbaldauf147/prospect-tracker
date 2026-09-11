import { useState, useRef, useMemo, useEffect } from 'react';
import { matchContacts, isAddressList } from '../../utils/contactSuggest';

// An address box that finds the person for you.
//
// Type any part of a name, an address or a company and it offers the matching
// HubSpot contacts this browser has cached — the address is the one thing
// nobody remembers, and before this the only way to add somebody was to know
// how their mailbox is spelled.
//
// It is still a text box, and that matters: a contact HubSpot has never heard
// of is added by typing their address, a pasted list of addresses still goes
// in whole (suggestions stand down for anything with a ; or , in it), and
// with no contacts cached at all it behaves exactly as a plain input.
//
// Keyboard: ↓/↑ walk the list, Enter takes the highlighted contact, Escape
// closes it. Nothing is highlighted until ↓ walks into the list, so Enter on
// a half-typed address commits what was typed rather than jumping to whoever
// happened to rank first.
export function ContactSuggestInput({
  value, onChange, onSubmit, onPick, contacts, exclude, placeholder, style, disabled,
  emptyHint = 'No contact matches — type the full address to add it anyway.',
}) {
  const [open, setOpen] = useState(false);
  // Which row is highlighted, or -1 for none. Typing puts it back to none, so
  // Enter commits what was typed; and it is clamped at render because the list
  // shrinks under it as the query narrows.
  const [active, setActive] = useState(-1);
  const wrapRef = useRef(null);
  const inputRef = useRef(null);

  const list = useMemo(
    () => (isAddressList(value) ? [] : matchContacts(contacts, value, { exclude })),
    [contacts, value, exclude],
  );
  // A query worth searching that found nobody is worth saying so about: the
  // silence otherwise reads as "still loading" rather than "not on file".
  const searching = !isAddressList(value) && String(value || '').trim().length >= 2;
  const showEmpty = open && searching && list.length === 0 && (contacts || []).length > 0;
  const activeIdx = active < list.length ? active : -1;

  // Click anywhere else and the list goes away.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (!wrapRef.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const pick = (c) => {
    setOpen(false);
    setActive(-1);
    onPick?.(c);
    inputRef.current?.focus();
  };

  function onKeyDown(e) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!list.length) return;
      e.preventDefault();
      if (!open) { setOpen(true); return; }
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive(() => {
        const i = activeIdx;
        const n = i + step;
        if (n < -1) return list.length - 1;
        if (n >= list.length) return -1;
        return n;
      });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (open && activeIdx >= 0 && list[activeIdx]) pick(list[activeIdx]);
      else { setOpen(false); onSubmit?.(); }
    } else if (e.key === 'Escape') {
      if (open) { e.preventDefault(); setOpen(false); setActive(-1); }
    }
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative', flex: 1, maxWidth: style?.maxWidth ?? 340 }}>
      <input
        ref={inputRef}
        type="text"
        role={list.length ? 'combobox' : undefined}
        aria-expanded={list.length ? open : undefined}
        aria-autocomplete={list.length ? 'list' : undefined}
        autoComplete="off"
        disabled={disabled}
        value={value}
        placeholder={placeholder}
        onChange={(e) => { setActive(-1); onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        style={{ width: '100%', boxSizing: 'border-box', ...style, maxWidth: undefined }}
      />
      {(open && (list.length > 0 || showEmpty)) && (
        <div
          role="listbox"
          style={{
            position: 'absolute', top: 'calc(100% + 2px)', left: 0, right: 0, zIndex: 30,
            maxHeight: '260px', overflowY: 'auto', padding: '3px',
            background: 'var(--color-surface)', border: '1px solid var(--color-border)',
            borderRadius: '6px', boxShadow: '0 6px 18px rgba(15, 23, 42, 0.18)', textAlign: 'left',
          }}
        >
          {list.map((c, i) => (
            <div
              key={`${c.id}-${c.email}`}
              role="option"
              aria-selected={i === activeIdx}
              // mousedown, not click: a blur would tear the list down before a
              // click ever landed on it.
              onMouseDown={(e) => { e.preventDefault(); pick(c); }}
              onMouseEnter={() => setActive(i)}
              title={`${c.name}${c.company ? ` — ${c.company}` : ''}\n${c.email}`}
              style={{
                padding: '4px 6px', borderRadius: '4px', cursor: 'pointer', lineHeight: 1.25,
                background: i === activeIdx ? 'var(--color-accent)' : 'transparent',
                color: i === activeIdx ? '#fff' : 'var(--color-text)',
              }}
            >
              <div style={{ fontSize: '0.75rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {c.name}
                {c.company && (
                  <span style={{ fontWeight: 400, color: i === activeIdx ? 'rgba(255,255,255,0.85)' : 'var(--color-text-muted)' }}>
                    {' '}· {c.company}
                  </span>
                )}
              </div>
              <div style={{ fontSize: '0.68rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: i === activeIdx ? 'rgba(255,255,255,0.9)' : 'var(--color-text-secondary)' }}>
                {c.email}
              </div>
            </div>
          ))}
          {showEmpty && (
            <div style={{ padding: '4px 6px', fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>
              {emptyHint}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
