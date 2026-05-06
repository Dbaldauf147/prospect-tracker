import { useEffect, useState } from 'react';
import styles from './ContactsView.module.css';
import { HubSpotView } from '../HubSpotView/HubSpotView';
import { AgendaView } from '../AgendaView/AgendaView';
import { KeyContactsView } from '../KeyContactsView/KeyContactsView';
import { ActiveContactsView } from '../ActiveContactsView/ActiveContactsView';
import { ClientContactsView } from '../ClientContactsView/ClientContactsView';
import { ChangedJobsContactsView } from '../ChangedJobsContactsView/ChangedJobsContactsView';
import { DedupeView } from '../DedupeView/DedupeView';

const SUBTABS = [
  { key: 'hubspot',  label: 'HubSpot Contacts' },
  { key: 'bulk',     label: 'Bulk Add Contacts' },
  { key: 'key',      label: 'Key Contacts' },
  { key: 'active',   label: 'Active Contacts' },
  { key: 'clients',  label: 'Client Contacts' },
  { key: 'changed',  label: 'Changed Jobs' },
  { key: 'dedupe',   label: 'Deduplication' },
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
  cdmName,
  settings,
  updateSettings,
  targetAccountsData,
}) {
  const [subtab, setSubtab] = useState(readSavedSubtab);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, subtab); } catch {}
  }, [subtab]);

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
      </div>
      <div className={styles.content}>
        {subtab === 'hubspot' && (
          <HubSpotView prospects={prospects} settings={settings} updateSettings={updateSettings} />
        )}
        {subtab === 'bulk' && (
          <AgendaView
            prospects={prospects}
            onSelectProspect={onSelectProspect}
            onUpdateProspect={onUpdateProspect}
            cdmName={cdmName}
            settings={settings}
            targetAccountsData={targetAccountsData}
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
        {subtab === 'dedupe' && <DedupeView />}
      </div>
    </div>
  );
}
