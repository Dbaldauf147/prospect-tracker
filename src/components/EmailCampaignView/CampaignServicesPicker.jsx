// Pick the services an email campaign is about (utils/campaignServices).
// Shows the chosen services as chips; clicking opens a searchable checklist
// of the Services board, and a name typed that isn't on it can be added as is.
// Every tick goes to onChange straight away.
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const chip = {
  display: 'inline-block', padding: '1px 7px', borderRadius: 999, fontSize: '0.65rem', fontWeight: 600,
  background: '#EEF2FF', border: '1px solid #C7D2FE', color: '#3730A3', whiteSpace: 'nowrap',
};

export function CampaignServicesPicker({ value = [], options = [], onChange, compact = false, label }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [rect, setRect] = useState(null);
  const btnRef = useRef(null);
  const popRef = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (popRef.current?.contains(e.target) || btnRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    const onScroll = () => setRect(btnRef.current?.getBoundingClientRect() || null);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open]);

  const chosen = useMemo(() => new Set(value.map(v => v.toLowerCase())), [value]);
  // Chosen services first (including any no longer on the board), then the rest.
  const all = useMemo(() => {
    const onBoard = new Set(options.map(o => o.toLowerCase()));
    return [...value.filter(v => !onBoard.has(v.toLowerCase())), ...options];
  }, [options, value]);
  const term = q.trim().toLowerCase();
  const shown = term ? all.filter(n => n.toLowerCase().includes(term)) : all;
  const canAdd = term && !all.some(n => n.toLowerCase() === term);

  const toggle = (name) => {
    if (!onChange) return;
    const has = chosen.has(name.toLowerCase());
    onChange(has ? value.filter(v => v.toLowerCase() !== name.toLowerCase()) : [...value, name]);
  };
  const toggleOpen = () => {
    if (!onChange) return;
    setRect(btnRef.current?.getBoundingClientRect() || null);
    setQ('');
    setOpen(o => !o);
  };

  return (
    <span data-campaign-services style={{ display: 'inline-flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
      {label && <span>{label}</span>}
      <button
        ref={btnRef}
        type="button"
        onClick={toggleOpen}
        aria-label="Services for this campaign"
        title={value.length ? `Services: ${value.join(', ')}. Click to change.` : 'Tag the services this campaign is about'}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 4, flexWrap: 'wrap', textAlign: 'left',
          padding: value.length ? '2px 4px' : '1px 6px', borderRadius: 4, fontFamily: 'inherit', cursor: onChange ? 'pointer' : 'default',
          border: value.length ? '1px solid transparent' : '1px dashed var(--color-border)', background: 'transparent',
          color: 'var(--color-text-secondary)', fontSize: compact ? '0.7rem' : '0.65rem', fontWeight: 600,
          maxWidth: compact ? 240 : undefined,
        }}
      >
        {value.length
          ? value.map(v => <span key={v} style={chip}>{v}</span>)
          : '+ Add services'}
      </button>
      {open && rect && createPortal(
        <div
          ref={popRef}
          data-campaign-services-menu
          style={{
            position: 'fixed', top: Math.min(rect.bottom + 4, window.innerHeight - 320), left: Math.min(rect.left, window.innerWidth - 290),
            width: 280, maxHeight: 310, display: 'flex', flexDirection: 'column', zIndex: 2000,
            background: 'var(--color-surface, #fff)', border: '1px solid var(--color-border)', borderRadius: 8,
            boxShadow: '0 8px 24px rgba(15,23,42,0.15)', fontSize: '0.75rem',
          }}
        >
          <div style={{ padding: 6, borderBottom: '1px solid var(--color-border)' }}>
            <input
              autoFocus
              value={q}
              onChange={e => setQ(e.target.value)}
              onKeyDown={e => {
                if (e.key !== 'Enter') return;
                e.preventDefault();
                if (canAdd) { onChange([...value, q.trim()]); setQ(''); }
                else if (shown.length === 1) toggle(shown[0]);
              }}
              placeholder="Search services..."
              style={{ width: '100%', boxSizing: 'border-box', padding: '0.3rem 0.5rem', border: '1px solid var(--color-border)', borderRadius: 4, fontSize: '0.75rem', fontFamily: 'inherit' }}
            />
          </div>
          <div style={{ overflowY: 'auto', flex: 1, padding: '4px 0' }}>
            {canAdd && (
              <button
                type="button"
                onClick={() => { onChange([...value, q.trim()]); setQ(''); }}
                style={{ display: 'block', width: '100%', textAlign: 'left', padding: '4px 10px', border: 'none', background: '#F8FAFC', cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.75rem', color: 'var(--color-accent)', fontWeight: 600 }}
              >+ Add &quot;{q.trim()}&quot;</button>
            )}
            {shown.map(name => (
              <label key={name} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 10px', cursor: 'pointer', color: 'var(--color-text)' }}>
                <input type="checkbox" checked={chosen.has(name.toLowerCase())} onChange={() => toggle(name)} />
                <span>{name}</span>
              </label>
            ))}
            {!shown.length && !canAdd && <div style={{ padding: '6px 10px', color: 'var(--color-text-muted)' }}>No services on the Services list yet.</div>}
          </div>
          {value.length > 0 && (
            <div style={{ padding: 6, borderTop: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: 'var(--color-text-muted)' }}>{value.length} selected</span>
              <button type="button" onClick={() => onChange([])} style={{ border: 'none', background: 'none', color: '#DC2626', cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.7rem', fontWeight: 600 }}>Clear</button>
            </div>
          )}
        </div>,
        document.body,
      )}
    </span>
  );
}
