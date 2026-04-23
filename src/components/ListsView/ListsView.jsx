import { useState } from 'react';
import { RAClientsView } from '../RAClientsView/RAClientsView';
import { TargetAccountsView } from '../TargetAccountsView/TargetAccountsView';
import { RECAClientsView } from '../RECAClientsView/RECAClientsView';
import { SitesView } from '../SitesView/SitesView';
import { UploadedListView } from '../UploadedListView/UploadedListView';
import styles from './ListsView.module.css';

const SUBTABS = [
  { key: 'raclients', label: 'RA Clients' },
  { key: 'targets', label: 'Target Accounts' },
  { key: 'recaclients', label: 'RECA Clients' },
  { key: 'sites', label: 'Utility Lookup' },
  { key: 'csrd', label: 'CSRD' },
  { key: 'cdp', label: 'CDP' },
  { key: 'gresb', label: 'GRESB' },
  { key: 'sbt', label: 'SBT' },
  { key: 'ecovadis', label: 'Ecovadis' },
  { key: 'unpri', label: 'UN PRI' },
];

function DataSourceLink({ storageKey }) {
  const saved = (() => { try { return localStorage.getItem(storageKey) || ''; } catch { return ''; } })();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(saved);

  function save() {
    const url = draft.trim();
    try {
      if (url) localStorage.setItem(storageKey, url);
      else localStorage.removeItem(storageKey);
    } catch {}
    setEditing(false);
  }

  if (editing) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
        <input
          autoFocus
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false); }}
          placeholder="Paste data source URL..."
          style={{ flex: 1, minWidth: 200, padding: '0.25rem 0.5rem', border: '1px solid var(--color-accent)', borderRadius: 4, fontSize: '0.72rem', fontFamily: 'inherit' }}
        />
        <button
          onClick={save}
          style={{ padding: '0.25rem 0.5rem', border: 'none', borderRadius: 4, background: 'var(--color-accent)', color: '#fff', fontSize: '0.68rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
        >Save</button>
        <button
          onClick={() => setEditing(false)}
          style={{ padding: '0.25rem 0.5rem', border: '1px solid var(--color-border)', borderRadius: 4, background: '#fff', color: '#64748B', fontSize: '0.68rem', cursor: 'pointer', fontFamily: 'inherit' }}
        >Cancel</button>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
      {saved ? (
        <>
          <a
            href={saved}
            target="_blank"
            rel="noopener noreferrer"
            title={saved}
            style={{ fontSize: '0.72rem', color: 'var(--color-accent)', maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-block' }}
          >
            Data source
          </a>
          <button
            onClick={() => { setDraft(saved); setEditing(true); }}
            style={{ background: 'none', border: 'none', fontSize: '0.68rem', color: '#94A3B8', cursor: 'pointer', fontFamily: 'inherit' }}
          >Edit</button>
          <button
            onClick={() => { try { localStorage.removeItem(storageKey); } catch {} setDraft(''); setEditing(false); window.location.reload(); }}
            style={{ background: 'none', border: 'none', fontSize: '0.68rem', color: '#94A3B8', cursor: 'pointer', fontFamily: 'inherit' }}
            onMouseEnter={e => e.currentTarget.style.color = '#DC2626'}
            onMouseLeave={e => e.currentTarget.style.color = '#94A3B8'}
          >×</button>
        </>
      ) : (
        <button
          onClick={() => { setDraft(''); setEditing(true); }}
          style={{ fontSize: '0.72rem', color: 'var(--color-accent)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 }}
        >+ Add data source link</button>
      )}
    </div>
  );
}

export function ListsView({ onTargetAccountsLoaded, prospects = [], onSelectProspect }) {
  const [subtab, setSubtab] = useState('raclients');

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
        <div className={styles.sourceLink}>
          <DataSourceLink storageKey={`list-source-url:${subtab}`} />
        </div>
      </div>
      <div className={styles.content}>
        {subtab === 'raclients' && <RAClientsView />}
        {subtab === 'targets' && <TargetAccountsView onDataLoaded={onTargetAccountsLoaded} />}
        {subtab === 'recaclients' && <RECAClientsView prospects={prospects} onSelectProspect={onSelectProspect} />}
        {subtab === 'sites' && <SitesView />}
        {subtab === 'csrd' && (
          <UploadedListView
            storageKey="csrd-list-override"
            tableIdPrefix="csrd-list"
            title="CSRD"
            singular="company"
            plural="companies"
            prospects={prospects}
            onSelectProspect={onSelectProspect}
          />
        )}
        {subtab === 'cdp' && (
          <UploadedListView
            storageKey="cdp-list-override"
            tableIdPrefix="cdp-list"
            title="CDP"
            singular="company"
            plural="companies"
            prospects={prospects}
            onSelectProspect={onSelectProspect}
          />
        )}
        {subtab === 'gresb' && (
          <UploadedListView
            storageKey="gresb-list-override"
            tableIdPrefix="gresb-list"
            title="GRESB"
            singular="company"
            plural="companies"
            prospects={prospects}
            onSelectProspect={onSelectProspect}
          />
        )}
        {subtab === 'sbt' && (
          <UploadedListView
            storageKey="sbt-list-override"
            tableIdPrefix="sbt-list"
            title="SBT"
            singular="company"
            plural="companies"
            prospects={prospects}
            onSelectProspect={onSelectProspect}
          />
        )}
        {subtab === 'ecovadis' && (
          <UploadedListView
            storageKey="ecovadis-list-override"
            tableIdPrefix="ecovadis-list"
            title="Ecovadis"
            singular="company"
            plural="companies"
            prospects={prospects}
            onSelectProspect={onSelectProspect}
          />
        )}
        {subtab === 'unpri' && (
          <UploadedListView
            storageKey="unpri-list-override"
            tableIdPrefix="unpri-list"
            title="UN PRI"
            singular="signatory"
            plural="signatories"
            prospects={prospects}
            onSelectProspect={onSelectProspect}
          />
        )}
      </div>
    </div>
  );
}
