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
import './App.css';

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
            <VibeProspecting prospects={prospects} />
          ) : view === 'dedupe' ? (
            <DedupeView />
          ) : view === 'privacy' ? (
            <PrivacyPolicy />
          ) : view === 'activity' ? (
            <ActivityView prospects={prospects} />
          ) : view === 'targets' ? (
            <TargetAccountsView onDataLoaded={setTargetAccountsData} />
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
          hubspotContacts={(() => {
            try {
              const cache = JSON.parse(localStorage.getItem('hubspot-sync-cache'));
              return cache?.contacts || [];
            } catch { return []; }
          })()}
          onDeleteContact={() => setModal(m => m ? { ...m } : m)}
          orgCharts={settings.orgCharts || {}}
          onUpdateOrgChart={(key, data) => {
            const next = { ...(settings.orgCharts || {}), [key]: data };
            updateSettings({ orgCharts: next });
          }}
        />
      )}

      {showSync && <SyncPanel prospects={prospects} onClose={() => setShowSync(false)} />}
      <UpdateBanner />
    </div>
  );
}

export default App;
