// The popup behind a box header on the company card's Services board.
//
// Two things a box answers for as a whole: every service in it set to one
// status at once (a company that bought nothing in Climate Risk is four
// "Not Sold"s, not four trips to four dropdowns), and whether the box counts
// toward the % of services explored at all. The first is this company's;
// the second is a board setting, the same for every company, and the popup
// says so beside the checkbox.

import { useEffect, useMemo, useState } from 'react';
import { SERVICE_STATUSES } from '../../data/enums';

export default function ServiceBucketPopup({
  name,
  items,
  manualOf,
  effectiveOf,
  colorOf,
  counted,
  countLocked,
  onApply,
  onToggleCounted,
  onClose,
}) {
  const [status, setStatus] = useState('Not Sold');

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // How the box reads now, by the status each row is painted with.
  const tally = useMemo(() => {
    const m = new Map();
    for (const item of items) {
      const s = effectiveOf(item);
      m.set(s, (m.get(s) || 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [items, effectiveOf]);

  function apply() {
    // A status somebody typed on a row is a decision; overwriting a
    // different one deserves a second look before it goes.
    const target = status;
    const clobbered = items.filter(i => {
      const m = manualOf(i);
      return m !== '-' && m !== target;
    });
    if (clobbered.length) {
      const verb = target === '-' ? 'clear' : `replace with "${target}"`;
      const ok = window.confirm(
        `${clobbered.length} service${clobbered.length === 1 ? ' already has' : 's already have'} a status set by hand here. ${verb[0].toUpperCase()}${verb.slice(1)} on all ${items.length}?`,
      );
      if (!ok) return;
    }
    onApply(target);
  }

  const btn = {
    fontSize: '0.75rem', padding: '0.35rem 0.8rem', borderRadius: 4, cursor: 'pointer',
    fontFamily: 'inherit', fontWeight: 600,
  };

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.55)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}
      onClick={(e) => { e.stopPropagation(); onClose(); }}
    >
      <div
        role="dialog"
        aria-label={`${name} bucket`}
        onClick={(e) => e.stopPropagation()}
        style={{ background: 'var(--color-surface, #fff)', borderRadius: 8, boxShadow: '0 10px 30px rgba(0,0,0,0.25)', width: 'min(420px, 100%)', maxHeight: '85vh', overflowY: 'auto', fontSize: '0.8rem', color: 'var(--color-text, #1E293B)' }}
      >
        <div style={{ padding: '0.7rem 1rem', borderBottom: '1px solid var(--color-border, #E2E8F0)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: '0.95rem', color: '#1E40AF' }}>{name}</div>
            <div style={{ fontSize: '0.7rem', color: '#64748B' }}>
              {items.length} service{items.length === 1 ? '' : 's'} in this bucket
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', fontSize: '1.2rem', cursor: 'pointer', color: '#94A3B8', lineHeight: 1 }}>&times;</button>
        </div>

        <div style={{ padding: '0.8rem 1rem', borderBottom: '1px solid var(--color-border, #E2E8F0)' }}>
          <div style={{ fontWeight: 700, fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.03em', color: '#475569', marginBottom: '0.4rem' }}>
            Status for this company
          </div>
          {tally.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem', marginBottom: '0.6rem' }}>
              {tally.map(([s, n]) => {
                const c = colorOf(s);
                return (
                  <span key={s} style={{ fontSize: '0.68rem', fontWeight: 600, padding: '1px 6px', borderRadius: 999, background: c.bg || '#F1F5F9', color: c.color || '#475569' }}>
                    {s === '-' ? 'No status' : s}: {n}
                  </span>
                );
              })}
            </div>
          )}
          {items.length === 0 ? (
            <div style={{ fontSize: '0.72rem', color: '#94A3B8' }}>Nothing in this bucket to set.</div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.75rem' }}>Set all to</span>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                aria-label="Status for every service in this bucket"
                style={{ fontSize: '0.75rem', padding: '0.25rem 0.3rem', border: '1px solid var(--color-border, #CBD5E1)', borderRadius: 4, fontFamily: 'inherit' }}
              >
                {SERVICE_STATUSES.map(s => <option key={s} value={s}>{s === '-' ? '- (auto)' : s}</option>)}
              </select>
              <button
                type="button"
                onClick={apply}
                style={{ ...btn, border: '1px solid var(--color-accent, #3DCD58)', background: 'var(--color-accent, #3DCD58)', color: '#fff' }}
              >Apply to {items.length}</button>
            </div>
          )}
          {status === '-' && items.length > 0 && (
            <div style={{ marginTop: '0.4rem', fontSize: '0.68rem', color: '#64748B' }}>
              Clears the status set by hand, so each service goes back to what its opps say.
            </div>
          )}
        </div>

        <div style={{ padding: '0.8rem 1rem' }}>
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', cursor: countLocked ? 'not-allowed' : 'pointer', opacity: countLocked ? 0.6 : 1 }}>
            <input
              type="checkbox"
              checked={!countLocked && counted}
              disabled={countLocked}
              onChange={(e) => onToggleCounted(e.target.checked)}
              style={{ marginTop: 2 }}
            />
            <span>
              <span style={{ fontWeight: 600 }}>Count toward % of services explored</span>
              <span style={{ display: 'block', fontSize: '0.68rem', color: '#64748B', marginTop: 2 }}>
                {countLocked
                  ? 'Graveyard services are retired, so they never count.'
                  : 'Applies to this bucket on every company, not just this one.'}
              </span>
            </span>
          </label>
        </div>
      </div>
    </div>
  );
}
