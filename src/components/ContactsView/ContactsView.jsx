import { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../../utils/apiFetch';
import { useAuth } from '../../contexts/AuthContext';
import styles from './ContactsView.module.css';
import { HubSpotView } from '../HubSpotView/HubSpotView';
import { AgendaView } from '../AgendaView/AgendaView';
import { KeyContactsView } from '../KeyContactsView/KeyContactsView';
import { ActiveContactsView } from '../ActiveContactsView/ActiveContactsView';
import { ClientContactsView } from '../ClientContactsView/ClientContactsView';
import { ChangedJobsContactsView } from '../ChangedJobsContactsView/ChangedJobsContactsView';
import { DedupeView } from '../DedupeView/DedupeView';
import { ZoomInfoView } from '../ZoomInfoView/ZoomInfoView';
import { AllContactsView } from '../AllContactsView/AllContactsView';
import { KeyProspectsView } from '../KeyProspectsView/KeyProspectsView';
import { EventsView } from '../EventsView/EventsView';
import { MarketingLeadsView } from '../MarketingLeadsView/MarketingLeadsView';
import { setHubspotCachePreservingManual } from '../../utils/hubspotContactsCache';

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
      const slimContacts = json.contacts.map(c => ({
        id: c.id, vid: c.vid, firstname: c.firstname, lastname: c.lastname,
        email: c.email, phone: c.phone, jobtitle: c.jobtitle, company: c.company,
        hs_linkedin_url: c.hs_linkedin_url, linkedin_url: c.linkedin_url, hs_linkedinid: c.hs_linkedinid,
        city: c.city, state: c.state, country: c.country,
        dans_tags: c.dans_tags, dan_s_tags: c.dan_s_tags, dans_tag: c.dans_tag,
        decision_maker: c.decision_maker, role: c.role,
        hs_sequences_is_enrolled: c.hs_sequences_is_enrolled,
        notes_last_contacted: c.notes_last_contacted,
      }));
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
      </div>
    </div>
  );
}
