import { useState, useEffect, useCallback } from 'react';
import { AuthProvider } from './contexts/AuthContext';
import { OppsView2 } from './components/OppsView2/OppsView2';
import { DropdownsView } from './components/DropdownsView/DropdownsView';

// Standalone wrapper around the two real views. In the full app these
// receive their props from the top-level App (a shared `settings` object
// synced to Firestore, a Firestore-backed prospect roster, and a handful
// of setters). Here we supply all of that locally:
//
//   - settings        → an object persisted to localStorage, so dropdown
//                        edits made on the Dropdowns tab survive a reload
//                        and are visible to the Opps tab (they share it)
//   - updateSettings  → merges a patch into that object
//   - prospects       → a tiny sample roster so the Account / BFO Company
//                        autocompletes have something to suggest
//   - updateProspect / addProspect / onSelectProspect → no-ops (these
//        only matter for round-tripping edits back to the prospect table,
//        which isn't part of this export)
//
// The Opps dataset itself is seeded from src/data/sampleData.js into the
// localStorage-backed cache the first time the page loads (see
// src/utils/opps2Store.js).

const SETTINGS_KEY = 'odx::settings';

// A couple of sample prospects so the Account column autocomplete and the
// BFO Company Name linking have data to work with.
const SAMPLE_PROSPECTS = [
  { id: 'p1', company: 'Acme Property Group', type: 'Owner Operator', peOwner: 'Blackstone', cdm: 'Dan Baldauf' },
  { id: 'p2', company: 'Northwind Logistics', type: 'Operator', peOwner: '', cdm: 'Dan Baldauf' },
  { id: 'p3', company: 'Harbor Point Holdings', type: 'RE Investment Manager', peOwner: 'KKR', cdm: 'Dan Baldauf' },
  { id: 'p4', company: 'Summit Facilities Mgmt', type: 'Facility Manager', peOwner: '', cdm: 'Dan Baldauf' },
];

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

export default function OppsDropdownsApp() {
  const [tab, setTab] = useState('opps');
  const [settings, setSettings] = useState(loadSettings);

  useEffect(() => {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* quota */ }
  }, [settings]);

  const updateSettings = useCallback((patch) => {
    setSettings((prev) => ({ ...prev, ...patch }));
  }, []);

  const noop = useCallback(() => {}, []);

  return (
    <AuthProvider>
      <div
        style={{
          height: '100vh',
          display: 'flex',
          flexDirection: 'column',
          background: '#F8FAFC',
          fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
        }}
      >
        <header style={tabBar}>
          <span style={{ fontWeight: 700, marginRight: 16, color: '#0f172a' }}>
            Prospect Tracker — export
          </span>
          <button style={tab === 'opps' ? tabActive : tabBtn} onClick={() => setTab('opps')}>
            Opps
          </button>
          <button style={tab === 'dropdowns' ? tabActive : tabBtn} onClick={() => setTab('dropdowns')}>
            Dropdowns
          </button>
        </header>

        <main style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
          {/* Both views are kept mounted? No — render the active one. The
              Opps view holds a lot of state, so we only mount it when shown. */}
          {tab === 'opps' ? (
            <OppsView2
              settings={settings}
              updateSettings={updateSettings}
              prospects={SAMPLE_PROSPECTS}
              updateProspect={noop}
              addProspect={noop}
              onSelectProspect={noop}
            />
          ) : (
            <DropdownsView settings={settings} updateSettings={updateSettings} />
          )}
        </main>
      </div>
    </AuthProvider>
  );
}

const tabBar = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '10px 16px',
  borderBottom: '1px solid #e2e8f0',
  background: '#fff',
};

const tabBtn = {
  border: '1px solid #e2e8f0',
  background: '#fff',
  color: '#334155',
  borderRadius: 8,
  padding: '6px 16px',
  cursor: 'pointer',
  fontSize: 14,
  fontWeight: 600,
};

const tabActive = { ...tabBtn, background: '#0f172a', color: '#fff', borderColor: '#0f172a' };
