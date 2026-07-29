import { useState, useEffect, useCallback } from 'react';
import { AuthProvider } from './contexts/AuthContext';
import { AgentsView } from './components/AgentsView/AgentsView';
import { loadOpps2Cache } from './utils/opps2Store';
import { seedAgentsDemo, SAMPLE_SETTINGS } from './data/sampleData';

// Standalone wrapper around the real Agents page.
//
// In the full app the Agents view receives its props from the top-level
// App: a shared `settings` object synced to Firestore (which carries the
// user's work email, marketing-lead roster and saved-prompt library), a
// Firestore-backed prospect roster, and a couple of setters. Here we
// supply all of that locally:
//
//   - settings        → persisted to localStorage, seeded from
//                        SAMPLE_SETTINGS (workEmail + marketingLeads) so
//                        the Activity + Marketing Leads sections light up
//   - updateSettings  → merges a patch into that object (this is how the
//                        Prompt Library persists, and how a pasted
//                        Salesforce link lands on a marketing lead)
//   - prospects       → a small roster matching the sample opps' accounts
//                        so the "New BFO Opp" table's editable BFO Company
//                        Name cells have somewhere to write to
//   - updateProspect  → merges a patch into that roster
//
// The opps roster, HubSpot contacts, today's activity and the pasted BFO
// Activity rows are seeded into the localStorage-backed shims on first
// load (see src/data/sampleData.js + src/utils/opps2Store.js).

const SETTINGS_KEY = 'agx::settings';
const PROSPECTS_KEY = 'agx::prospects';

// A prospect per sample-opp account, keyed so AgentsView can match an
// opp's Account → a Table View company and store a BFO Company Name.
const SAMPLE_PROSPECTS = [
  { id: 'p1', company: 'Acme Property Group', type: 'Owner Operator', peOwner: 'Blackstone', cdm: 'Dan Baldauf', bfoCompanyName: 'Acme Property Group LLC' },
  { id: 'p2', company: 'Northwind Logistics', type: 'Operator', peOwner: '', cdm: 'Dan Baldauf', bfoCompanyName: '' },
  { id: 'p3', company: 'Cedar & Vale Real Estate', type: 'Equity REIT', peOwner: '', cdm: 'Dan Baldauf', bfoCompanyName: '' },
  { id: 'p4', company: 'Harbor Point Holdings', type: 'RE Investment Manager', peOwner: 'KKR', cdm: 'Dan Baldauf', bfoCompanyName: 'Harbor Point Holdings Inc' },
  { id: 'p5', company: 'Summit Facilities Mgmt', type: 'Facility Manager', peOwner: '', cdm: 'Dan Baldauf', bfoCompanyName: '' },
  { id: 'p6', company: 'Lakeshore Capital Partners', type: 'Private Equity', peOwner: 'Lakeshore Capital', cdm: 'Dan Baldauf', bfoCompanyName: 'Lakeshore Capital Partners' },
  { id: 'p7', company: 'Beacon Hill Trust', type: 'Owner Operator', peOwner: '', cdm: 'Dan Baldauf', bfoCompanyName: 'Beacon Hill Trust' },
];

function loadJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}

export default function AgentsApp() {
  const [ready, setReady] = useState(false);
  const [settings, setSettings] = useState(() => loadJson(SETTINGS_KEY, SAMPLE_SETTINGS));
  const [prospects, setProspects] = useState(() => loadJson(PROSPECTS_KEY, SAMPLE_PROSPECTS));

  // Seed every browser cache the Agents page reads BEFORE mounting it, so
  // the Activity / BFO / Marketing tables render populated on first paint.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await seedAgentsDemo();
      await loadOpps2Cache(); // lazily seeds the opps roster (opps2Store SHIM)
      if (!cancelled) setReady(true);
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* quota */ }
  }, [settings]);

  useEffect(() => {
    try { localStorage.setItem(PROSPECTS_KEY, JSON.stringify(prospects)); } catch { /* quota */ }
  }, [prospects]);

  const updateSettings = useCallback((patch) => {
    setSettings((prev) => ({ ...prev, ...patch }));
  }, []);

  const updateProspect = useCallback((id, patch) => {
    setProspects((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }, []);

  return (
    <AuthProvider>
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--color-bg, #F8FAFC)',
          fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
        }}
      >
        <header style={headerBar}>
          <span style={{ fontWeight: 700, color: '#0f172a' }}>Prospect Tracker — Agents</span>
          <span style={{ marginLeft: 12, fontSize: 13, color: '#64748b' }}>standalone export</span>
        </header>

        <main style={{ flex: 1, minHeight: 0 }}>
          {ready ? (
            <AgentsView
              prospects={prospects}
              settings={settings}
              updateProspect={updateProspect}
              updateSettings={updateSettings}
            />
          ) : (
            <div style={{ padding: 32, color: '#64748b' }}>Loading sample data…</div>
          )}
        </main>
      </div>
    </AuthProvider>
  );
}

const headerBar = {
  display: 'flex',
  alignItems: 'baseline',
  gap: 8,
  padding: '10px 16px',
  borderBottom: '1px solid #e2e8f0',
  background: '#fff',
};
