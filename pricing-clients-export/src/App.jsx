import { useState, useEffect } from 'react';
import { AuthProvider } from './contexts/AuthContext';
import { ClientsView } from './components/ClientsView/ClientsView';
import { PricingView } from './components/PricingView/PricingView';
import { seedSampleData, SAMPLE_PROSPECTS, SAMPLE_CDM_NAME } from './data/sampleData';

// Standalone shell hosting the two exported pages behind a top nav.
//
// In the full app these pages get their props from a top-level layout
// (Firestore prospects, the signed-in user's CDM name, a shared settings
// object + setter). Here we supply all of that locally:
//   - prospects      → the hard-coded SAMPLE_PROSPECTS roster (Clients only)
//   - cdmName        → SAMPLE_CDM_NAME (matches every sample prospect)
//   - settings       → an in-component object; the pages persist column
//                      layout + dropdown-column bindings through it, which
//                      local state handles fine for a demo
//   - updateSettings → merges a patch into that object
//   - user           → provided by the AuthContext stub
//
// Deals & Commissions seed into localStorage on first load; Pricing state
// persists to IndexedDB (utils/db.js is the real browser implementation).
const PAGES = [
  { key: 'clients', label: 'Clients' },
  { key: 'pricing', label: 'Pricing' },
];

export default function App() {
  const [page, setPage] = useState('clients');
  const [settings, setSettings] = useState({});
  const updateSettings = (patch) => setSettings((prev) => ({ ...prev, ...patch }));

  useEffect(() => { seedSampleData(); }, []);

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
        <nav
          style={{
            display: 'flex',
            gap: 4,
            padding: '0.5rem 1rem',
            borderBottom: '1px solid #E2E8F0',
            background: '#fff',
            flexShrink: 0,
          }}
        >
          {PAGES.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => setPage(p.key)}
              style={{
                padding: '0.4rem 1rem',
                border: 'none',
                borderRadius: 6,
                cursor: 'pointer',
                fontFamily: 'inherit',
                fontSize: '0.9rem',
                fontWeight: 600,
                background: page === p.key ? '#2563EB' : 'transparent',
                color: page === p.key ? '#fff' : '#475569',
              }}
            >
              {p.label}
            </button>
          ))}
        </nav>
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
          {page === 'clients' ? (
            <ClientsView
              prospects={SAMPLE_PROSPECTS}
              cdmName={SAMPLE_CDM_NAME}
              settings={settings}
              updateSettings={updateSettings}
              user={{ uid: 'demo-user' }}
            />
          ) : (
            <PricingView settings={settings} />
          )}
        </div>
      </div>
    </AuthProvider>
  );
}
