import { useEffect, useMemo, useState, Suspense } from 'react';
import { apiFetch } from '../../utils/apiFetch';
import { useAuth } from '../../contexts/AuthContext';
import styles from './ContactsView.module.css';
import { lazyView } from '../../utils/lazyView';
import { setHubspotCachePreservingManual } from '../../utils/hubspotContactsCache';
import { slimHubspotContact } from '../../utils/hubspotContactFields';

// Sub-tabs load on first visit rather than all riding in one chunk. Opening
// Contacts used to download every contacts page at once — 404 kB of JS
// (105 kB gzipped) — whichever tab you were actually headed to. The
// <Suspense> around the tab body below covers them all.
const HubSpotView = lazyView(() => import('../HubSpotView/HubSpotView'), 'HubSpotView');
const AgendaView = lazyView(() => import('../AgendaView/AgendaView'), 'AgendaView');
const ZoomSearchLogView = lazyView(() => import('../AgendaView/ZoomSearchLogView'), 'ZoomSearchLogView');
const KeyContactsView = lazyView(() => import('../KeyContactsView/KeyContactsView'), 'KeyContactsView');
const ActiveContactsView = lazyView(() => import('../ActiveContactsView/ActiveContactsView'), 'ActiveContactsView');
const ClientContactsView = lazyView(() => import('../ClientContactsView/ClientContactsView'), 'ClientContactsView');
const ChangedJobsContactsView = lazyView(() => import('../ChangedJobsContactsView/ChangedJobsContactsView'), 'ChangedJobsContactsView');
const DedupeView = lazyView(() => import('../DedupeView/DedupeView'), 'DedupeView');
const ZoomInfoView = lazyView(() => import('../ZoomInfoView/ZoomInfoView'), 'ZoomInfoView');
const AllContactsView = lazyView(() => import('../AllContactsView/AllContactsView'), 'AllContactsView');
const DecisionMakersView = lazyView(() => import('../DecisionMakersView/DecisionMakersView'), 'DecisionMakersView');
const KeyProspectsView = lazyView(() => import('../KeyProspectsView/KeyProspectsView'), 'KeyProspectsView');
const EventsView = lazyView(() => import('../EventsView/EventsView'), 'EventsView');
const MarketingLeadsView = lazyView(() => import('../MarketingLeadsView/MarketingLeadsView'), 'MarketingLeadsView');
const ContactTitlesView = lazyView(() => import('../ContactTitlesView/ContactTitlesView'), 'ContactTitlesView');
const ContactHistoryView = lazyView(() => import('../ContactHistoryView/ContactHistoryView'), 'ContactHistoryView');

const ALL_SUBTABS = [
  { key: 'hubspot',    label: 'HubSpot',          adminOnly: true },
  { key: 'se',         label: 'SE',               adminOnly: true },
  { key: 'bulk',       label: 'Bulk Add' },
  { key: 'marketing',  label: 'Marketing Leads' },
  // Every tab on this bar is a tab of contacts, so three of them spent a
  // word saying so. "All Contacts / Key Contacts / Active Contacts / Client
  // Contacts" reads as one word repeated with a qualifier in front, and the
  // qualifier is the whole of what distinguishes them. The keys are
  // untouched: they are what the saved tab is remembered by.
  { key: 'all',        label: 'All' },
  // The same page over the one tag that decides who can sign, so it sits
  // next to All rather than at the end of the roster tabs.
  { key: 'dms',        label: 'DMs' },
  { key: 'key',        label: 'Key Contacts' },
  { key: 'keyprospects', label: 'Key Prospects' },
  { key: 'active',     label: 'Active' },
  { key: 'clients',    label: 'Clients' },
  { key: 'changed',    label: 'Changed Jobs' },
  // The Key / Client / Key Prospect roster sizes week by week. After the
  // rosters it counts, before the tabs that aren't rosters.
  { key: 'history',    label: 'History' },
  // Not a roster: the searches the rosters are built BY. It sits after them
  // rather than among them so the tabs that list people stay together.
  { key: 'titles',     label: 'Titles' },
  { key: 'events',     label: 'Events' },
  { key: 'zoominfo',   label: 'Zoom Info' },
  { key: 'dedupe',     label: 'Deduplication' },
];

const STORAGE_KEY = 'contacts-view:active-subtab';

// Bulk Add's own tabs: the contact import it has always been, and the log
// of ZoomInfo pulls that feed it.
const BULK_VIEWS = [
  { key: 'import', label: 'Add Contacts' },
  { key: 'zoomlog', label: 'Zoom Search Log' },
];
const BULK_VIEW_KEY = 'contacts-view:bulk-view';

function BulkAddTabs({ view, onChange }) {
  return (
    // flex: none: .content stretches every child to fill the page, which
    // turned this one-line bar into two pills half a screen tall.
    <div style={{ display: 'flex', alignItems: 'center', flex: 'none', gap: '0.35rem', padding: '0.55rem 1.25rem 0', flexWrap: 'wrap' }} role="tablist" aria-label="Bulk Add views">
      {BULK_VIEWS.map(v => {
        const on = view === v.key;
        return (
          <button
            key={v.key}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(v.key)}
            style={{
              padding: '0.3rem 0.85rem', borderRadius: 999, fontFamily: 'inherit', fontSize: '0.76rem', fontWeight: 600, cursor: 'pointer',
              border: `1px solid ${on ? 'var(--color-accent)' : 'var(--color-border)'}`,
              background: on ? 'var(--color-accent)' : 'var(--color-surface)',
              color: on ? '#fff' : 'var(--color-text-muted)',
            }}
          >{v.label}</button>
        );
      })}
    </div>
  );
}

function readSavedSubtab(visibleKeys) {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (visibleKeys.includes(saved)) return saved;
  } catch {}
  return visibleKeys.includes('key') ? 'key' : visibleKeys[0];
}

export function ContactsView({
  prospects,
  onSelectProspect,
  onUpdateProspect,
  onAddProspect,
  cdmName,
  settings,
  updateSettings,
  updateSettingsPath,
  targetAccountsData,
  onNavigate,
}) {
  const { isAdmin } = useAuth();
  // The HubSpot Contacts and SE Contacts subtabs both hit /api/hubspot,
  // which uses a single server-side token tied to the admin's portal —
  // hide them for everyone else so non-admin users don't see empty or
  // permission-error views.
  const SUBTABS = useMemo(
    () => ALL_SUBTABS.filter(t => isAdmin || !t.adminOnly),
    [isAdmin],
  );
  const visibleKeys = useMemo(() => SUBTABS.map(t => t.key), [SUBTABS]);
  const [subtab, setSubtab] = useState(() => readSavedSubtab(visibleKeys));
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState('');
  const [bulkView, setBulkView] = useState(() => {
    try {
      const saved = localStorage.getItem(BULK_VIEW_KEY);
      if (BULK_VIEWS.some(v => v.key === saved)) return saved;
    } catch { /* storage blocked: open on the import */ }
    return 'import';
  });
  useEffect(() => {
    try { localStorage.setItem(BULK_VIEW_KEY, bulkView); } catch { /* storage blocked */ }
  }, [bulkView]);

  // If the active subtab disappears (e.g. a non-admin loaded with the
  // admin-only key saved), snap to a visible one.
  useEffect(() => {
    if (!visibleKeys.includes(subtab)) {
      setSubtab(visibleKeys.includes('key') ? 'key' : visibleKeys[0]);
    }
  }, [subtab, visibleKeys]);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, subtab); } catch {}
  }, [subtab]);

  // Re-pull HubSpot contacts on demand. Same endpoint + slim shape the
  // My Accounts view uses for its background refresh, so the cache the
  // contact-page subtabs read from gets replaced wholesale. setHubspotCache
  // dispatches `hubspot-cache-updated`, which App.jsx and the other consumer
  // views listen for and re-read from IndexedDB.
  async function refreshContacts() {
    if (refreshing) return;
    if (!isAdmin) return;
    setRefreshing(true);
    setRefreshError('');
    try {
      const res = await apiFetch('/api/hubspot?action=contacts');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (!json?.contacts) throw new Error('No contacts in response');
      const slimContacts = json.contacts.map(slimHubspotContact);
      await setHubspotCachePreservingManual({ ...json, contacts: slimContacts, syncedAt: new Date().toISOString() });
    } catch (err) {
      setRefreshError(err?.message || 'Refresh failed');
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className={styles.wrapper}>
      <div className={styles.subtabBar}>
        <div className={styles.subtabs}>
          {SUBTABS.map(t => (
            <button
              key={t.key}
              className={subtab === t.key ? styles.subtabActive : styles.subtab}
              onClick={() => setSubtab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className={styles.refreshBlock}>
          {refreshError && (
            <span className={styles.refreshError} title={refreshError}>Refresh failed</span>
          )}
          <button
            type="button"
            className={styles.refreshBtn}
            onClick={refreshContacts}
            disabled={refreshing || !isAdmin}
            title={isAdmin
              ? 'Re-pull every HubSpot contact and overwrite the local cache that the Contacts page subtabs read from.'
              : 'HubSpot refresh is restricted to the admin account.'}
          >
            {refreshing ? 'Refreshing…' : 'Refresh contacts'}
          </button>
        </div>
      </div>
      <div className={styles.content}>
        <Suspense fallback={<div className="loading">Loading view…</div>}>
        {subtab === 'hubspot' && (
          <HubSpotView prospects={prospects} settings={settings} updateSettings={updateSettings} />
        )}
        {subtab === 'se' && (
          <HubSpotView prospects={prospects} settings={settings} updateSettings={updateSettings} emailFilterMode="only-se" />
        )}
        {subtab === 'bulk' && <BulkAddTabs view={bulkView} onChange={setBulkView} />}
        {subtab === 'bulk' && bulkView === 'zoomlog' && (
          <ZoomSearchLogView prospects={prospects} onUpdateProspect={onUpdateProspect} settings={settings} />
        )}
        {subtab === 'bulk' && bulkView === 'import' && (
          <AgendaView
            prospects={prospects}
            onSelectProspect={onSelectProspect}
            onUpdateProspect={onUpdateProspect}
            cdmName={cdmName}
            settings={settings}
            updateSettings={updateSettings}
            updateSettingsPath={updateSettingsPath}
            targetAccountsData={targetAccountsData}
          />
        )}
        {subtab === 'marketing' && (
          <MarketingLeadsView
            prospects={prospects}
            settings={settings}
            updateSettings={updateSettings}
            updateSettingsPath={updateSettingsPath}
            onAddProspect={onAddProspect}
            onSelectProspect={onSelectProspect}
            targetAccountsData={targetAccountsData}
            onNavigate={onNavigate}
          />
        )}
        {subtab === 'titles' && <ContactTitlesView settings={settings} updateSettings={updateSettings} />}
        {subtab === 'history' && <ContactHistoryView />}
        {subtab === 'all' && (
          <AllContactsView
            prospects={prospects}
            onSelectProspect={onSelectProspect}
            settings={settings}
            updateSettings={updateSettings}
            updateSettingsPath={updateSettingsPath}
            cdmName={cdmName}
          />
        )}
        {subtab === 'dms' && (
          <DecisionMakersView
            prospects={prospects}
            onSelectProspect={onSelectProspect}
            settings={settings}
            updateSettings={updateSettings}
            updateSettingsPath={updateSettingsPath}
            cdmName={cdmName}
          />
        )}
        {subtab === 'key' && (
          <KeyContactsView
            prospects={prospects}
            onSelectProspect={onSelectProspect}
            settings={settings}
            updateSettings={updateSettings}
            updateSettingsPath={updateSettingsPath}
            cdmName={cdmName}
          />
        )}
        {subtab === 'keyprospects' && (
          <KeyProspectsView
            prospects={prospects}
            onSelectProspect={onSelectProspect}
            settings={settings}
            updateSettings={updateSettings}
            updateSettingsPath={updateSettingsPath}
            cdmName={cdmName}
          />
        )}
        {subtab === 'active' && (
          <ActiveContactsView
            prospects={prospects}
            onSelectProspect={onSelectProspect}
            settings={settings}
            updateSettings={updateSettings}
            updateSettingsPath={updateSettingsPath}
            cdmName={cdmName}
          />
        )}
        {subtab === 'clients' && (
          <ClientContactsView
            prospects={prospects}
            onSelectProspect={onSelectProspect}
            settings={settings}
            updateSettings={updateSettings}
            updateSettingsPath={updateSettingsPath}
            cdmName={cdmName}
          />
        )}
        {subtab === 'changed' && (
          <ChangedJobsContactsView
            prospects={prospects}
            onSelectProspect={onSelectProspect}
            settings={settings}
            updateSettings={updateSettings}
            updateSettingsPath={updateSettingsPath}
            cdmName={cdmName}
          />
        )}
        {subtab === 'events' && (
          <EventsView
            settings={settings}
            updateSettings={updateSettings}
            prospects={prospects}
            onSelectProspect={onSelectProspect}
            onAddProspect={onAddProspect}
            onUpdateProspect={onUpdateProspect}
            cdmName={cdmName}
          />
        )}
        {subtab === 'zoominfo' && (
          <ZoomInfoView prospects={prospects} settings={settings} updateSettings={updateSettings} onAddProspect={onAddProspect} />
        )}
        {subtab === 'dedupe' && <DedupeView />}
        </Suspense>
      </div>
    </div>
  );
}
