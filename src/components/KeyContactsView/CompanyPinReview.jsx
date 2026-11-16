// The review dialog shared by Recover company mappings and Undo recovered
// mappings: every contact the action would change, one row each, with a
// tick deciding whether it changes. Rows come from utils/companyPinReview.
import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { DataTable } from '../common/DataTable';

const btn = {
  padding: '0.4rem 0.85rem', fontSize: '0.78rem', fontWeight: 600, borderRadius: 6,
  border: '1px solid #CBD5E1', background: '#fff', color: '#334155', cursor: 'pointer', fontFamily: 'inherit',
};

/**
 * `rows`: [{ id, name, email, hubspotCompany, pin, why, from, tick }].
 * `onApply(ids)` gets the ticked ids; `onClose()` closes without changing anything.
 */
export function CompanyPinReview({ tableId, title, intro, rows, applyLabel, onApply, onClose, settings, updateSettings, footnote }) {
  const [ticked, setTicked] = useState(() => new Set(rows.filter(r => r.tick).map(r => r.id)));
  const [shown, setShown] = useState(rows);
  const toggle = (id) => setTicked((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const setMany = (list, on) => setTicked((prev) => {
    const next = new Set(prev);
    for (const r of list) { if (on) next.add(r.id); else next.delete(r.id); }
    return next;
  });

  const columns = useMemo(() => [
    {
      key: 'pick',
      label: 'Change',
      defaultWidth: 84,
      getFilterValue: (r) => (ticked.has(r.id) ? 'Ticked' : 'Not ticked'),
      render: (r) => (
        <input
          type="checkbox"
          checked={ticked.has(r.id)}
          onChange={() => toggle(r.id)}
          onClick={(e) => e.stopPropagation()}
          aria-label={`Change ${r.name}`}
        />
      ),
    },
    { key: 'name', label: 'Contact', defaultWidth: 180 },
    { key: 'email', label: 'Email', defaultWidth: 200 },
    { key: 'hubspotCompany', label: 'Company in HubSpot', defaultWidth: 200, render: (r) => r.hubspotCompany || '(none)' },
    { key: 'pin', label: 'Pinned company', defaultWidth: 200 },
    { key: 'why', label: 'Why it looks wrong', defaultWidth: 240, render: (r) => r.why || '-' },
    { key: 'from', label: 'Backup', defaultWidth: 260, render: (r) => r.from || '-' },
  ], [ticked]);

  return createPortal(
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div role="dialog" aria-label={title} style={{ background: '#fff', borderRadius: 10, width: 'min(1200px, 100%)', maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 50px rgba(0,0,0,0.25)' }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid #E2E8F0' }}>
          <div style={{ fontSize: '1rem', fontWeight: 700, color: '#0F172A' }}>{title}</div>
          <div style={{ fontSize: '0.8rem', color: '#475569', marginTop: 6, whiteSpace: 'pre-line' }}>{intro}</div>
        </div>
        <div style={{ padding: '8px 18px', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button type="button" style={btn} onClick={() => setMany(shown, true)}>Tick all shown</button>
          <button type="button" style={btn} onClick={() => setMany(shown, false)}>Untick all shown</button>
          <span style={{ fontSize: '0.78rem', color: '#475569' }}>{ticked.size} of {rows.length} ticked</span>
        </div>
        <div style={{ height: 'min(60vh, 560px)', display: 'flex', flexDirection: 'column', minHeight: 0, padding: '0 18px' }}>
          <DataTable
            tableId={tableId}
            columns={columns}
            rows={rows}
            alwaysVisible={['pick', 'name']}
            onFilteredRowsChange={setShown}
            emptyMessage="Nothing to review"
            settings={settings}
            updateSettings={updateSettings}
          />
        </div>
        <div style={{ padding: '12px 18px', borderTop: '1px solid #E2E8F0', display: 'flex', gap: 8, justifyContent: 'flex-end', alignItems: 'center' }}>
          {footnote && <span style={{ fontSize: '0.72rem', color: '#64748B', marginRight: 'auto', whiteSpace: 'pre-line' }}>{footnote}</span>}
          <button type="button" style={btn} onClick={onClose}>Cancel</button>
          <button
            type="button"
            disabled={ticked.size === 0}
            onClick={() => onApply([...ticked])}
            style={{ ...btn, background: ticked.size ? '#1D4ED8' : '#94A3B8', borderColor: 'transparent', color: '#fff', cursor: ticked.size ? 'pointer' : 'not-allowed' }}
          >{applyLabel} ({ticked.size})</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
