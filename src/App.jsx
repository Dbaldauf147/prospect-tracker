import { useState, useEffect } from 'react';
import { useAuth } from './contexts/AuthContext';
import { useProspects } from './hooks/useProspects';
import { useSheetSync } from './hooks/useSheetSync';
import { useFilters } from './hooks/useFilters';
import { useUserSettings } from './hooks/useUserSettings';
import { Sidebar } from './components/Sidebar';
import { LoginPage } from './components/LoginPage';
import { FilterBar } from './components/FilterBar/FilterBar';
import { TableView } from './components/TableView/TableView';
import { KanbanView } from './components/KanbanView/KanbanView';
import { PrivacyPolicy } from './components/PrivacyPolicy';
import { ProspectModal } from './components/ProspectModal/ProspectModal';
import { UpdateBanner } from './components/UpdateBanner';
import { SyncPanel } from './components/SyncPanel';
import { MyAccountsView } from './components/MyAccountsView/MyAccountsView';
import { HubSpotView } from './components/HubSpotView/HubSpotView';
import { OppsView } from './components/OppsView/OppsView';
import { ClientsView } from './components/ClientsView/ClientsView';
import { ActivityView } from './components/ActivityView/ActivityView';
import { TargetAccountsView, loadTargetAccountsFromDB } from './components/TargetAccountsView/TargetAccountsView';
import { DedupeView } from './components/DedupeView/DedupeView';
import { DraftEmailView } from './components/DraftEmailView/DraftEmailView';
import { VibeProspecting } from './components/VibeProspecting/VibeProspecting';
import { EmailCampaignView } from './components/EmailCampaignView/EmailCampaignView';
import { ProgressView } from './components/ProgressView/ProgressView';
import { RAClientsView } from './components/RAClientsView/RAClientsView';
import { SERVICE_CATEGORIES } from './data/enums';
import './App.css';

// CSV column name -> enum service item name mapping for mismatched names
const CSV_TO_ENUM = {
  'Climate risk SUCON': 'Climate risk disclosure SUCON',
  'Climate risk Scenario Analysis SUCON': 'Climate risk Scenario Analysis',
  'Climate risk & opportunity assessment SUCON': 'Climate risk & opportunity assessment',
  'BPS Reporting': 'BPS reporting',
  'Peak alerts': 'Peak Alerts',
};
const ENUM_LOWER = new Map(SERVICE_CATEGORIES.flatMap(c => c.items).map(i => [i.toLowerCase(), i]));
function mapCsvToEnum(n) { return CSV_TO_ENUM[n] || ENUM_LOWER.get(n.toLowerCase()) || null; }
function mapCsvVal(v) {
  const t = (v || '').trim();
  if (t === 'N/A') return 'N/A';
  if (t === 'Sold') return 'Sold';
  if (t === 'Not Sold') return 'Not Sold';
  if (t === 'Renewal' || t === 'Tracking/Renewal') return 'Renewal';
  if (t === 'in progress') return 'In Progress';
  return null;
}
function csvCompMatch(a, b) {
  const na = (a || '').toLowerCase().trim(), nb = (b || '').toLowerCase().trim();
  if (!na || !nb) return false;
  if (na === nb) return true;
  const longer = na.length >= nb.length ? na : nb, shorter = na.length >= nb.length ? nb : na;
  if (shorter.length >= 4 && shorter.length >= longer.length * 0.6 && longer.includes(shorter)) return true;
  return false;
}
function parseCsvRow(line) {
  const v = []; let f = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"') { if (line[i+1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else { if (c === '"') q = true; else if (c === ',') { v.push(f); f = ''; } else f += c; }
  }
  v.push(f); return v;
}

function App() {
  const { user, loading: authLoading, authError, signInWithGoogle, signInWithEmail, createAccount, logout } = useAuth();
  const { prospects, loading: dataLoading, addProspect, updateProspect, deleteProspect, replaceAll } = useProspects(user);
  const { settings, updateSettings } = useUserSettings(user);
  useSheetSync(user);
  const {
    filtered, searchTerm, setSearchTerm,
    filters, filterOptions, toggleFilter, clearFilters, loadSavedFilter, activeFilterCount,
    sortConfig, toggleSort,
  } = useFilters(prospects);

  const [view, setView] = useState('accounts');
  const [modal, setModal] = useState(null); // null | { prospect, isNew }
  const [showSync, setShowSync] = useState(false);
  const [migrating, setMigrating] = useState(false);
  const [migrateResult, setMigrateResult] = useState(null);
  const [hubspotContacts, setHubspotContacts] = useState(() => {
    try {
      const cache = JSON.parse(localStorage.getItem('hubspot-sync-cache'));
      return cache?.contacts || [];
    } catch { return []; }
  });

  // Refresh hubspot contacts when cache updates
  useEffect(() => {
    const handler = () => {
      try {
        const cache = JSON.parse(localStorage.getItem('hubspot-sync-cache'));
        setHubspotContacts(cache?.contacts || []);
      } catch {}
    };
    window.addEventListener('hubspot-cache-updated', handler);
    return () => window.removeEventListener('hubspot-cache-updated', handler);
  }, []);

  async function migrateClientsServices() {
    if (migrating) return;
    if (!confirm('Import service statuses (N/A, Sold, Not Sold, etc.) from the Clients tab into all matching prospects? This only fills in values that are not already set.')) return;
    setMigrating(true);
    setMigrateResult(null);
    try {
      const res = await fetch('https://docs.google.com/spreadsheets/d/1ee0OREqA25jzDaR6xRDSrj_ZIZDymQjf1k2Z2_ajVKw/gviz/tq?tqx=out:csv&sheet=Clients');
      const csv = await res.text();
      const lines = csv.split('\n').filter(l => l.trim());
      const headers = parseCsvRow(lines[0]);
      const scopeIdx = headers.findIndex(h => h.includes('Explored Scope'));
      const svcStart = scopeIdx + 1;
      const svcCols = [];
      for (let i = svcStart; i < headers.length; i++) {
        const h = headers[i].trim();
        if (h && h !== 'x') { const en = mapCsvToEnum(h); if (en) svcCols.push({ idx: i, enumName: en }); }
      }
      let updated = 0;
      for (let r = 1; r < lines.length; r++) {
        const row = parseCsvRow(lines[r]);
        const clientName = (row[0] || '').trim();
        if (!clientName) continue;
        const services = {};
        for (const col of svcCols) {
          const val = mapCsvVal(row[col.idx]);
          if (val) services[col.enumName] = val;
        }
        if (Object.keys(services).length === 0) continue;
        const prospect = prospects.find(p => csvCompMatch(p.company, clientName));
        if (!prospect) continue;
        const existing = prospect.servicesExplored || {};
        const merged = { ...existing };
        let changed = false;
        for (const [svc, status] of Object.entries(services)) {
          if (!existing[svc] || existing[svc] === '-') { merged[svc] = status; changed = true; }
        }
        if (changed) { await updateProspect(prospect.id, { servicesExplored: merged }); updated++; }
      }
      setMigrateResult(`Done! Updated ${updated} prospects.`);
    } catch (err) {
      setMigrateResult(`Error: ${err.message}`);
    }
    setMigrating(false);
  }
  const [targetAccountsData, setTargetAccountsData] = useState(null);

  // Load Target Accounts from Firestore/IndexedDB on startup
  useEffect(() => {
    if (!user) return;
    loadTargetAccountsFromDB(user.uid).then(data => {
      if (data) setTargetAccountsData(data);
    });
  }, [user]);

  if (authLoading) {
    return <div className="loading">Loading...</div>;
  }

  if (!user) {
    return <LoginPage onSignIn={signInWithGoogle} onSignInWithEmail={signInWithEmail} onCreateAccount={createAccount} error={authError} />;
  }

  function handleAddNew() {
    setModal({ prospect: null, isNew: true });
  }

  function handleSelect(prospect) {
    setModal({ prospect, isNew: false });
  }

  async function handleModalSave(data, { close = true } = {}) {
    if (modal.isNew) {
      await addProspect(data);
      setModal(null);
    } else {
      await updateProspect(modal.prospect.id, data);
      if (close) setModal(null);
    }
  }

  return (
    <div className="layout">
      <Sidebar view={view} setView={setView} user={user} onLogout={logout} onSync={() => setShowSync(true)} />
      <div className="main">
        {(view === 'table' || view === 'kanban') && (
          <FilterBar
            searchTerm={searchTerm}
            setSearchTerm={setSearchTerm}
            filters={filters}
            filterOptions={filterOptions}
            toggleFilter={toggleFilter}
            onLoadSavedFilter={loadSavedFilter}
            clearFilters={clearFilters}
            activeFilterCount={activeFilterCount}
            view={view}
            setView={setView}
            onAddNew={handleAddNew}
            resultCount={filtered.length}
            totalCount={prospects.length}
            savedFilters={settings.savedFilters || []}
            onUpdateSavedFilters={f => updateSettings({ savedFilters: f })}
          />
        )}
        <div className="content">
          {dataLoading ? (
            <div className="loading">Loading prospects...</div>
          ) : view === 'drafts' ? (
            <DraftEmailView prospects={prospects} settings={settings} updateSettings={updateSettings} />
          ) : view === 'progress' ? (
            <ProgressView prospects={prospects} settings={settings} />
          ) : view === 'campaigns' ? (
            <EmailCampaignView />
          ) : view === 'vibe' ? (
            <VibeProspecting prospects={prospects} onUpdate={updateProspect} />
          ) : view === 'dedupe' ? (
            <DedupeView />
          ) : view === 'privacy' ? (
            <PrivacyPolicy />
          ) : view === 'activity' ? (
            <ActivityView prospects={prospects} />
          ) : view === 'targets' ? (
            <TargetAccountsView onDataLoaded={setTargetAccountsData} />
          ) : view === 'raclients' ? (
            <RAClientsView />
          ) : view === 'clients' ? (
            <ClientsView />
          ) : view === 'opps' ? (
            <OppsView />
          ) : view === 'hubspot' ? (
            <HubSpotView prospects={prospects} settings={settings} updateSettings={updateSettings} />
          ) : view === 'accounts' ? (
            <MyAccountsView
              prospects={prospects}
              onSelect={handleSelect}
              onUpdate={updateProspect}
              onDelete={deleteProspect}
              onAdd={addProspect}
              targetAccountsData={targetAccountsData}
              settings={settings}
              updateSettings={updateSettings}
            />
          ) : view === 'table' ? (
            <TableView
              prospects={filtered}
              allProspects={prospects}
              sortConfig={sortConfig}
              toggleSort={toggleSort}
              onUpdate={updateProspect}
              onDelete={deleteProspect}
              onSelect={handleSelect}
              onAdd={addProspect}
              onReplaceAll={replaceAll}
            />
          ) : (
            <KanbanView
              prospects={filtered}
              onUpdate={updateProspect}
              onSelect={handleSelect}
            />
          )}
        </div>
      </div>

      {modal && (
        <ProspectModal
          prospect={modal.prospect}
          isNew={modal.isNew}
          onSave={handleModalSave}
          onClose={() => setModal(null)}
          hubspotContacts={hubspotContacts}
          onDeleteContact={() => {
            try {
              const cache = JSON.parse(localStorage.getItem('hubspot-sync-cache'));
              setHubspotContacts(cache?.contacts || []);
            } catch {}
          }}
          orgCharts={settings.orgCharts || {}}
          onUpdateOrgChart={(key, data) => {
            const next = { ...(settings.orgCharts || {}), [key]: data };
            updateSettings({ orgCharts: next });
          }}
          settings={settings}
          updateSettings={updateSettings}
        />
      )}

      {showSync && <SyncPanel prospects={prospects} onClose={() => setShowSync(false)} />}
      {/* One-time migration button */}
      {!settings.clientsServicesMigrated && (
        <div style={{ position: 'fixed', bottom: '1rem', right: '1rem', zIndex: 300, background: '#fff', border: '1px solid #E2E8F0', borderRadius: '8px', padding: '0.75rem 1rem', boxShadow: '0 4px 12px rgba(0,0,0,0.15)', maxWidth: '320px' }}>
          <div style={{ fontSize: '0.75rem', fontWeight: 700, marginBottom: '0.3rem' }}>Import Services from Clients Tab</div>
          <div style={{ fontSize: '0.68rem', color: '#64748B', marginBottom: '0.5rem' }}>One-time import of N/A, Sold, Not Sold, Renewal, and In Progress statuses into Services Explored for all matching prospects.</div>
          <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
            <button onClick={migrateClientsServices} disabled={migrating} style={{ padding: '0.3rem 0.7rem', border: 'none', borderRadius: '5px', background: '#3B82F6', color: '#fff', fontSize: '0.7rem', fontWeight: 600, cursor: migrating ? 'wait' : 'pointer', fontFamily: 'inherit' }}>
              {migrating ? 'Importing...' : 'Run Import'}
            </button>
            <button onClick={() => updateSettings({ clientsServicesMigrated: true })} style={{ padding: '0.3rem 0.7rem', border: '1px solid #E2E8F0', borderRadius: '5px', background: '#fff', fontSize: '0.7rem', cursor: 'pointer', fontFamily: 'inherit', color: '#64748B' }}>Dismiss</button>
          </div>
          {migrateResult && <div style={{ marginTop: '0.4rem', fontSize: '0.68rem', color: migrateResult.startsWith('Error') ? '#EF4444' : '#059669', fontWeight: 600 }}>{migrateResult}</div>}
        </div>
      )}
      <UpdateBanner />
    </div>
  );
}

export default App;
