import { useEffect, useState } from 'react';
import { KeyContactsView } from '../KeyContactsView/KeyContactsView';
import { ActiveContactsView } from '../ActiveContactsView/ActiveContactsView';
import { ClientContactsView } from '../ClientContactsView/ClientContactsView';

// One stop shop: stacks Key Contacts, Active Contacts, and Client
// Contacts back-to-back behind collapsible headers so the user can
// see the three rosters in one scroll without losing the existing
// per-section filtering / search / column controls each view ships
// with on its own.
//
// Each section header click toggles a single section. Collapsed
// state persists in localStorage so a refresh keeps the user's
// folded layout. The three subviews are rendered conditionally so
// the heavier ones (Key Contacts in particular, with its full
// HubSpot table) don't pay layout cost while collapsed.

const STORAGE_KEY = 'all-contacts-view:section-state';
const SECTIONS = [
  { key: 'key',     label: 'Key Contacts',    view: KeyContactsView },
  { key: 'active',  label: 'Active Contacts', view: ActiveContactsView },
  { key: 'clients', label: 'Client Contacts', view: ClientContactsView },
];

function readSavedState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return SECTIONS.reduce((acc, s) => {
      acc[s.key] = saved[s.key] !== false; // default open
      return acc;
    }, {});
  } catch {
    return Object.fromEntries(SECTIONS.map(s => [s.key, true]));
  }
}

export function AllContactsView({ prospects, onSelectProspect, settings, updateSettings, cdmName }) {
  const [open, setOpen] = useState(readSavedState);
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(open)); } catch { /* ignore */ }
  }, [open]);

  const allOpen = SECTIONS.every(s => open[s.key]);
  const noneOpen = SECTIONS.every(s => !open[s.key]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.75rem 1rem 0', flexShrink: 0 }}>
        <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
          All three rosters in one scroll. Click a section header to collapse / expand.
        </div>
        <div style={{ display: 'inline-flex', gap: 4 }}>
          <button
            type="button"
            onClick={() => setOpen(Object.fromEntries(SECTIONS.map(s => [s.key, true])))}
            disabled={allOpen}
            style={{ fontSize: '0.7rem', padding: '0.25rem 0.55rem', border: '1px solid var(--color-border)', background: '#fff', color: allOpen ? '#CBD5E1' : 'var(--color-text-secondary)', borderRadius: 4, cursor: allOpen ? 'default' : 'pointer', fontFamily: 'inherit', fontWeight: 600 }}
          >Expand all</button>
          <button
            type="button"
            onClick={() => setOpen(Object.fromEntries(SECTIONS.map(s => [s.key, false])))}
            disabled={noneOpen}
            style={{ fontSize: '0.7rem', padding: '0.25rem 0.55rem', border: '1px solid var(--color-border)', background: '#fff', color: noneOpen ? '#CBD5E1' : 'var(--color-text-secondary)', borderRadius: 4, cursor: noneOpen ? 'default' : 'pointer', fontFamily: 'inherit', fontWeight: 600 }}
          >Collapse all</button>
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '0.5rem 0 1rem' }}>
        {SECTIONS.map((s) => {
          const isOpen = !!open[s.key];
          const View = s.view;
          return (
            <section key={s.key} style={{ borderTop: '1px solid var(--color-border-light)', marginTop: '0.5rem' }}>
              <header
                onClick={() => setOpen(prev => ({ ...prev, [s.key]: !prev[s.key] }))}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  cursor: 'pointer',
                  userSelect: 'none',
                  padding: '0.5rem 1rem',
                  background: '#F8FAFC',
                  borderBottom: isOpen ? '1px solid var(--color-border)' : '1px solid transparent',
                  position: 'sticky',
                  top: 0,
                  zIndex: 1,
                }}
              >
                <span style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', transform: isOpen ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 0.15s', display: 'inline-block', lineHeight: 1 }}>▼</span>
                <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700, color: 'var(--color-text)' }}>{s.label}</h3>
              </header>
              {isOpen && (
                <div style={{ minHeight: 0 }}>
                  <View
                    prospects={prospects}
                    onSelectProspect={onSelectProspect}
                    settings={settings}
                    updateSettings={updateSettings}
                    cdmName={cdmName}
                  />
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
