import { useState, useEffect } from 'react';
import { ClientsView } from './components/ClientsView/ClientsView';
import { seedSampleData, SAMPLE_PROSPECTS, SAMPLE_CDM_NAME } from './data/sampleData';

// Standalone wrapper around the real <ClientsView>. In the full app this
// page receives its props from the top-level App (Firestore prospects,
// the signed-in user's CDM name, a shared settings object, and a setter).
// Here we supply all of that locally:
//
//   - prospects     → the hard-coded SAMPLE_PROSPECTS roster
//   - cdmName       → SAMPLE_CDM_NAME (matches every sample prospect)
//   - settings      → an in-component object; the only thing the Clients
//                     page persists through it is column layout + the
//                     Status-column dropdown binding, so local state is
//                     plenty for a demo
//   - updateSettings→ merges a patch into that object
//   - user          → a stub; the Deals tab passes user.uid to the
//                     (now no-op) opportunities sync
//
// Deals and Commissions seed themselves into localStorage on first load.
export default function ClientsApp() {
  const [settings, setSettings] = useState({});
  const updateSettings = (patch) => setSettings((prev) => ({ ...prev, ...patch }));

  useEffect(() => { seedSampleData(); }, []);

  return (
    <div
      style={{
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        background: '#F8FAFC',
        fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
      }}
    >
      <ClientsView
        prospects={SAMPLE_PROSPECTS}
        cdmName={SAMPLE_CDM_NAME}
        settings={settings}
        updateSettings={updateSettings}
        user={{ uid: 'demo-user' }}
      />
    </div>
  );
}
