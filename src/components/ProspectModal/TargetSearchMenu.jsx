// Targets tab > "Search web": a drop-down of preset Google searches for the
// company (config/targetWebSearches), each a real link opening in a new tab,
// so middle-click and Cmd/Ctrl-click work as they do on any link.
// Keyboard: Enter / Space / ArrowDown on the button opens it on the first
// item; ArrowUp / ArrowDown / Home / End move; Escape closes and returns to
// the button; Tab or a click outside closes it.
import { useEffect, useMemo, useRef, useState } from 'react';
import { buildTargetSearchLinks } from '../../utils/targetWebSearch';

const menuStyle = {
  position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 50, minWidth: 250,
  background: '#fff', border: '1px solid #E2E8F0', borderRadius: 8, padding: '4px 0',
  boxShadow: '0 8px 24px rgba(15, 23, 42, 0.12)',
};
const itemStyle = {
  display: 'block', padding: '6px 12px', fontSize: '0.8rem', color: '#1E293B',
  textDecoration: 'none', whiteSpace: 'nowrap', outline: 'none',
};

export function TargetSearchMenu({ company, website, emailDomain, buttonStyle }) {
  // Each link carries its position among the links (dividers skipped), which
  // is what the arrow keys move through.
  const items = useMemo(() => {
    const list = buildTargetSearchLinks({ company, website, emailDomain });
    return list.map((item, i) => (item.divider ? item
      : { ...item, idx: list.slice(0, i).filter(x => !x.divider).length }));
  }, [company, website, emailDomain]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrapRef = useRef(null);
  const buttonRef = useRef(null);
  const linkRefs = useRef([]);
  const links = items.filter(i => !i.divider);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  useEffect(() => {
    if (open) linkRefs.current[active]?.focus();
  }, [open, active]);

  const openAt = (i) => { setActive(i); setOpen(true); };
  const close = (refocus) => {
    setOpen(false);
    if (refocus) buttonRef.current?.focus();
  };

  const onButtonKey = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openAt(0); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); openAt(links.length - 1); }
  };
  const onMenuKey = (e) => {
    const n = links.length;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => (i + 1) % n); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => (i - 1 + n) % n); }
    else if (e.key === 'Home') { e.preventDefault(); setActive(0); }
    else if (e.key === 'End') { e.preventDefault(); setActive(n - 1); }
    else if (e.key === 'Tab') close(false);
  };

  const disabled = !links.length;
  return (
    <div ref={wrapRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => (open ? close(false) : openAt(0))}
        onKeyDown={onButtonKey}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        title={disabled ? 'Give the company a name to search for it' : 'Search the web for this company\'s targets'}
        style={{ ...buttonStyle, opacity: disabled ? 0.5 : 1, cursor: disabled ? 'default' : 'pointer' }}
      >
        Search web &#9662;
      </button>
      {open && (
        <div role="menu" aria-label="Search the web" style={menuStyle} onKeyDown={onMenuKey}>
          {items.map((item, i) => {
            if (item.divider) {
              return <div key={`d${i}`} role="separator" style={{ height: 1, background: '#E2E8F0', margin: '4px 0' }} />;
            }
            const { idx } = item;
            const isActive = idx === active;
            return (
              <a
                key={item.label}
                ref={el => { linkRefs.current[idx] = el; }}
                role="menuitem"
                href={item.href}
                target="_blank"
                rel="noopener noreferrer"
                tabIndex={isActive ? 0 : -1}
                onMouseEnter={() => setActive(idx)}
                onClick={() => close(false)}
                style={{ ...itemStyle, background: isActive ? '#EFF6FF' : 'transparent', color: isActive ? '#1D4ED8' : itemStyle.color }}
              >
                {item.label}
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}
