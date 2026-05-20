import { useState, useEffect, useCallback, useMemo } from 'react';
import { getHubspotContacts } from './utils/hubspotContactsCache';
import { useAuth } from './contexts/AuthContext';
import { useProspects } from './hooks/useProspects';
import { useSheetSync } from './hooks/useSheetSync';
import { useFilters } from './hooks/useFilters';
import { useUserSettings } from './hooks/useUserSettings';
import { Sidebar } from './components/Sidebar';
import { SettingsBackupsModal } from './components/SettingsBackupsModal';
import { CdmNameModal } from './components/CdmNameModal';
import { LoginPage } from './components/LoginPage';
import { FilterBar } from './components/FilterBar/FilterBar';
import { TableView } from './components/TableView/TableView';
import { KanbanView } from './components/KanbanView/KanbanView';
import { PrivacyPolicy } from './components/PrivacyPolicy';
import { ProspectModal } from './components/ProspectModal/ProspectModal';
import { UpdateBanner } from './components/UpdateBanner';
import { SyncPanel } from './components/SyncPanel';
import { MyAccountsView } from './components/MyAccountsView/MyAccountsView';
import { ContactsView } from './components/ContactsView/ContactsView';
import { OppsView } from './components/OppsView/OppsView';
import { OppsView2 } from './components/OppsView2/OppsView2';
import { DropdownsView } from './components/DropdownsView/DropdownsView';
import { ClientsView } from './components/ClientsView/ClientsView';
import { ActivityView } from './components/ActivityView/ActivityView';
import { AgentsView } from './components/AgentsView/AgentsView';
import { loadTargetAccountsFromDB } from './components/TargetAccountsView/TargetAccountsView';
import { DraftEmailsPage } from './components/DraftEmailView/DraftEmailsPage';
import { VibeProspecting } from './components/VibeProspecting/VibeProspecting';
import { ProgressView } from './components/ProgressView/ProgressView';
import { ListsView } from './components/ListsView/ListsView';
import { PEPortfolioView } from './components/PEPortfolioView/PEPortfolioView';
import { PricingView } from './components/PricingView/PricingView';
import { PipelineView } from './components/PipelineView/PipelineView';
import { BFOActivityView } from './components/BFOActivityView/BFOActivityView';
import { DailySuccessManager } from './components/DailySuccess/DailySuccessManager';
import { DailySuccessLogModal } from './components/DailySuccess/DailySuccessLogModal';
import { SERVICE_CATEGORIES } from './data/enums';
import './App.css';

const EMPTY_OBJ = Object.freeze({});

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
  const { user, loading: authLoading, authError, signInWithEmail, createAccount, resetPassword, logout } = useAuth();
  const { prospects, loading: dataLoading, addProspect, updateProspect, deleteProspect, replaceAll } = useProspects(user);
  const { settings, updateSettings, updateSettingsPath } = useUserSettings(user);

  // The CDM name to filter and default new-prospect ownership against.
  // Stored per-user in userSettings.cdmName; the admin account falls back
  // to "Dan Baldauf" so existing data keeps matching even before a value
  // is written. Other accounts pick this at signup.
  const cdmName = settings.cdmName || (user?.email === 'baldaufdan@gmail.com' ? 'Dan Baldauf' : (user?.displayName || ''));
  useSheetSync(user);
  const {
    filtered, searchTerm, setSearchTerm,
    filters, filterOptions, toggleFilter, clearFilters, loadSavedFilter, activeFilterCount,
    sortConfig, toggleSort,
  } = useFilters(prospects, settings, updateSettings);

  // Global guard: stop Backspace from triggering browser back-navigation
  // anywhere in the app. Firefox / older Edge still navigate back on
  // Backspace whenever focus isn't in a real text input — the listener
  // runs in capture on both document and window so it fires before any
  // child handlers, regardless of which surface owns focus.
  useEffect(() => {
    const NON_TEXT_INPUT_TYPES = new Set([
      'button', 'submit', 'reset', 'checkbox', 'radio', 'file', 'image',
      'color', 'range', 'hidden',
    ]);
    function onKey(e) {
      if (e.key !== 'Backspace' && e.keyCode !== 8) return;
      const t = e.target;
      if (!t || t.isContentEditable) return;
      const tag = (t.tagName || '').toLowerCase();
      if (tag === 'textarea' || tag === 'select') return;
      if (tag === 'input') {
        const type = (t.type || 'text').toLowerCase();
        // Read-only / disabled / non-text inputs would let the browser
        // navigate back, so block here.
        if (NON_TEXT_INPUT_TYPES.has(type) || t.readOnly || t.disabled) {
          e.preventDefault();
        }
        return;
      }
      e.preventDefault();
    }
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, []);

  const [view, setView] = useState('accounts');
  const [modal, setModal] = useState(null); // null | { prospect, isNew }
  const [showSync, setShowSync] = useState(false);
  const [showBackups, setShowBackups] = useState(false);
  const [showCdmName, setShowCdmName] = useState(false);
  const [showDailyLog, setShowDailyLog] = useState(false);
  const [migrating, setMigrating] = useState(false);
  const [migrateResult, setMigrateResult] = useState(null);
  const [hubspotContacts, setHubspotContacts] = useState([]);

  // Load HubSpot contacts from IndexedDB and refresh on cache updates.
  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      getHubspotContacts().then(c => { if (!cancelled) setHubspotContacts(c); }).catch(() => {});
    };
    refresh();
    window.addEventListener('hubspot-cache-updated', refresh);
    return () => { cancelled = true; window.removeEventListener('hubspot-cache-updated', refresh); };
  }, []);

  // Apply per-contact local overrides on top of the cached HubSpot
  // contacts before passing them down. Specifically, _companyOverride
  // takes precedence over c.company so contacts whose HubSpot
  // Company association couldn't be reassigned still surface under
  // the user's typed company everywhere — not just on the HubSpot
  // Contacts tab.
  const effectiveHubspotContacts = useMemo(() => {
    const local = settings?.contactLocalFields || {};
    if (!hubspotContacts.length || Object.keys(local).length === 0) return hubspotContacts;
    return hubspotContacts.map(c => {
      const f = local[c.id];
      if (!f) return c;
      const out = { ...c, ...f };
      if (typeof f._companyOverride === 'string' && f._companyOverride) {
        out.company = f._companyOverride;
      }
      return out;
    });
  }, [hubspotContacts, settings?.contactLocalFields]);

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

  const handleModalSave = useCallback(async (data, { close = true } = {}) => {
    try {
      if (modal?.isNew) {
        await addProspect(data);
        setModal(null);
      } else if (modal) {
        await updateProspect(modal.prospect.id, data);
        if (close) setModal(null);
      }
    } catch (err) {
      console.error('Prospect save failed:', err);
      alert(`Save failed: ${err?.message || err}. Changes are not yet persisted.`);
    }
  }, [modal, addProspect, updateProspect]);

  const handleModalClose = useCallback(() => setModal(null), []);
  const handleDeleteContactPropagate = useCallback(() => {
    getHubspotContacts().then(setHubspotContacts).catch(() => {});
  }, []);
  const handleUpdateOrgChart = useCallback((key, data) => {
    const next = { ...(settings.orgCharts || {}), [key]: data };
    updateSettings({ orgCharts: next });
  }, [settings.orgCharts, updateSettings]);

  if (authLoading) {
    return <div className="loading">Loading...</div>;
  }

  if (!user) {
    return <LoginPage onSignInWithEmail={signInWithEmail} onCreateAccount={createAccount} onResetPassword={resetPassword} error={authError} />;
  }

  function handleAddNew() {
    setModal({ prospect: null, isNew: true });
  }

  function handleSelect(prospect) {
    setModal({ prospect, isNew: false });
  }

  return (
    <div className="layout">
      <Sidebar
        view={view}
        setView={setView}
        user={user}
        onLogout={logout}
        onSync={() => setShowSync(true)}
        onOpenBackups={() => setShowBackups(true)}
        onOpenCdmName={() => setShowCdmName(true)}
        onOpenDailyLog={() => setShowDailyLog(true)}
        userEmail={user?.email}
      />
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
          ) : view === 'drafts' || view === 'campaigns' ? (
            <DraftEmailsPage prospects={prospects} settings={settings} updateSettings={updateSettings} initialTab={view === 'campaigns' ? 'campaigns' : 'drafts'} />
          ) : view === 'progress' ? (
            <ProgressView prospects={prospects} settings={settings} cdmName={cdmName} />
          ) : view === 'vibe' ? (
            <VibeProspecting prospects={prospects} onUpdate={updateProspect} cdmName={cdmName} />
          ) : view === 'pricing' ? (
            <PricingView settings={settings} />
          ) : view === 'pipeline' ? (
            <PipelineView />
          ) : view === 'bfo' ? (
            <BFOActivityView />
          ) : view === 'privacy' ? (
            <PrivacyPolicy />
          ) : view === 'activity' ? (
            <ActivityView prospects={prospects} settings={settings} updateSettings={updateSettings} />
          ) : view === 'agents' ? (
            <AgentsView />
          ) : view === 'pe' ? (
            <PEPortfolioView prospects={prospects} onSelectProspect={handleSelect} />
          ) : view === 'contacts' ? (
            <ContactsView
              prospects={prospects}
              onSelectProspect={handleSelect}
              onUpdateProspect={updateProspect}
              onAddProspect={addProspect}
              cdmName={cdmName}
              settings={settings}
              updateSettings={updateSettings}
              targetAccountsData={targetAccountsData}
            />
          ) : view === 'lists' ? (
            <ListsView onTargetAccountsLoaded={setTargetAccountsData} prospects={prospects} onSelectProspect={handleSelect} cdmName={cdmName} settings={settings} updateSettings={updateSettings} updateSettingsPath={updateSettingsPath} />
          ) : view === 'clients' ? (
            <ClientsView prospects={prospects} onSelectProspect={handleSelect} cdmName={cdmName} settings={settings} updateSettings={updateSettings} />
          ) : view === 'opps' ? (
            <OppsView settings={settings} updateSettings={updateSettings} />
          ) : view === 'opps2' ? (
            <OppsView2 settings={settings} updateSettings={updateSettings} prospects={prospects} updateProspect={updateProspect} />
          ) : view === 'dropdowns' ? (
            <DropdownsView settings={settings} updateSettings={updateSettings} />
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
              cdmName={cdmName}
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
              settings={settings}
              updateSettings={updateSettings}
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
          prospects={prospects}
          isNew={modal.isNew}
          onSave={handleModalSave}
          onClose={handleModalClose}
          onDeleteProspect={deleteProspect}
          onUpdateProspect={updateProspect}
          hubspotContacts={effectiveHubspotContacts}
          onDeleteContact={handleDeleteContactPropagate}
          orgCharts={settings.orgCharts || EMPTY_OBJ}
          onUpdateOrgChart={handleUpdateOrgChart}
          settings={settings}
          updateSettings={updateSettings}
          updateSettingsPath={updateSettingsPath}
          cdmName={cdmName}
          targetAccountsData={targetAccountsData}
        />
      )}

      {showSync && <SyncPanel prospects={prospects} onClose={() => setShowSync(false)} />}
      <CdmNameModal
        open={showCdmName}
        onClose={() => setShowCdmName(false)}
        currentName={cdmName}
        onSave={(next) => updateSettings({ cdmName: next })}
      />
      <SettingsBackupsModal
        open={showBackups}
        onClose={() => setShowBackups(false)}
        onRestore={(data) => {
          // Overwrite every top-level key from the backup so restore is complete
          // (updateSettings merges at the top level, so nested keys get replaced wholesale).
          updateSettings(data);
        }}
      />
      <DailySuccessLogModal
        open={showDailyLog}
        onClose={() => setShowDailyLog(false)}
        user={user}
      />
      <DailySuccessManager user={user} />
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
