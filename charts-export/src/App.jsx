import { useState, useEffect } from 'react';
import { AuthProvider } from './contexts/AuthContext';
import { ChartsView } from './components/ChartsView/ChartsView';
import { seedSampleData, SAMPLE_PROSPECTS, SAMPLE_CDM_NAME } from './data/sampleData';

// Standalone shell for the Charts page and its three subtabs
// (YOY / Progress / Pipeline).
//
// In the full app these get their props from a top-level layout (Firestore
// prospects, the signed-in user's CDM name, a shared settings object).
// Here we supply all of that locally:
//   - prospects       → the hard-coded SAMPLE_PROSPECTS roster
//   - cdmName         → SAMPLE_CDM_NAME (matches every sample prospect)
//   - settings        → an in-component object + merge setter
//   - onSelectProspect→ logs the pick (there's no prospect modal in this export)
//
// The YOY / Pipeline tabs are workbook-driven: they render their normal
// empty state until you upload a spreadsheet, exactly like production.
// Progress renders from the sample roster.
export default function App() {
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
        <ChartsView
          prospects={SAMPLE_PROSPECTS}
          cdmName={SAMPLE_CDM_NAME}
          settings={settings}
          updateSettings={updateSettings}
          onSelectProspect={(p) => console.log('select prospect', p?.company)}
        />
      </div>
    </AuthProvider>
  );
}
