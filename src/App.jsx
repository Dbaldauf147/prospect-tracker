import { useState, useEffect, useRef, useCallback, useMemo, Suspense } from 'react';
import { lazyView } from './utils/lazyView';
import { getHubspotContacts } from './utils/hubspotContactsCache';
import { useAuth } from './contexts/AuthContext';
import { useProspects } from './hooks/useProspects';
import { userLsGet, userLsSet } from './utils/userLs';
import { runProspectBackfill, formatBackfillReport, BACKFILL_PASSES } from './utils/peOwnerBackfill';
import { migrateIdKeyedSettings } from './utils/dedupeSettingsMigration';
import { SERVICE_MERGES, planServiceMerge } from './utils/serviceNameMerges';
import { mergeServiceLanguage } from './utils/contractLanguageStore';
import { useSheetSync } from './hooks/useSheetSync';
import { useFilters } from './hooks/useFilters';
import { useUserSettings } from './hooks/useUserSettings';
import { useIssues } from './hooks/useIssues';
import { useAgentsRunDue } from './hooks/useAgentsRunDue';
import { useOppsCallInDue } from './hooks/useOppsCallInDue';
import { useProspectingTagDebt } from './hooks/useProspectingTagDebt';
import { useGranolaAutoSync } from './hooks/useGranolaAutoSync';
import { AGENTS_SETTINGS_KEY, AGENTS_SNOOZE_SETTINGS_KEY } from './utils/agentsRunReminder';
import { Sidebar } from './components/Sidebar';
import { SettingsBackupsModal } from './components/SettingsBackupsModal';
import { CdmNameModal } from './components/CdmNameModal';
import { LoginPage } from './components/LoginPage';
import { FilterBar } from './components/FilterBar/FilterBar';
import { PrivacyPolicy } from './components/PrivacyPolicy';
import { UpdateBanner } from './components/UpdateBanner';
import { SyncPanel } from './components/SyncPanel';
import { DailySuccessManager } from './components/DailySuccess/DailySuccessManager';
import { DailySuccessLogModal } from './components/DailySuccess/DailySuccessLogModal';
import './App.css';

// Route views load on first navigation rather than shipping in the entry
// chunk. Before this, opening the login page downloaded and parsed every
// page in the app — 6.3 MB of JS (1.6 MB gzipped) for whichever one tab
// you were headed to. One <Suspense> around the view switch below covers
// them all; ProspectModal gets its own, plus an idle prefetch since it
// opens from nearly every view.
const ActivityView = lazyView(() => import('./components/ActivityView/ActivityView').then(m => ({ default: m.ActivityView })));
const AgentsView = lazyView(() => import('./components/AgentsView/AgentsView').then(m => ({ default: m.AgentsView })));
const BFOActivityView = lazyView(() => import('./components/BFOActivityView/BFOActivityView').then(m => ({ default: m.BFOActivityView })));
const CallRecordingsView = lazyView(() => import('./components/CallRecordingsView/CallRecordingsView').then(m => ({ default: m.CallRecordingsView })));
const ChartsView = lazyView(() => import('./components/ChartsView/ChartsView').then(m => ({ default: m.ChartsView })));
const ClientsView = lazyView(() => import('./components/ClientsView/ClientsView').then(m => ({ default: m.ClientsView })));
const ContactsView = lazyView(() => import('./components/ContactsView/ContactsView').then(m => ({ default: m.ContactsView })));
const DraftEmailsPage = lazyView(() => import('./components/DraftEmailView/DraftEmailsPage').then(m => ({ default: m.DraftEmailsPage })));
const DropdownsView = lazyView(() => import('./components/DropdownsView/DropdownsView').then(m => ({ default: m.DropdownsView })));
const IssuesView = lazyView(() => import('./components/IssuesView/IssuesView').then(m => ({ default: m.IssuesView })));
const KanbanView = lazyView(() => import('./components/KanbanView/KanbanView').then(m => ({ default: m.KanbanView })));
const ListsView = lazyView(() => import('./components/ListsView/ListsView').then(m => ({ default: m.ListsView })));
const MyAccountsView = lazyView(() => import('./components/MyAccountsView/MyAccountsView').then(m => ({ default: m.MyAccountsView })));
const OppsView = lazyView(() => import('./components/OppsView/OppsView').then(m => ({ default: m.OppsView })));
const OppsView2 = lazyView(() => import('./components/OppsView2/OppsView2').then(m => ({ default: m.OppsView2 })));
const PEPortfolioView = lazyView(() => import('./components/PEPortfolioView/PEPortfolioView').then(m => ({ default: m.PEPortfolioView })));
const PricingView = lazyView(() => import('./components/PricingView/PricingView').then(m => ({ default: m.PricingView })));
const ProspectingView = lazyView(() => import('./components/ProspectingView/ProspectingView').then(m => ({ default: m.ProspectingView })));
const ProspectModal = lazyView(() => import('./components/ProspectModal/ProspectModal').then(m => ({ default: m.ProspectModal })));
const TableView = lazyView(() => import('./components/TableView/TableView').then(m => ({ default: m.TableView })));
const BulkAddModal = lazyView(() => import('./components/TableView/BulkAddModal').then(m => ({ default: m.BulkAddModal })));
const UploadedListView = lazyView(() => import('./components/UploadedListView/UploadedListView').then(m => ({ default: m.UploadedListView })));
const VibeProspecting = lazyView(() => import('./components/VibeProspecting/VibeProspecting').then(m => ({ default: m.VibeProspecting })));

const EMPTY_OBJ = Object.freeze({});

function App() {
  const { user, isAdmin, loading: authLoading, authError, signInWithEmail, createAccount, resetPassword, logout } = useAuth();
  const { settings, loaded: settingsLoaded, updateSettings, updateSettingsPath } = useUserSettings(user);

  // Live ref to settings so the de-dupe migration callback — which can fire
  // asynchronously well after this render — reads the current maps instead
  // of a value captured in a stale closure.
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  // When the auto/manual de-dupe collapses duplicate accounts, move the
  // removed copies' account-id-keyed settings (Target Account mappings,
  // divisions, HQ regions) onto the surviving account so a hand-set mapping
  // isn't orphaned to a deleted id and lost.
  const handleDuplicatesCollapsed = useCallback((remaps) => {
    const patch = migrateIdKeyedSettings(settingsRef.current, remaps);
    if (patch) {
      console.log('Migrated account-keyed settings after de-dupe:', Object.keys(patch));
      updateSettings(patch);
    }
  }, [updateSettings]);

  const { prospects, loading: dataLoading, addProspect, updateProspect, deleteProspect, replaceAll, findDuplicates, dedupe } =
    useProspects(user, { settingsLoaded, onDuplicatesCollapsed: handleDuplicatesCollapsed });

  // The CDM name to filter and default new-prospect ownership against.
  // Stored per-user in userSettings.cdmName; the admin account falls back
  // to "Dan Baldauf" so existing data keeps matching even before a value
  // is written. Other accounts pick this at signup.
  const cdmName = settings.cdmName || (user?.email === 'baldaufdan@gmail.com' ? 'Dan Baldauf' : (user?.displayName || ''));

  // Daily Success features can be toggled off from the Settings menu.
  // Default to on (treat an absent setting as enabled) so existing
  // admins keep the morning prompt and log they had before — but only
  // once settings have actually loaded. Before the Firestore snapshot
  // arrives `settings` is an empty object, so `!== false` would read as
  // enabled and pop the morning prompt for a beat even when the user has
  // saved it off. Gate on `settingsLoaded` so a saved "off" is respected
  // from the first render instead of flashing on every page load.
  const dailyLogEnabled = settingsLoaded && settings.dailyLogEnabled !== false;
  const whatToDoTodayEnabled = settingsLoaded && settings.whatToDoTodayEnabled !== false;
  // Open (non-snoozed) issue count for the sidebar badge. Shares the same
  // hook the Issues tab uses so the badge and the tab never disagree.
  // Is the Agents tab's "run the prompts" reminder up? Gated on settings
  // having loaded so the badge doesn't flash before the stamp arrives, and
  // held down while the alert is snoozed so the dot and the banner agree.
  const agentsRunDue = useAgentsRunDue(
    settings[AGENTS_SETTINGS_KEY], settingsLoaded, settings[AGENTS_SNOOZE_SETTINGS_KEY],
  );
  // Opps whose Call In is at (or past) zero and that aren't marked "No
  // Further Action Today" — the calls still owed, badged on the Opps nav
  // item. Reads the Opps 2 store directly since those records never reach
  // App state; null until the first read lands.
  const oppsDueCount = useOppsCallInDue(user?.uid);
  // Contact rosters whose tags still aren't fully mapped. Computed once here
  // and handed to both readouts — the sidebar badge and the Prospecting
  // page's Tagged row — so the two can't report different numbers.
  const tagDebt = useProspectingTagDebt({ prospects, cdmName, settings, userId: user?.uid });
  const { issues, openCount: openIssuesCount, serviceGaps } = useIssues({ prospects, cdmName, user, marketingLeads: settings.marketingLeads, serviceOverrides: settings.serviceOverrides, settings });
  // The Prospecting page's renewal step counts these rows, and its Top PC
  // step reads the prospects directly. While the prospects are still
  // loading the detectors see an empty roster and find nothing — passing
  // null instead keeps that from reading as "all caught up" before the
  // data has arrived.
  const prospectingIssues = dataLoading ? null : issues;
  // Same guard for the targeted-services step: an empty roster yields no
  // coverage rows, which would read as "every service is at 100%".
  const prospectingServiceGaps = dataLoading ? null : serviceGaps;
  // The roster is passed in so the sheet import can diff against what the
  // app already has, instead of re-reading the whole collection on a timer.
  useSheetSync(user, prospects, !dataLoading);
  // Pull new Granola calls hourly from wherever the user is. It lives here
  // rather than on the Call Recordings page because that page is lazily
  // mounted — a sync tied to it only ran while it was open, so a morning
  // spent on Opps brought nothing in. Gated on settings having loaded: the
  // sync watermark is in there, and syncing without it re-walks the whole
  // back-fill window.
  useGranolaAutoSync(user, settings, updateSettings, prospects, settingsLoaded);
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
  const [bulkAddOpen, setBulkAddOpen] = useState(false);
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

  // Warm the company-popup chunk once the browser is idle. It opens from
  // nearly every view, so waiting for the click would trade a fast first
  // paint for a stutter on the first company opened.
  useEffect(() => {
    if (!user) return undefined;
    const warm = () => { import('./components/ProspectModal/ProspectModal').catch(() => {}); };
    if (typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(warm, { timeout: 4000 });
      return () => window.cancelIdleCallback?.(id);
    }
    const t = setTimeout(warm, 2000);
    return () => clearTimeout(t);
  }, [user]);

  const [targetAccountsData, setTargetAccountsData] = useState(null);

  // Load Target Accounts from Firestore/IndexedDB on startup
  useEffect(() => {
    if (!user) return undefined;
    // Imported on demand: this loader lives on the Target Accounts view
    // module, so a static import would pull that whole view (and its xlsx
    // dependency) into the entry chunk for the sake of one function. The
    // fetch still starts at login — it's just off the critical path.
    let cancelled = false;
    import('./components/TargetAccountsView/TargetAccountsView')
      .then(m => m.loadTargetAccountsFromDB(user.uid))
      .then(data => { if (!cancelled && data) setTargetAccountsData(data); })
      .catch(err => console.warn('Target accounts load failed:', err));
    return () => { cancelled = true; };
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

  // One-time service-name merges (see utils/serviceNameMerges.js): a service
  // that was seeded under two spellings is folded onto one name across the
  // stored board layout, the Solutions list, per-service metadata, and every
  // record's Services Explored / notes / SME maps.
  //
  // Gated on settings having loaded as well as prospects: before the
  // Firestore snapshot arrives `settings` is {} and the pass would plan an
  // empty patch, set its flag, and never look again. Silent unless it
  // actually moves something — the correction is the app's to make, not a
  // decision to put in front of the user like the backfills' report.
  useEffect(() => {
    if (!user || !settingsLoaded || dataLoading) return;
    const pending = SERVICE_MERGES.filter(m => !userLsGet(m.flag));
    if (pending.length === 0) return;
    for (const m of pending) userLsSet(m.flag, new Date().toISOString());
    (async () => {
      for (const merge of pending) {
        try {
          const { settingsPatch, prospectPatches, counts } = planServiceMerge(merge, settingsRef.current, prospects);
          if (Object.keys(settingsPatch).length) updateSettings(settingsPatch);
          for (const { id, patch } of prospectPatches) await updateProspect(id, patch);
          const language = await mergeServiceLanguage(user.uid, merge.from, merge.to);
          if (counts.settingsKeys.length || counts.prospects || language.moved) {
            console.log(
              `Merged service "${merge.from}" into "${merge.to}":`,
              { settings: counts.settingsKeys, prospects: counts.prospects, clausesMoved: language.moved },
            );
          }
        } catch (err) {
          console.warn(`Service merge "${merge.from}" → "${merge.to}" failed:`, err);
        }
      }
    })();
  }, [user, settingsLoaded, dataLoading, prospects, updateProspect, updateSettings]);

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

  function handleSelect(prospect, editContact) {
    setModal({ prospect, isNew: false, editContact: editContact || null });
  }

  // "Create <name>" from the sidebar search: open the same new-company popup
  // as + New, prefilled with what was typed. Everything else (status, tier,
  // …) keeps its usual defaults, so this is exactly + New with the name
  // already filled in.
  function handleCreateCompany(name) {
    const company = String(name || '').trim();
    if (!company) return;
    setModal({ prospect: { company }, isNew: true });
  }

  // Open a contact picked from the sidebar search. A contact is edited inside
  // its company's account popup, so resolve the contact to its prospect by
  // company name (respecting a pinned _companyOverride) and open that modal
  // focused on the contact. When the company isn't in the Table View roster,
  // still open the contact editor against a lightweight company-only record so
  // the person is always reachable.
  function handleSelectContact(contact) {
    if (!contact) return;
    const companyName = String(contact._companyOverride || contact.company || '').trim().toLowerCase();
    const prospect = companyName
      ? prospects.find(p => String(p?.company || '').trim().toLowerCase() === companyName)
      : null;
    setModal({ prospect: prospect || { company: contact.company || '' }, isNew: false, editContact: contact });
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
        oppsDueCount={oppsDueCount}
        prospectingTagDebt={tagDebt.count}
        agentsRunDue={agentsRunDue}
        prospects={prospects}
        contacts={effectiveHubspotContacts}
        onSelectProspect={handleSelect}
        onSelectContact={handleSelectContact}
        onCreateCompany={handleCreateCompany}
      />
      <div className="main">
        {(view === 'accounts' || view === 'table' || view === 'kanban') && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, borderBottom: '1px solid #E2E8F0', padding: '0 0.25rem' }}>
            {[
              { key: 'accounts', label: 'My Accounts', active: view === 'accounts' },
              // Pipeline (kanban) is a mode of the Table experience, so the
              // Table subtab stays highlighted for both.
              { key: 'table', label: 'Table', active: view === 'table' || view === 'kanban' },
            ].map(t => (
              <button
                key={t.key}
                type="button"
                onClick={() => setView(t.key)}
                style={{
                  background: 'none', border: 'none', padding: '0.55rem 0.9rem',
                  fontFamily: 'inherit', fontSize: '0.82rem',
                  fontWeight: t.active ? 700 : 500,
                  color: t.active ? '#1D4ED8' : '#475569',
                  borderBottom: t.active ? '2px solid #1D4ED8' : '2px solid transparent',
                  cursor: 'pointer', marginBottom: -1,
                }}
              >{t.label}</button>
            ))}
          </div>
        )}
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
            onBulkAdd={() => setBulkAddOpen(true)}
            resultCount={filtered.length}
            totalCount={prospects.length}
            savedFilters={settings.savedFilters || []}
            onUpdateSavedFilters={f => updateSettings({ savedFilters: f })}
          />
        )}
        <div className="content">
          <Suspense fallback={<div className="loading">Loading view…</div>}>
          {dataLoading ? (
            <div className="loading">Loading prospects...</div>
          ) : view === 'drafts' || view === 'campaigns' || view === 'tracking' ? (
            // Campaigns and Tracking are sub-tabs of Draft Emails; the view
            // keys stay routable so existing links land on the right tab.
            <DraftEmailsPage prospects={prospects} settings={settings} updateSettings={updateSettings} initialTab={view === 'drafts' ? 'drafts' : view} />
          ) : view === 'charts' ? (
            <ChartsView prospects={prospects} settings={settings} cdmName={cdmName} onSelectProspect={handleSelect} />
          ) : view === 'vibe' ? (
            <VibeProspecting prospects={prospects} onUpdate={updateProspect} cdmName={cdmName} />
          ) : view === 'pricing' ? (
            <PricingView settings={settings} />
          ) : view === 'bfo' ? (
            <BFOActivityView prospects={prospects} settings={settings} updateSettings={updateSettings} />
          ) : view === 'recordings' ? (
            <CallRecordingsView
              prospects={prospects}
              settings={settings}
              updateSettings={updateSettings}
              onSelectProspect={handleSelect}
            />
          ) : view === 'privacy' ? (
            <PrivacyPolicy />
          ) : view === 'activity' ? (
            <ActivityView prospects={prospects} settings={settings} updateSettings={updateSettings} />
          ) : view === 'agents' ? (
            <AgentsView prospects={prospects} settings={settings} updateProspect={updateProspect} updateSettings={updateSettings} />
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
              onNavigate={setView}
            />
          ) : view === 'lists' ? (
            <ListsView onTargetAccountsLoaded={setTargetAccountsData} prospects={prospects} onSelectProspect={handleSelect} cdmName={cdmName} settings={settings} updateSettings={updateSettings} updateSettingsPath={updateSettingsPath} updateProspect={updateProspect} />
          ) : view === 'strategic' ? (
            <UploadedListView
              storageKey="strategic-accounts-override"
              tableIdPrefix="strategic-accounts"
              title="Strategic Accounts"
              singular="account"
              plural="accounts"
              prospects={prospects}
              onSelectProspect={handleSelect}
              cdmName={cdmName}
              settings={settings}
              updateSettings={updateSettings}
              updateSettingsPath={updateSettingsPath}
            />
          ) : view === 'clients' ? (
            <ClientsView prospects={prospects} onSelectProspect={handleSelect} cdmName={cdmName} settings={settings} updateSettings={updateSettings} user={user} targetAccountsData={targetAccountsData} addProspect={addProspect} updateProspect={updateProspect} />
          ) : view === 'prospecting' ? (
            <ProspectingView
              onNavigate={setView}
              issues={prospectingIssues}
              serviceGaps={prospectingServiceGaps}
              prospects={dataLoading ? null : prospects}
              onSelectProspect={handleSelect}
              settings={settings}
              updateSettings={updateSettings}
              tagCoverage={tagDebt.coverage}
              tagDebt={tagDebt.missing}
            />
          ) : view === 'issues' ? (
            <IssuesView prospects={prospects} onSelectProspect={handleSelect} cdmName={cdmName} settings={settings} updateSettings={updateSettings} />
          ) : view === 'opps' ? (
            <OppsView settings={settings} updateSettings={updateSettings} />
          ) : view === 'opps2' ? (
            <OppsView2 settings={settings} updateSettings={updateSettings} updateSettingsPath={updateSettingsPath} prospects={prospects} updateProspect={updateProspect} addProspect={addProspect} onSelectProspect={handleSelect} />
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
          </Suspense>
        </div>
      </div>

      {modal && (
        <Suspense fallback={null}>
        <ProspectModal
          prospect={modal.prospect}
          prospects={prospects}
          onSelectProspect={handleSelect}
          isNew={modal.isNew}
          initialEditContact={modal.editContact}
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
        </Suspense>
      )}

      {bulkAddOpen && (
        <Suspense fallback={null}>
        <BulkAddModal
          existingProspects={prospects}
          onAdd={addProspect}
          onClose={() => setBulkAddOpen(false)}
          settings={settings}
        />
        </Suspense>
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
