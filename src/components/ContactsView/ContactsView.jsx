import { useEffect, useState } from 'react';
import styles from './ContactsView.module.css';
import { HubSpotView } from '../HubSpotView/HubSpotView';
import { AgendaView } from '../AgendaView/AgendaView';
import { KeyContactsView } from '../KeyContactsView/KeyContactsView';
import { DedupeView } from '../DedupeView/DedupeView';

const SUBTABS = [
  { key: 'hubspot',  label: 'HubSpot Contacts' },
  { key: 'bulk',     label: 'Bulk Add Contacts' },
  { key: 'key',      label: 'Key Contacts' },
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
}) {
  const [subtab, setSubtab] = useState(readSavedSubtab);
  // When the Key Contacts tab asks to edit a contact, we hand the raw
  // HubSpot contact to HubSpotView and switch the sub-tab there. The
  // HubSpot view opens its existing edit modal and clears the handoff.
  const [pendingEditContact, setPendingEditContact] = useState(null);

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
          <HubSpotView
            prospects={prospects}
            settings={settings}
            updateSettings={updateSettings}
            pendingEditContact={pendingEditContact}
            onClearPendingEditContact={() => setPendingEditContact(null)}
          />
        )}
        {subtab === 'bulk' && (
          <AgendaView
            prospects={prospects}
            onSelectProspect={onSelectProspect}
            onUpdateProspect={onUpdateProspect}
            cdmName={cdmName}
          />
        )}
        {subtab === 'key' && (
          <KeyContactsView
            prospects={prospects}
            onSelectProspect={onSelectProspect}
            onEditContact={(contact) => {
              if (!contact) return;
              setPendingEditContact(contact);
              setSubtab('hubspot');
            }}
          />
        )}
        {subtab === 'dedupe' && <DedupeView />}
      </div>
    </div>
  );
}
