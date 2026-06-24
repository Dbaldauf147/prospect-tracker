import { useState, useEffect, useCallback, useMemo, lazy, Suspense } from 'react';
import { getHubspotContacts } from './utils/hubspotContactsCache';
import { useAuth } from './contexts/AuthContext';
import { useProspects } from './hooks/useProspects';
import { userLsGet, userLsSet } from './utils/userLs';
import { runProspectBackfill, formatBackfillReport, BACKFILL_PASSES } from './utils/peOwnerBackfill';
import { useSheetSync } from './hooks/useSheetSync';
import { useFilters } from './hooks/useFilters';
import { useUserSettings } from './hooks/useUserSettings';
import { useIssues } from './hooks/useIssues';
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
import { IssuesView } from './components/IssuesView/IssuesView';
import { ActivityView } from './components/ActivityView/ActivityView';
import { AgentsView } from './components/AgentsView/AgentsView';
import { loadTargetAccountsFromDB } from './components/TargetAccountsView/TargetAccountsView';
import { DraftEmailsPage } from './components/DraftEmailView/DraftEmailsPage';
import { VibeProspecting } from './components/VibeProspecting/VibeProspecting';
import { ListsView } from './components/ListsView/ListsView';
import { PEPortfolioView } from './components/PEPortfolioView/PEPortfolioView';
// Charts host: YOY / Progress / Pipeline as sub-tabs. Its YOY + Progress
// sub-views stay code-split inside ChartsView.
import { ChartsView } from './components/ChartsView/ChartsView';
// Chart-heavy views (recharts ~250 KB gz, plus their own xlsx usage)
// are split out of the main chunk; each load on first navigation.
const PricingView = lazy(() => import('./components/PricingView/PricingView').then(m => ({ default: m.PricingView })));
import { BFOActivityView } from './components/BFOActivityView/BFOActivityView';
import { DailySuccessManager } from './components/DailySuccess/DailySuccessManager';
import { DailySuccessLogModal } from './components/DailySuccess/DailySuccessLogModal';
import './App.css';

const EMPTY_OBJ = Object.freeze({});

function App() {
  const { user, isAdmin, loading: authLoading, authError, signInWithEmail, createAccount, resetPassword, logout } = useAuth();
  const { prospects, loading: dataLoading, addProspect, updateProspect, deleteProspect, replaceAll, findDuplicates, dedupe } = useProspects(user);
  const { settings, updateSettings, updateSettingsPath } = useUserSettings(user);

  // The CDM name to filter and default new-prospect ownership against.
  // Stored per-user in userSettings.cdmName; the admin account falls back
  // to "Dan Baldauf" so existing data keeps matching even before a value
  // is written. Other accounts pick this at signup.
  const cdmName = settings.cdmName || (user?.email === 'baldaufdan@gmail.com' ? 'Dan Baldauf' : (user?.displayName || ''));

  // Daily Success features can be toggled off from the Settings menu.
  // Default to on (treat an absent setting as enabled) so existing
  // admins keep the morning prompt and log they had before.
  const dailyLogEnabled = settings.dailyLogEnabled !== false;
  const whatToDoTodayEnabled = settings.whatToDoTodayEnabled !== false;
  // Open (non-snoozed) issue count for the sidebar badge. Shares the same
  // hook the Issues tab uses so the badge and the tab never disagree.
  const { openCount: openIssuesCount } = useIssues({ prospects, cdmName, user });
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

  const [view, setView] = useState('opps2');
  const [modal, setModal] = useState(null); // null | { prospect, isNew }
  const [showSync, setShowSync] = useState(false);
  const [showBackups, setShowBackups] = useState(false);
  const [showCdmName, setShowCdmName] = useState(false);
  const [showDailyLog, setShowDailyLog] = useState(false);
  const [hubspotContacts, setHubspotContacts] = useState([]);

  // Load HubSpot contacts from IndexedDB and refresh on cache updates.
  // Keyed on the user's uid because IndexedDB reads return nothing until
  // AuthContext calls setDbUserId(uid) (db scopes every key by uid). On a
  // fresh load this effect first runs before auth resolves — getHubspotContacts
  // reads an unscoped store and gets []. Re-running once user.uid is known
  // re-reads the now-scoped cache so the persisted contacts reappear instead
  // of waiting for a manual "Refresh HubSpot Contacts".
  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      getHubspotContacts().then(c => { if (!cancelled) setHubspotContacts(c); }).catch(() => {});
    };
    refresh();
    window.addEventListener('hubspot-cache-updated', refresh);
    return () => { cancelled = true; window.removeEventListener('hubspot-cache-updated', refresh); };
  }, [user?.uid]);

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

  const [targetAccountsData, setTargetAccountsData] = useState(null);

  // Load Target Accounts from Firestore/IndexedDB on startup
  useEffect(() => {
    if (!user) return;
    loadTargetAccountsFromDB(user.uid).then(data => {
      if (data) setTargetAccountsData(data);
    });
  }, [user]);

  // One-time prospect backfills (see utils/peOwnerBackfill.js): each
  // pass stamps fixed field values onto a list of Table View companies
  // the first time prospects load for this user/browser, then reports
  // the result — including any names that matched no record.
  useEffect(() => {
    if (!user || dataLoading || prospects.length === 0) return;
    const pending = BACKFILL_PASSES.filter(pass => !userLsGet(pass.flag));
    if (pending.length === 0) return;
    for (const pass of pending) userLsSet(pass.flag, new Date().toISOString());
    (async () => {
      for (const pass of pending) {
        try {
          const result = await runProspectBackfill(prospects, updateProspect, pass);
          window.alert(formatBackfillReport(pass, result));
        } catch (err) {
          window.alert(`Company update failed: ${err?.message || err}`);
        }
      }
    })();
  }, [user, dataLoading, prospects, updateProspect]);

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
        isAdmin={isAdmin}
        dailyLogEnabled={dailyLogEnabled}
        whatToDoTodayEnabled={whatToDoTodayEnabled}
        onToggleDailyLog={() => updateSettings({ dailyLogEnabled: !dailyLogEnabled })}
        onToggleWhatToDoToday={() => updateSettings({ whatToDoTodayEnabled: !whatToDoTodayEnabled })}
        issuesCount={openIssuesCount}
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
          ) : view === 'charts' ? (
            <ChartsView prospects={prospects} settings={settings} cdmName={cdmName} />
          ) : view === 'vibe' ? (
            <VibeProspecting prospects={prospects} onUpdate={updateProspect} cdmName={cdmName} />
          ) : view === 'pricing' ? (
            <Suspense fallback={<div className="loading">Loading view…</div>}>
              <PricingView settings={settings} />
            </Suspense>
          ) : view === 'bfo' ? (
            <BFOActivityView prospects={prospects} />
          ) : view === 'privacy' ? (
            <PrivacyPolicy />
          ) : view === 'activity' ? (
            <ActivityView prospects={prospects} settings={settings} updateSettings={updateSettings} />
          ) : view === 'agents' ? (
            <AgentsView prospects={prospects} settings={settings} updateProspect={updateProspect} />
          ) : view === 'pe' ? (
            <PEPortfolioView prospects={prospects} onSelectProspect={handleSelect} metInPersonMap={settings.contactMetInPerson || {}} onUpdateProspect={updateProspect} onAddProspect={addProspect} settings={settings} updateSettings={updateSettings} />
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
            <ListsView onTargetAccountsLoaded={setTargetAccountsData} prospects={prospects} onSelectProspect={handleSelect} cdmName={cdmName} settings={settings} updateSettings={updateSettings} updateSettingsPath={updateSettingsPath} updateProspect={updateProspect} />
          ) : view === 'clients' ? (
            <ClientsView prospects={prospects} onSelectProspect={handleSelect} cdmName={cdmName} settings={settings} updateSettings={updateSettings} user={user} />
          ) : view === 'issues' ? (
            <IssuesView prospects={prospects} onSelectProspect={handleSelect} cdmName={cdmName} settings={settings} updateSettings={updateSettings} />
          ) : view === 'opps' ? (
            <OppsView settings={settings} updateSettings={updateSettings} />
          ) : view === 'opps2' ? (
            <OppsView2 settings={settings} updateSettings={updateSettings} prospects={prospects} updateProspect={updateProspect} addProspect={addProspect} onSelectProspect={handleSelect} />
          ) : view === 'dropdowns' ? (
            <DropdownsView settings={settings} updateSettings={updateSettings} />
          ) : view === 'accounts' ? (
            <MyAccountsView
              prospects={prospects}
              onSelect={handleSelect}
              onUpdate={updateProspect}
              onDelete={deleteProspect}
              onAdd={addProspect}
              onFindDuplicates={findDuplicates}
              onDedupe={dedupe}
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
        currentWorkEmail={settings.workEmail || ''}
        onSave={(next) => updateSettings(next)}
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
        open={showDailyLog && dailyLogEnabled}
        onClose={() => setShowDailyLog(false)}
        user={user}
      />
      {isAdmin && whatToDoTodayEnabled && <DailySuccessManager user={user} />}
      <UpdateBanner />
    </div>
  );
}

export default App;
