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
const HubSpotView = lazyView(() => import('../HubSpotView/HubSpotView').then(m => ({ default: m.HubSpotView })));
const AgendaView = lazyView(() => import('../AgendaView/AgendaView').then(m => ({ default: m.AgendaView })));
const KeyContactsView = lazyView(() => import('../KeyContactsView/KeyContactsView').then(m => ({ default: m.KeyContactsView })));
const ActiveContactsView = lazyView(() => import('../ActiveContactsView/ActiveContactsView').then(m => ({ default: m.ActiveContactsView })));
const ClientContactsView = lazyView(() => import('../ClientContactsView/ClientContactsView').then(m => ({ default: m.ClientContactsView })));
const ChangedJobsContactsView = lazyView(() => import('../ChangedJobsContactsView/ChangedJobsContactsView').then(m => ({ default: m.ChangedJobsContactsView })));
const DedupeView = lazyView(() => import('../DedupeView/DedupeView').then(m => ({ default: m.DedupeView })));
const ZoomInfoView = lazyView(() => import('../ZoomInfoView/ZoomInfoView').then(m => ({ default: m.ZoomInfoView })));
const AllContactsView = lazyView(() => import('../AllContactsView/AllContactsView').then(m => ({ default: m.AllContactsView })));
const KeyProspectsView = lazyView(() => import('../KeyProspectsView/KeyProspectsView').then(m => ({ default: m.KeyProspectsView })));
const EventsView = lazyView(() => import('../EventsView/EventsView').then(m => ({ default: m.EventsView })));
const MarketingLeadsView = lazyView(() => import('../MarketingLeadsView/MarketingLeadsView').then(m => ({ default: m.MarketingLeadsView })));

const ALL_SUBTABS = [
  { key: 'hubspot',    label: 'HubSpot',          adminOnly: true },
  { key: 'se',         label: 'SE',               adminOnly: true },
  { key: 'bulk',       label: 'Bulk Add' },
  { key: 'marketing',  label: 'Marketing Leads' },
  { key: 'all',        label: 'All Contacts' },
  { key: 'key',        label: 'Key Contacts' },
  { key: 'keyprospects', label: 'Key Prospects' },
  { key: 'active',     label: 'Active Contacts' },
  { key: 'clients',    label: 'Client Contacts' },
  { key: 'changed',    label: 'Changed Jobs' },
  { key: 'events',     label: 'Events' },
  { key: 'zoominfo',   label: 'Zoom Info' },
  { key: 'dedupe',     label: 'Deduplication' },
];

const STORAGE_KEY = 'contacts-view:active-subtab';

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
        {subtab === 'bulk' && (
          <AgendaView
            prospects={prospects}
            onSelectProspect={onSelectProspect}
            onUpdateProspect={onUpdateProspect}
            cdmName={cdmName}
            settings={settings}
            updateSettings={updateSettings}
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
