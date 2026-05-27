import { useEffect, useState } from 'react';
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
import { setHubspotCache } from '../../utils/hubspotContactsCache';

const SUBTABS = [
  { key: 'hubspot',    label: 'HubSpot Contacts' },
  { key: 'se',         label: 'SE Contacts' },
  { key: 'bulk',       label: 'Bulk Add Contacts' },
  { key: 'all',        label: 'All Contacts' },
  { key: 'key',        label: 'Key Contacts' },
  { key: 'keyprospects', label: 'Key Prospects' },
  { key: 'active',     label: 'Active Contacts' },
  { key: 'clients',    label: 'Client Contacts' },
  { key: 'changed',    label: 'Changed Jobs' },
  { key: 'zoominfo',   label: 'Zoom Info' },
  { key: 'dedupe',     label: 'Deduplication' },
];

const STORAGE_KEY = 'contacts-view:active-subtab';

function readSavedSubtab() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (SUBTABS.some(t => t.key === saved)) return saved;
  } catch {}
  return 'key';
}

export function ContactsView({
  prospects,
  onSelectProspect,
  onUpdateProspect,
  onAddProspect,
  cdmName,
  settings,
  updateSettings,
  targetAccountsData,
}) {
  const [subtab, setSubtab] = useState(readSavedSubtab);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState('');

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
    setRefreshing(true);
    setRefreshError('');
    try {
      const res = await fetch('/api/hubspot?action=contacts');
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
      await setHubspotCache({ ...json, contacts: slimContacts, syncedAt: new Date().toISOString() });
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
            disabled={refreshing}
            title="Re-pull every HubSpot contact and overwrite the local cache that the Contacts page subtabs read from."
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
        {subtab === 'all' && (
          <AllContactsView
            prospects={prospects}
            onSelectProspect={onSelectProspect}
            settings={settings}
            updateSettings={updateSettings}
            cdmName={cdmName}
          />
        )}
        {subtab === 'key' && (
          <KeyContactsView
            prospects={prospects}
            onSelectProspect={onSelectProspect}
            settings={settings}
            updateSettings={updateSettings}
            cdmName={cdmName}
          />
        )}
        {subtab === 'keyprospects' && (
          <KeyProspectsView
            prospects={prospects}
            onSelectProspect={onSelectProspect}
            settings={settings}
            updateSettings={updateSettings}
            cdmName={cdmName}
          />
        )}
        {subtab === 'active' && (
          <ActiveContactsView
            prospects={prospects}
            onSelectProspect={onSelectProspect}
            settings={settings}
            updateSettings={updateSettings}
            cdmName={cdmName}
          />
        )}
        {subtab === 'clients' && (
          <ClientContactsView
            prospects={prospects}
            onSelectProspect={onSelectProspect}
            settings={settings}
            updateSettings={updateSettings}
            cdmName={cdmName}
          />
        )}
        {subtab === 'changed' && (
          <ChangedJobsContactsView
            prospects={prospects}
            onSelectProspect={onSelectProspect}
            settings={settings}
            updateSettings={updateSettings}
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
