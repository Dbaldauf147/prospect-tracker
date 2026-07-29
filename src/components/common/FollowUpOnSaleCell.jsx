import { useState, useRef } from 'react';
import { createPortal } from 'react-dom';

// Inline editor for a deal's Follow Up On Sale date, used on the Post-Sale
// Follow-Up surfaces (the Clients subtab and the Pipeline dashboard mirror).
// That column is a date across the app (DEAL_DATE_KEYS), so recording a
// follow-up means stamping the date it happened — stored in the same M/D/YYYY
// shape the Deals subtab uses. A deal that never needs a post-sale follow-up
// can instead be marked "N/A". Either way the deal's "missing" flag clears and
// the row drops off the follow-up list on the next render. The editor opens in
// a portal popover anchored to the badge (like the Deals tab's Progress cell)
// so it can't be clipped by the table's overflow.
//
// onSave(deal, value) receives the deal row and the new value — an M/D/YYYY
// date string, the literal 'N/A', or an empty string to clear; the caller
// persists it through the shared deals override.
export function FollowUpOnSaleCell({ deal, onSave }) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState(null);
  const btnRef = useRef(null);

  function openPopover(e) {
    e.stopPropagation();
    const rect = btnRef.current?.getBoundingClientRect();
    if (rect) setAnchor({ left: rect.left, top: rect.bottom + 4 });
    setOpen(true);
  }

  function saveMDY(mdY) {
    onSave(deal, mdY);
    setOpen(false);
  }
  function saveFromISO(iso) {
    if (!iso) return;
    const [y, m, d] = iso.split('-').map(Number);
    if (!y || !m || !d) return;
    saveMDY(`${m}/${d}/${y}`);
  }
  function saveToday() {
    const t = new Date();
    saveMDY(`${t.getMonth() + 1}/${t.getDate()}/${t.getFullYear()}`);
  }
  function saveNA() {
    saveMDY('N/A');
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={openPopover}
        title="Click to record the date this deal's post-sale follow-up happened"
        style={{ display: 'inline-block', padding: '1px 8px', borderRadius: 999, fontSize: '0.62rem', fontWeight: 700, background: '#FEE2E2', color: '#B91C1C', border: '1px solid #FCA5A5', cursor: 'pointer', fontFamily: 'inherit' }}
      >
        Missing
      </button>
      {open && createPortal(
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 4999, background: 'transparent' }} />
          <div
            onClick={e => e.stopPropagation()}
            style={{ position: 'fixed', left: Math.min(anchor?.left ?? 0, (window.innerWidth || 1200) - 260), top: anchor?.top ?? 0, zIndex: 5000, background: '#fff', border: '1px solid #CBD5E1', borderRadius: 8, boxShadow: '0 10px 30px rgba(15, 23, 42, 0.18)', padding: '0.6rem 0.7rem', width: 244 }}
          >
            <div style={{ fontSize: '0.66rem', fontWeight: 700, color: '#475569', marginBottom: '0.4rem' }}>Record follow-up date</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input
                type="date"
                autoFocus
                onChange={e => saveFromISO(e.target.value)}
                onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); setOpen(false); } }}
                style={{ flex: 1, minWidth: 0, padding: '3px 5px', border: '1px solid #3B82F6', borderRadius: 4, fontSize: '0.72rem', fontFamily: 'inherit' }}
              />
              <button type="button" onClick={saveToday} title="Set to today" style={{ padding: '3px 8px', borderRadius: 4, border: '1px solid #CBD5E1', background: '#F8FAFC', color: '#334155', fontSize: '0.66rem', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>Today</button>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: '0.45rem', paddingTop: '0.45rem', borderTop: '1px solid #E2E8F0' }}>
              <span style={{ flex: 1, fontSize: '0.62rem', color: '#64748B' }}>No follow-up needed?</span>
              <button type="button" onClick={saveNA} title="Mark this deal as not applicable — no post-sale follow-up needed" style={{ padding: '3px 10px', borderRadius: 4, border: '1px solid #CBD5E1', background: '#F8FAFC', color: '#334155', fontSize: '0.66rem', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>N/A</button>
            </div>
          </div>
        </>,
        document.body,
      )}
    </>
  );
}
