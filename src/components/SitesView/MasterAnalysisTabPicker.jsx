import { useState } from 'react';
import { createPortal } from 'react-dom';
import {
  MASTER_ANALYSIS_TAB_GROUPS,
  MASTER_ANALYSIS_TAB_NAMES,
  normalizeTabSelection,
} from '../../utils/masterAnalysisTabs.js';

// The last set of tabs picked, so someone who always leaves out the same
// few doesn't untick them on every download. Per browser, and only a
// convenience: when it can't be read, every tab starts ticked.
const STORAGE_KEY = 'masterAnalysisTabs.v1';

function loadSelection() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) return normalizeTabSelection(JSON.parse(raw));
  } catch { /* fall through to everything ticked */ }
  return [...MASTER_ANALYSIS_TAB_NAMES];
}

function saveSelection(names) {
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(names)); } catch { /* not worth failing a download over */ }
}

// Pop-up shown by the Utility Lookup page's "Master Analysis" button: a
// checklist of the workbook's tabs, grouped by the section they come from.
// `onDownload` receives the ticked tab names and resolves once the file is
// built; the pop-up stays open (and says so) while that runs.
export function MasterAnalysisTabPicker({ onClose, onDownload }) {
  const [selected, setSelected] = useState(() => new Set(loadSelection()));
  const [busy, setBusy] = useState(false);

  const toggle = (name) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(name)) next.delete(name); else next.add(name);
    return next;
  });
  const setGroup = (group, on) => setSelected((prev) => {
    const next = new Set(prev);
    for (const t of group.tabs) { if (on) next.add(t.name); else next.delete(t.name); }
    return next;
  });

  const count = selected.size;
  const total = MASTER_ANALYSIS_TAB_NAMES.length;

  const download = async () => {
    if (busy || count === 0) return;
    const tabs = MASTER_ANALYSIS_TAB_NAMES.filter(n => selected.has(n));
    saveSelection(tabs);
    setBusy(true);
    try {
      await onDownload(tabs);
    } finally {
      setBusy(false);
    }
  };

  const linkBtn = {
    background: 'none', border: 'none', padding: 0, color: '#005A9E', fontSize: '0.72rem',
    cursor: 'pointer', fontFamily: 'inherit', textDecoration: 'underline',
  };

  return createPortal(
    <div
      onClick={() => { if (!busy) onClose(); }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.4)', zIndex: 10000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        role="dialog"
        aria-label="Choose Master Analysis tabs"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#fff', borderRadius: 8, width: 'min(520px, 92vw)', maxHeight: '80vh',
          display: 'flex', flexDirection: 'column', boxShadow: '0 12px 40px rgba(15, 23, 42, 0.2)',
        }}
      >
        <div style={{ padding: '0.9rem 1rem 0.6rem', borderBottom: '1px solid #E2E8F0' }}>
          <div style={{ fontSize: '0.95rem', fontWeight: 700, color: '#0F172A' }}>Download Master Analysis</div>
          <div style={{ fontSize: '0.72rem', color: '#64748B', marginTop: '0.2rem' }}>
            Tick the tabs you want in the Excel file. Tabs that don't apply to this portfolio are left out either way.
          </div>
          <div style={{ display: 'flex', gap: '0.8rem', marginTop: '0.5rem', alignItems: 'center' }}>
            <button type="button" style={linkBtn} onClick={() => setSelected(new Set(MASTER_ANALYSIS_TAB_NAMES))}>Select all</button>
            <button type="button" style={linkBtn} onClick={() => setSelected(new Set())}>Clear all</button>
            <span style={{ marginLeft: 'auto', fontSize: '0.72rem', color: '#64748B' }}>{count} of {total} tabs</span>
          </div>
        </div>
        <div style={{ overflowY: 'auto', flex: 1, padding: '0.4rem 1rem 0.6rem' }}>
          {MASTER_ANALYSIS_TAB_GROUPS.map((group) => {
            const on = group.tabs.filter(t => selected.has(t.name)).length;
            const all = on === group.tabs.length;
            return (
              <div key={group.label} style={{ marginTop: '0.5rem' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.8rem', fontWeight: 700, color: '#0F172A', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={all}
                    ref={(el) => { if (el) el.indeterminate = on > 0 && !all; }}
                    onChange={() => setGroup(group, !all)}
                  />
                  {group.label}
                </label>
                <div style={{ marginLeft: '1.4rem' }}>
                  {group.tabs.map((t) => (
                    <label
                      key={t.name}
                      title={t.hint}
                      style={{ display: 'flex', alignItems: 'baseline', gap: '0.45rem', padding: '0.15rem 0', fontSize: '0.78rem', color: '#1E293B', cursor: 'pointer' }}
                    >
                      <input type="checkbox" checked={selected.has(t.name)} onChange={() => toggle(t.name)} />
                      <span>
                        {t.name}
                        <span style={{ color: '#94A3B8', fontSize: '0.7rem' }}> - {t.hint}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        <div style={{ padding: '0.6rem 1rem', borderTop: '1px solid #E2E8F0', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '0.4rem' }}>
          {!selected.has('Site List') && (
            <span style={{ marginRight: 'auto', fontSize: '0.68rem', color: '#B45309' }}>
              Without Site List the file can't be imported back onto this page.
            </span>
          )}
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            style={{ padding: '0.35rem 0.8rem', background: '#fff', border: '1px solid #CBD5E1', borderRadius: 6, fontSize: '0.78rem', cursor: busy ? 'default' : 'pointer', fontFamily: 'inherit' }}
          >Cancel</button>
          <button
            type="button"
            onClick={download}
            disabled={busy || count === 0}
            style={{
              padding: '0.35rem 0.9rem', border: '1px solid #005A9E', background: '#005A9E', color: '#fff',
              borderRadius: 6, fontSize: '0.78rem', fontWeight: 600, fontFamily: 'inherit',
              cursor: busy || count === 0 ? 'default' : 'pointer', opacity: busy || count === 0 ? 0.6 : 1,
            }}
          >{busy ? 'Building…' : `⬇ Download (${count})`}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
